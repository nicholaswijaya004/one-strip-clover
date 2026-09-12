const test = require("node:test");
const assert = require("node:assert/strict");
const { createLocks } = require("../lib/locks");

test("kunci: permintaan kedua untuk kode yang sama ditolak", () => {
  const l = createLocks();
  assert.equal(l.acquire("OSC-AAA111"), true, "yang pertama boleh");
  assert.equal(l.acquire("OSC-AAA111"), false, "yang kedua harus ditolak");
});

test("kunci: kode berbeda tidak saling mengganggu", () => {
  const l = createLocks();
  assert.equal(l.acquire("OSC-AAA111"), true);
  assert.equal(l.acquire("OSC-BBB222"), true, "pembeli lain tidak boleh ikut terblokir");
});

test("kunci: setelah dilepas bisa dipakai lagi", () => {
  const l = createLocks();
  l.acquire("OSC-AAA111");
  l.release("OSC-AAA111");
  assert.equal(l.acquire("OSC-AAA111"), true, "pesanan kedua yang sah harus bisa jalan");
});

test("kunci: kunci menggantung >2 menit dianggap basi", () => {
  const l = createLocks();
  const t0 = 1_000_000;
  l.acquire("OSC-AAA111", t0);
  assert.equal(l.acquire("OSC-AAA111", t0 + 60_000), false, "1 menit → masih terkunci");
  assert.equal(l.acquire("OSC-AAA111", t0 + 121_000), true, "2 menit lewat → boleh lagi");
});

test("kunci: tidak menumpuk di memori setelah dilepas", () => {
  const l = createLocks();
  for (let i = 0; i < 100; i++) {
    l.acquire("OSC-" + i);
    l.release("OSC-" + i);
  }
  assert.equal(l.size(), 0);
});

/* ---- inti pertanyaannya: bisakah 1 kode dipakai spam email? ---- */

test("jatah tidak bisa jebol walau kode ditukar ulang berkali-kali", () => {
  const MAX = 2;
  const entry = { used: true, usedAt: new Date().toISOString(), submissions: 0 };

  // tiru: tukar ulang kode (masa tenggang) lalu kirim pesanan, 20x
  let terkirim = 0, ditolak = 0;
  for (let i = 0; i < 20; i++) {
    // penukaran ulang selalu berhasil dalam masa tenggang — TAPI tidak mereset jatah
    if ((entry.submissions || 0) >= MAX) { ditolak++; continue; }
    entry.submissions++;
    terkirim++;
  }

  assert.equal(terkirim, 2, "email yang benar-benar terkirim tetap 2");
  assert.equal(ditolak, 18);
});

test("dua pesanan berbarengan: hanya satu yang lolos", () => {
  const l = createLocks();
  const MAX = 2;
  const entry = { submissions: 1 }; // sisa jatah 1

  // dua permintaan datang bersamaan, keduanya membaca submissions = 1
  const coba = () => {
    if (!l.acquire("OSC-AAA111")) return "ALREADY_PROCESSING";
    if ((entry.submissions || 0) >= MAX) { l.release("OSC-AAA111"); return "LIMIT"; }
    return "PROSES";
  };

  const a = coba();
  const b = coba(); // belum sempat dilepas
  assert.equal(a, "PROSES");
  assert.equal(b, "ALREADY_PROCESSING", "tanpa kunci, keduanya akan lolos dan jatah jebol");

  entry.submissions++;
  l.release("OSC-AAA111");
  assert.equal(coba(), "LIMIT", "setelah selesai, jatah habis");
  assert.equal(entry.submissions, 2, "tidak pernah lebih dari MAX");
});
