const test = require("node:test");
const assert = require("node:assert/strict");
const { createStore } = require("../lib/ratelimit");

test("ratelimit: memblokir setelah melewati batas", () => {
  const s = createStore();
  const hasil = [];
  for (let i = 0; i < 15; i++) hasil.push(s.hit("redeem:1.1.1.1", 60000, 12).allowed);
  assert.equal(hasil.filter(Boolean).length, 12, "tepat 12 yang lolos");
  assert.equal(hasil.slice(12).every((v) => v === false), true);
});

test("ratelimit: IP berbeda dihitung terpisah", () => {
  const s = createStore();
  for (let i = 0; i < 12; i++) s.hit("redeem:1.1.1.1", 60000, 12);
  assert.equal(s.hit("redeem:1.1.1.1", 60000, 12).allowed, false);
  assert.equal(s.hit("redeem:2.2.2.2", 60000, 12).allowed, true, "IP lain tidak ikut kena");
});

test("ratelimit: endpoint berbeda dihitung terpisah", () => {
  const s = createStore();
  for (let i = 0; i < 12; i++) s.hit("redeem:1.1.1.1", 60000, 12);
  assert.equal(s.hit("upload:1.1.1.1", 60000, 12).allowed, true);
});

test("ratelimit: jatah pulih setelah jendela waktu lewat", () => {
  let now = 1_000_000;
  const s = createStore(() => now);
  for (let i = 0; i < 12; i++) s.hit("k:ip", 60000, 12);
  assert.equal(s.hit("k:ip", 60000, 12).allowed, false);

  now += 60001; // lewat 1 menit
  assert.equal(s.hit("k:ip", 60000, 12).allowed, true, "harus pulih");
});

test("ratelimit: retryAfter masuk akal (detik)", () => {
  let now = 1_000_000;
  const s = createStore(() => now);
  for (let i = 0; i < 5; i++) s.hit("k:ip", 60000, 5);
  now += 20000;
  const r = s.hit("k:ip", 60000, 5);
  assert.equal(r.allowed, false);
  assert.equal(r.retryAfter, 40, "sisa 40 detik");
});

test("ratelimit: sweep membersihkan bucket kedaluwarsa", () => {
  let now = 1_000_000;
  const s = createStore(() => now);
  s.hit("a:ip", 1000, 5);
  s.hit("b:ip", 90000, 5);
  assert.equal(s.size(), 2);

  now += 2000;
  const dihapus = s.sweep();
  assert.equal(dihapus, 1, "hanya yang lewat waktu dihapus");
  assert.equal(s.size(), 1);
});

/* ---------------- aturan penukaran & batas pesanan ---------------- */

test("redeem: kode hanya bisa dipakai satu kali", () => {
  const codes = { "OSC-AAA111": { used: false, issued: true } };
  const pakai = (kode) => {
    const e = codes[kode];
    if (!e) return "INVALID";
    if (e.used) return "USED";
    e.used = true;
    return "OK";
  };
  assert.equal(pakai("OSC-AAA111"), "OK");
  assert.equal(pakai("OSC-AAA111"), "USED", "penukaran kedua harus ditolak");
  assert.equal(pakai("OSC-TIDAKADA"), "INVALID");
});

test("batas pesanan studio per kode dihormati", () => {
  const MAX = 2;
  const entry = { used: true, submissions: 0 };
  const kirim = () => {
    if ((entry.submissions || 0) >= MAX) return "SUBMISSION_LIMIT";
    entry.submissions++;
    return "OK";
  };
  assert.equal(kirim(), "OK");
  assert.equal(kirim(), "OK");
  assert.equal(kirim(), "SUBMISSION_LIMIT", "melebihi jatah harus ditolak");
  assert.equal(entry.submissions, 2);
});

/* ---- IP ≠ perangkat: perlindungan tidak boleh memblokir pembeli sah ---- */

test("ratelimit: penukaran BERHASIL tidak memakan jatah (pola hanya-gagal)", () => {
  const { createStore } = require("../lib/ratelimit");
  const s = createStore();
  const key = "redeem-fail:1.1.1.1";

  // 30 pembeli sah di balik satu IP operator (CGNAT) — semuanya berhasil
  for (let i = 0; i < 30; i++) {
    assert.equal(s.check(key, 900000, 15).allowed, true, `pembeli ke-${i + 1} terblokir`);
    s.reset(key); // berhasil → hitungan dibersihkan
  }
});

test("ratelimit: percobaan GAGAL beruntun tetap diblokir", () => {
  const { createStore } = require("../lib/ratelimit");
  const s = createStore();
  const key = "redeem-fail:9.9.9.9";

  for (let i = 0; i < 15; i++) s.penalize(key, 900000, 15);
  assert.equal(s.check(key, 900000, 15).allowed, false, "penebak kode harus berhenti");
});

test("ratelimit: satu penebak tidak memblokir IP lain", () => {
  const { createStore } = require("../lib/ratelimit");
  const s = createStore();
  for (let i = 0; i < 15; i++) s.penalize("redeem-fail:9.9.9.9", 900000, 15);
  assert.equal(s.check("redeem-fail:8.8.8.8", 900000, 15).allowed, true);
});

test("ratelimit: kuota render dihitung per KODE, bukan per IP", () => {
  const { createStore } = require("../lib/ratelimit");
  const s = createStore();
  // dua pembeli berbeda di balik IP operator yang sama
  for (let i = 0; i < 30; i++) s.hit("render-code:OSC-AAA", 3600000, 30);
  assert.equal(s.hit("render-code:OSC-AAA", 3600000, 30).allowed, false, "kode A habis");
  assert.equal(s.hit("render-code:OSC-BBB", 3600000, 30).allowed, true,
    "kode B TIDAK boleh ikut terblokir walau satu IP");
});
