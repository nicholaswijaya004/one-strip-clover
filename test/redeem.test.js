const test = require("node:test");
const assert = require("node:assert/strict");
const { evaluateRedemption, STATUS } = require("../lib/redeem");

const JAM = 3600 * 1000;
const GRACE = 24 * JAM;
const SEKARANG = Date.parse("2026-08-01T10:00:00Z");

const pakai = (jamLalu) => ({
  used: true,
  usedAt: new Date(SEKARANG - jamLalu * JAM).toISOString(),
});

test("redeem: kode belum pernah dipakai → penukaran pertama", () => {
  const v = evaluateRedemption({ used: false }, { now: SEKARANG, graceMs: GRACE });
  assert.equal(v.status, STATUS.OK);
});

test("redeem: kode tidak terdaftar → invalid", () => {
  assert.equal(
    evaluateRedemption(undefined, { now: SEKARANG, graceMs: GRACE }).status,
    STATUS.INVALID
  );
});

test("redeem: refresh beberapa menit setelah bayar → sesi dipulihkan", () => {
  const v = evaluateRedemption(pakai(0.1), { now: SEKARANG, graceMs: GRACE });
  assert.equal(v.status, STATUS.REENTRY, "pembeli tidak boleh terkunci");
});

test("redeem: masih dalam batas waktu (23 jam) → dipulihkan", () => {
  const v = evaluateRedemption(pakai(23), { now: SEKARANG, graceMs: GRACE });
  assert.equal(v.status, STATUS.REENTRY);
});

test("redeem: tepat di batas waktu → masih dipulihkan", () => {
  const v = evaluateRedemption(pakai(24), { now: SEKARANG, graceMs: GRACE });
  assert.equal(v.status, STATUS.REENTRY);
});

test("redeem: lewat batas waktu (25 jam) tanpa memesan → ditolak", () => {
  const v = evaluateRedemption(pakai(25), { now: SEKARANG, graceMs: GRACE });
  assert.equal(v.status, STATUS.USED);
});

test("redeem: kode lama tanpa catatan usedAt tetap bisa dipulihkan", () => {
  // jangan mengunci pembeli hanya karena data lama tidak lengkap
  const v = evaluateRedemption({ used: true }, { now: SEKARANG, graceMs: GRACE });
  assert.equal(v.status, STATUS.REENTRY);
  assert.equal(v.since, null);
});

test("redeem: usedAt rusak/ngawur tetap bisa dipulihkan", () => {
  const v = evaluateRedemption(
    { used: true, usedAt: "bukan-tanggal" },
    { now: SEKARANG, graceMs: GRACE }
  );
  assert.equal(v.status, STATUS.REENTRY);
});

test("redeem: masa tenggang bisa diatur (1 jam)", () => {
  const opts = { now: SEKARANG, graceMs: 1 * JAM };
  assert.equal(evaluateRedemption(pakai(0.5), opts).status, STATUS.REENTRY);
  assert.equal(evaluateRedemption(pakai(2), opts).status, STATUS.USED);
});

test("redeem: masa tenggang 0 = perilaku lama (sekali pakai keras)", () => {
  const v = evaluateRedemption(pakai(0.01), { now: SEKARANG, graceMs: 0 });
  assert.equal(v.status, STATUS.USED);
});

/* ---- jaminan bisnis: pemulihan sesi TIDAK menambah jatah pesanan ---- */

/* ---- aturan utama: kode hangus begitu dipakai memesan ---- */

test("kode langsung hangus setelah 1 pesanan, walau baru 10 detik", () => {
  const entry = {
    used: true,
    usedAt: new Date(SEKARANG - 10_000).toISOString(),
    submissions: 1,
  };
  const v = evaluateRedemption(entry, { now: SEKARANG, graceMs: GRACE, maxSubmissions: 1 });
  assert.equal(v.status, STATUS.SPENT, "waktu tidak menyelamatkan kode yang sudah dipakai");
});

test("sebelum memesan, pembeli boleh masuk-keluar berkali-kali", () => {
  // ini yang melindungi pembeli saat mengisi alamat lalu tab-nya reload
  const entry = { used: true, usedAt: new Date(SEKARANG).toISOString(), submissions: 0 };
  for (let i = 0; i < 8; i++) {
    const v = evaluateRedemption(entry, {
      now: SEKARANG + i * 5 * 60 * 1000, // tiap 5 menit
      graceMs: GRACE, maxSubmissions: 1,
    });
    assert.equal(v.status, STATUS.REENTRY, `percobaan ke-${i + 1} harus tetap boleh`);
  }
});

test("kode hangus menyebutkan nomor pesanan untuk keperluan komplain", () => {
  const entry = { used: true, usedAt: new Date(SEKARANG).toISOString(), submissions: 1,
                  lastRef: "OSC260819-A3F9C1" };
  const v = evaluateRedemption(entry, { now: SEKARANG, graceMs: GRACE, maxSubmissions: 1 });
  assert.equal(v.status, STATUS.SPENT);
  assert.equal(v.ref, "OSC260819-A3F9C1");
});

test("batas pesanan bisa dinaikkan lewat setelan (mis. paket 2 strip)", () => {
  const entry = { used: true, usedAt: new Date(SEKARANG).toISOString(), submissions: 1 };
  assert.equal(
    evaluateRedemption(entry, { now: SEKARANG, graceMs: GRACE, maxSubmissions: 2 }).status,
    STATUS.REENTRY, "masih sisa 1 jatah"
  );
  entry.submissions = 2;
  assert.equal(
    evaluateRedemption(entry, { now: SEKARANG, graceMs: GRACE, maxSubmissions: 2 }).status,
    STATUS.SPENT
  );
});

test("urutan benar: sudah memesan diperiksa sebelum batas waktu", () => {
  // kode dipakai memesan, lalu lewat batas waktu juga → tetap SPENT, bukan USED
  const entry = { used: true, usedAt: new Date(SEKARANG - 100 * JAM).toISOString(), submissions: 1 };
  const v = evaluateRedemption(entry, { now: SEKARANG, graceMs: GRACE, maxSubmissions: 1 });
  assert.equal(v.status, STATUS.SPENT, "pesan ke pembeli harus 'sudah dipakai memesan'");
});

/* ================= pengikatan perangkat (anti kode dibagikan) ================= */

const perangkat = (devices, submissions = 0) => ({
  used: true,
  usedAt: new Date(SEKARANG - 60_000).toISOString(),
  submissions,
  devices,
});

test("perangkat: penukaran pertama mengklaim kode", () => {
  const v = evaluateRedemption({ used: false }, { now: SEKARANG, deviceId: "HP-A" });
  assert.equal(v.status, STATUS.OK);
  assert.equal(v.claimDevice, "HP-A", "perangkat pertama harus dicatat");
});

test("perangkat: perangkat yang sama boleh masuk lagi", () => {
  const v = evaluateRedemption(perangkat(["HP-A"]), { now: SEKARANG, deviceId: "HP-A" });
  assert.equal(v.status, STATUS.REENTRY, "pemilik sah tidak boleh terkunci");
});

test("perangkat: KODE DIBAGIKAN → perangkat lain ditolak", () => {
  // inti masalahnya: kode disebar di kolom komentar
  const v = evaluateRedemption(perangkat(["HP-A"]), { now: SEKARANG, deviceId: "HP-ORANG-LAIN" });
  assert.equal(v.status, STATUS.OTHER_DEVICE);
});

test("perangkat: 10 orang lain mencoba kode yang sama → semuanya ditolak", () => {
  const entry = perangkat(["HP-A"]);
  for (let i = 0; i < 10; i++) {
    const v = evaluateRedemption(entry, { now: SEKARANG, deviceId: "PENUMPANG-" + i });
    assert.equal(v.status, STATUS.OTHER_DEVICE, `penumpang ke-${i + 1} lolos!`);
  }
});

test("perangkat: tanpa ID (mode privat / mencoba menghindar) tetap ditolak", () => {
  const v = evaluateRedemption(perangkat(["HP-A"]), { now: SEKARANG, deviceId: null });
  assert.equal(v.status, STATUS.OTHER_DEVICE);
});

test("perangkat: setelah ikatan dilepas admin, perangkat baru boleh masuk", () => {
  const v = evaluateRedemption(perangkat([]), { now: SEKARANG, deviceId: "HP-BARU" });
  assert.equal(v.status, STATUS.REENTRY, "jalan keluar untuk pembeli sah harus jalan");
});

test("perangkat: kode yang sudah memesan tetap SPENT, bukan OTHER_DEVICE", () => {
  // pesan ke pembeli harus akurat: "sudah dipakai memesan", bukan "perangkat lain"
  const v = evaluateRedemption(perangkat(["HP-A"], 1), { now: SEKARANG, deviceId: "HP-B" });
  assert.equal(v.status, STATUS.SPENT);
});

test("perangkat: batas bisa dilonggarkan lewat setelan", () => {
  const v = evaluateRedemption(perangkat(["HP-A"]), {
    now: SEKARANG, deviceId: "HP-B", maxDevices: 2,
  });
  assert.equal(v.status, STATUS.REENTRY, "dengan maxDevices=2, perangkat kedua boleh");
});

/* ---- BUG NYATA: deviceId tidak terkirim → kode jadi tidak terikat ---- */

test("BUG LAMA: kode tanpa daftar perangkat tidak boleh bebas dipakai", () => {
  // Dulu penukaran pertama menyimpan devices:[] kalau deviceId kosong,
  // sehingga SEMUA browser lain lolos. Sekarang server selalu mengisi ID.
  const entry = perangkat(["HP-A"]);
  for (const penyusup of ["HP-B", "HP-C", null, undefined, ""]) {
    const v = evaluateRedemption(entry, {
      now: SEKARANG, deviceId: penyusup, maxDevices: 1,
    });
    assert.equal(v.status, STATUS.OTHER_DEVICE, `perangkat ${penyusup} lolos!`);
  }
});

test("perangkat: dengan batas 2, browser ke-3 ditolak", () => {
  const entry = perangkat(["HP-A", "HP-B"]);
  assert.equal(
    evaluateRedemption(entry, { now: SEKARANG, deviceId: "HP-C", maxDevices: 2 }).status,
    STATUS.OTHER_DEVICE
  );
  // dua yang terdaftar tetap boleh
  for (const d of ["HP-A", "HP-B"]) {
    assert.equal(
      evaluateRedemption(entry, { now: SEKARANG, deviceId: d, maxDevices: 2 }).status,
      STATUS.REENTRY
    );
  }
});

test("frontend WAJIB mengirim deviceId di semua panggilan redeem", () => {
  const fs = require("fs");
  const path = require("path");
  const html = fs.readFileSync(
    path.join(__dirname, "..", "public", "booth.html"), "utf8"
  );
  const panggilan = [...html.matchAll(/fetch\("\/api\/redeem"[\s\S]{0,320}?\)\}\);/g)];
  assert.ok(panggilan.length >= 2, "harus ada minimal 2 tempat memanggil /api/redeem");
  for (const p of panggilan) {
    assert.ok(
      p[0].includes("deviceId"),
      "ada panggilan /api/redeem tanpa deviceId — pengikatan perangkat jadi mati"
    );
  }
});
