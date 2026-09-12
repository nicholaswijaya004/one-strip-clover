require("./_setup").pakaiDataSementara();
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const queue = require("../lib/queue");

const bersihkan = () => {
  for (const d of [queue.DIR, queue.GAGAL_DIR]) {
    if (fs.existsSync(d)) for (const f of fs.readdirSync(d)) fs.unlinkSync(path.join(d, f));
  }
};

test.beforeEach(bersihkan);
test.after(bersihkan);

test("antrean: pesanan gagal tersimpan, tidak hilang", () => {
  queue.park("OSC260820-A1", { code: "OSC-AAA", photos: ["x"] });
  assert.equal(queue.stats().menunggu, 1);
  const data = queue.baca(queue.daftar()[0]);
  assert.equal(data.ref, "OSC260820-A1");
  assert.equal(data.payload.code, "OSC-AAA");
});

test("antrean: nama berkas aman dari karakter berbahaya", () => {
  queue.park("../../etc/passwd", { code: "X" });
  const berkas = queue.daftar()[0];
  assert.ok(!path.basename(berkas).includes("/"), "path traversal harus dicegah");
});

test("antrean: berhasil dikirim ulang → berkas dihapus", async () => {
  queue.park("OSC260820-A2", { code: "OSC-BBB" });
  const stop = queue.mulaiRetryLoop(async () => ({ ok: true }), { jedaMenit: 0.001 });
  await new Promise((r) => setTimeout(r, 120));
  stop();
  assert.equal(queue.stats().menunggu, 0, "pesanan berhasil harus keluar dari antrean");
});

test("antrean: gagal terus → tetap tersimpan untuk dicoba lagi", async () => {
  queue.park("OSC260820-A3", { code: "OSC-CCC" });
  const stop = queue.mulaiRetryLoop(async () => ({ ok: false, errors: ["smtp mati"] }), {
    jedaMenit: 0.001,
  });
  await new Promise((r) => setTimeout(r, 120));
  stop();
  assert.equal(queue.stats().menunggu, 1, "jangan dibuang selama masih dalam batas usia");
  const data = queue.baca(queue.daftar()[0]);
  assert.ok(data.percobaan >= 1, "hitungan percobaan harus bertambah");
  assert.match(data.errorTerakhir, /smtp mati/);
});

test("antrean: lewat batas usia → dipindah ke folder gagal (bukan dihapus)", async () => {
  const berkas = queue.park("OSC260820-A4", { code: "OSC-DDD" });
  // buat seolah dibuat 48 jam lalu
  const data = queue.baca(berkas);
  data.dibuatPada = new Date(Date.now() - 48 * 3600 * 1000).toISOString();
  fs.writeFileSync(berkas, JSON.stringify(data));

  const stop = queue.mulaiRetryLoop(async () => ({ ok: false }), {
    jedaMenit: 0.001, maxUsiaJam: 24,
  });
  await new Promise((r) => setTimeout(r, 120));
  stop();

  const s = queue.stats();
  assert.equal(s.menunggu, 0);
  assert.equal(s.gagalPermanen, 1, "data pembeli tetap disimpan untuk diproses manual");
});

test("antrean: berkas rusak dibuang, tidak menghentikan proses", async () => {
  queue.park("OSC260820-A5", { code: "OSC-EEE" });
  fs.writeFileSync(queue.daftar()[0], "{ rusak");
  const stop = queue.mulaiRetryLoop(async () => ({ ok: true }), { jedaMenit: 0.001 });
  await new Promise((r) => setTimeout(r, 120));
  stop();
  assert.equal(queue.stats().menunggu, 0);
});
