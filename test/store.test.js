const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createJsonStore } = require("../lib/store");

const tmpFile = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), "osc-")), "codes.json");

test("store: tulis lalu baca kembali", async () => {
  const f = tmpFile();
  const s = createJsonStore(f);
  await s.update((d) => { d["OSC-A"] = { used: false }; });
  assert.deepEqual(s.read(), { "OSC-A": { used: false } });
});

test("store: file belum ada → objek kosong, bukan error", () => {
  assert.deepEqual(createJsonStore(tmpFile()).read(), {});
});

test("BUG LAMA: dua perubahan bersamaan tidak saling menimpa", async () => {
  const f = tmpFile();
  const s = createJsonStore(f);
  await s.update((d) => { d["OSC-A"] = { used: false }; d["OSC-B"] = { used: false }; });

  // dua penukaran berbeda dijalankan berbarengan
  await Promise.all([
    s.update(async (d) => { await new Promise(r => setTimeout(r, 20)); d["OSC-A"].used = true; }),
    s.update(async (d) => { d["OSC-B"].used = true; }),
  ]);

  const akhir = s.read();
  assert.equal(akhir["OSC-A"].used, true, "penukaran A hilang tertimpa");
  assert.equal(akhir["OSC-B"].used, true, "penukaran B hilang tertimpa");
});

test("store: 50 perubahan paralel semuanya tercatat", async () => {
  const f = tmpFile();
  const s = createJsonStore(f);
  await Promise.all(
    Array.from({ length: 50 }, (_, i) => s.update((d) => { d["OSC-" + i] = { n: i }; }))
  );
  assert.equal(Object.keys(s.read()).length, 50);
});

test("store: file rusak dipulihkan dari cadangan .bak", async () => {
  const f = tmpFile();
  const s = createJsonStore(f);
  await s.update((d) => { d["OSC-A"] = { used: false }; });
  await s.update((d) => { d["OSC-B"] = { used: false }; }); // membuat .bak

  fs.writeFileSync(f, "{ rusak sekali"); // simulasi file korup
  const pulih = s.read();
  assert.ok(pulih["OSC-A"], "harus memakai cadangan, bukan melempar error");
});

test("store: perubahan yang gagal tidak menghentikan antrean", async () => {
  const f = tmpFile();
  const s = createJsonStore(f);
  await s.update((d) => { d.a = 1; });
  await assert.rejects(s.update(() => { throw new Error("sengaja gagal"); }));
  await s.update((d) => { d.b = 2; });
  assert.deepEqual(s.read(), { a: 1, b: 2 }, "perubahan setelah error tetap jalan");
});

test("store: tidak meninggalkan file .tmp setelah selesai", async () => {
  const f = tmpFile();
  const s = createJsonStore(f);
  await s.update((d) => { d.a = 1; });
  assert.equal(fs.existsSync(f + ".tmp"), false);
});
