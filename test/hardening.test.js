require("./_setup").pakaiDataSementara();
/**
 * Tes unit untuk modul pengerasan: validasi gambar, identitas rate limit,
 * pembatas paralel, validasi konfigurasi, cache penyimpanan, antrean.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const dir = process.env.DATA_DIR;
const images = require("../lib/images");
const { clientKey } = require("../lib/http/middleware");
const { createLimiter } = require("../lib/limiter");
const env = require("../lib/env");
const { createJsonStore } = require("../lib/store");
const codeLib = require("../lib/codes");

function jpeg(w, h) {
  const sof = Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08, h >> 8, h & 255, w >> 8, w & 255, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), sof, Buffer.from([0xff, 0xd9])]);
}
function png(w, h) {
  const b = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8);
  b.write("IHDR", 12, "latin1");
  b.writeUInt32BE(w, 16);
  b.writeUInt32BE(h, 20);
  return b;
}
const url = (buf, mime = "image/jpeg") => `data:${mime};base64,${buf.toString("base64")}`;

/* ------------------------------ gambar ------------------------------ */

test("gambar: JPEG & PNG sah diterima, ukuran dibaca dari header", () => {
  const a = images.parseImageDataUrl(url(jpeg(1280, 1024)));
  assert.deepEqual([a.mime, a.width, a.height], ["image/jpeg", 1280, 1024]);
  const b = images.parseImageDataUrl(url(png(663, 2026), "image/png"));
  assert.deepEqual([b.mime, b.width, b.height], ["image/png", 663, 2026]);
});

test("gambar: bom dekompresi ditolak sebelum decode", () => {
  assert.throws(() => images.parseImageDataUrl(url(jpeg(30000, 30000))), /dimensi/);
  assert.throws(() => images.parseImageDataUrl(url(png(5000, 5000), "image/png")), /dimensi/);
});

test("gambar: isi palsu ditolak walau label data URL-nya image/jpeg", () => {
  for (const isi of ["<html>", "MZ\x90\x00", "%PDF-1.4", ""]) {
    assert.throws(() => images.parseImageDataUrl(url(Buffer.from(isi))));
  }
  assert.throws(() => images.parseImageDataUrl("data:text/html;base64,PGh0bWw+"));
  assert.throws(() => images.parseImageDataUrl({}));
  assert.throws(() => images.parseImageDataUrl(null));
});

test("gambar: jenis yang tidak diizinkan ditolak (strip wajib JPEG)", () => {
  assert.throws(
    () => images.parseImageDataUrl(url(png(100, 300), "image/png"), { allowed: ["image/jpeg"] }),
    /tidak diizinkan/
  );
});

test("gambar: terlalu besar ditolak dari panjang base64 (tanpa alokasi)", () => {
  const raksasa = "data:image/jpeg;base64," + "A".repeat(12 * 1024 * 1024);
  assert.throws(() => images.parseImageDataUrl(raksasa), /terlalu besar/);
});

/* --------------------------- identitas klien --------------------------- */

test("rate limit: IPv6 dikelompokkan per /64, IPv4 utuh", () => {
  assert.equal(clientKey("2001:db8:1:2::1"), clientKey("2001:db8:1:2:ffff:ffff:ffff:ffff"));
  assert.notEqual(clientKey("2001:db8:1:2::1"), clientKey("2001:db8:1:3::1"));
  assert.equal(clientKey("2001:0db8:0001:0002:0:0:0:1"), clientKey("2001:db8:1:2::9"));
  assert.equal(clientKey("::ffff:10.1.2.3"), "10.1.2.3");
  assert.equal(clientKey("10.1.2.3"), "10.1.2.3");
  assert.equal(clientKey(undefined), "unknown");
});

/* ------------------------------ limiter ------------------------------ */

test("limiter: menolak kelebihan, pulih setelah dilepas", () => {
  const l = createLimiter(2);
  assert.equal(l.tryAcquire(), true);
  assert.equal(l.tryAcquire(), true);
  assert.equal(l.tryAcquire(), false);
  l.release();
  assert.equal(l.tryAcquire(), true);
  l.release(); l.release(); l.release(); // lepas berlebih tidak membuat negatif
  assert.equal(l.active, 0);
  assert.throws(() => createLimiter(0));
});

/* ------------------------------ konfigurasi ------------------------------ */

test("konfigurasi: produksi MENOLAK rahasia kosong / pendek / kembar", () => {
  const prod = { NODE_ENV: "production" };
  assert.ok(env.checkConfig(prod).errors.some((e) => /SESSION_SECRET/.test(e)));
  assert.ok(env.checkConfig({ ...prod, SESSION_SECRET: "pendek" }).errors.length > 0);
  const k = "x".repeat(40);
  assert.ok(env.checkConfig({ ...prod, SESSION_SECRET: k, ADMIN_KEY: k }).errors
    .some((e) => /sama/.test(e)));
  assert.ok(env.checkConfig({ ...prod, SESSION_SECRET: k, ADMIN_KEY: "123" }).errors
    .some((e) => /ADMIN_KEY/.test(e)));
  assert.deepEqual(
    env.checkConfig({ ...prod, SESSION_SECRET: k, ADMIN_KEY: "y".repeat(20) }).errors, []
  );
});

test("konfigurasi: di luar produksi hanya peringatan, rahasia acak dibuat", () => {
  const r = env.checkConfig({});
  assert.deepEqual(r.errors, []);
  assert.ok(r.warnings.length > 0);
  assert.ok(r.sessionSecret.length >= 32);
});

test("konfigurasi: TRUST_PROXY", () => {
  assert.equal(env.parseTrustProxy(undefined), 1);
  assert.equal(env.parseTrustProxy("false"), false);
  assert.equal(env.parseTrustProxy("2"), 2);
  assert.equal(env.parseTrustProxy("semua"), undefined);
  assert.ok(env.checkConfig({ NODE_ENV: "production", TRUST_PROXY: "true" }).errors
    .some((e) => /TRUST_PROXY/.test(e)));
});

/* ------------------------------ penyimpanan ------------------------------ */

test("store: cache dipakai, tapi tulisan dari proses lain tetap terlihat", () => {
  const f = path.join(dir, "cache-uji.json");
  const st = createJsonStore(f);
  st._writeSync({ a: 1 });
  const x = st.read();
  assert.equal(st.read(), x, "bacaan kedua tanpa perubahan = objek cache yang sama");

  // proses lain (npm run codes) menulis berkas langsung
  fs.writeFileSync(f, JSON.stringify({ a: 2, b: 3 }));
  assert.deepEqual(st.read(), { a: 2, b: 3 });
});

test("store: mutator gagal → cache dibuang, isi disk tidak berubah", async () => {
  const f = path.join(dir, "cache-gagal.json");
  const st = createJsonStore(f);
  st._writeSync({ n: 1 });
  await assert.rejects(st.update((d) => { d.n = 999; throw new Error("gagal"); }));
  assert.equal(st.read().n, 1);
});

/* ------------------------------ kode ------------------------------ */

test("kode: 8 karakter dari alfabet tanpa huruf mirip, sebaran merata", () => {
  const hitung = {};
  for (let i = 0; i < 4000; i++) {
    const c = codeLib.randomCode().split("-")[1];
    assert.equal(c.length, codeLib.PANJANG_KODE);
    for (const ch of c) hitung[ch] = (hitung[ch] || 0) + 1;
  }
  assert.ok(!/[01ILO]/.test(Object.keys(hitung).join("")));
  const nilai = Object.values(hitung);
  const rata = nilai.reduce((a, b) => a + b, 0) / codeLib.ALPHABET.length;
  // byte % 31 dulu membuat 8 huruf pertama ±12% lebih sering
  for (const v of nilai) assert.ok(Math.abs(v - rata) / rata < 0.2, "sebaran tidak merata");
});

/* ------------------------------ antrean ------------------------------ */

test("antrean: putaran coba-ulang tidak pernah tumpang tindih", async () => {
  const queue = require("../lib/queue");
  queue.park("REF-TUMPANG", { ref: "REF-TUMPANG" });
  let jalanBersamaan = 0, maks = 0, panggilan = 0;
  const kirim = async () => {
    panggilan++;
    jalanBersamaan++; maks = Math.max(maks, jalanBersamaan);
    await new Promise((r) => setTimeout(r, 30));
    jalanBersamaan--;
    return { ok: true };
  };
  const stop = queue.mulaiRetryLoop(kirim, { log: { info() {}, warn() {}, error() {} } });
  await Promise.all([stop.putaran(), stop.putaran(), stop.putaran()]);
  stop();
  assert.equal(maks, 1);
  assert.equal(panggilan, 1, "pesanan yang sama terkirim lebih dari sekali");
});
