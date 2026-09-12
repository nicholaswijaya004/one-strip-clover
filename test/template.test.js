const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const tpl = require("../lib/template");
const renderer = require("../public/shared/strip-renderer.js");

const bersih = () => {
  try {
    if (fs.existsSync(tpl.DIR)) {
      for (const f of fs.readdirSync(tpl.DIR)) fs.unlinkSync(path.join(tpl.DIR, f));
    }
  } catch {}
};
test.beforeEach(bersih);
test.after(bersih);

const PNG = () => Buffer.from("89504e470d0a1a0a", "hex");

/* ------------------------- pustaka banyak template ------------------------- */

test("template: bisa menyimpan lebih dari satu", async () => {
  await tpl.tambah(PNG(), "image/png", { lebarPx: 663, tinggiPx: 2026 }, "Sky");
  await tpl.tambah(PNG(), "image/png", { lebarPx: 663, tinggiPx: 2026 }, "Lebaran");
  const d = tpl.daftar();
  assert.equal(d.length, 2);
  assert.deepEqual(d.map((t) => t.nama).sort(), ["Lebaran", "Sky"]);
});

test("template: tiap template punya id unik & berkasnya sendiri", async () => {
  const a = await tpl.tambah(PNG(), "image/png", {}, "A");
  const b = await tpl.tambah(PNG(), "image/png", {}, "B");
  assert.notEqual(a.id, b.id);
  assert.notEqual(a.file, b.file);
  assert.equal(fs.readdirSync(tpl.DIR).filter((f) => f.endsWith(".png")).length, 2);
});

test("template: layout tiap template terpisah (ubah satu tak merusak lain)", async () => {
  const a = await tpl.tambah(PNG(), "image/png", {}, "A");
  const b = await tpl.tambah(PNG(), "image/png", {}, "B");
  await tpl.ubah(a.id, { layout: { topMm: 30 } });
  assert.equal(tpl.cari(a.id).layout.topMm, 30);
  assert.equal(tpl.cari(b.id).layout.topMm, tpl.LAYOUT_BAWAAN.topMm, "B tidak boleh ikut berubah");
});

test("template: ubah nama", async () => {
  const a = await tpl.tambah(PNG(), "image/png", {}, "Lama");
  await tpl.ubah(a.id, { nama: "Baru" });
  assert.equal(tpl.cari(a.id).nama, "Baru");
});

test("template: hapus satu, yang lain tetap ada", async () => {
  const a = await tpl.tambah(PNG(), "image/png", {}, "A");
  const b = await tpl.tambah(PNG(), "image/png", {}, "B");
  await tpl.hapus(a.id);
  const d = tpl.daftar();
  assert.equal(d.length, 1);
  assert.equal(d[0].id, b.id);
  assert.equal(tpl.cari(a.id), null);
  assert.equal(fs.existsSync(path.join(tpl.DIR, a.file)), false, "berkas ikut terhapus");
});

test("template: gambar bisa diambil per id", async () => {
  const a = await tpl.tambah(PNG(), "image/png", {}, "A");
  assert.ok(tpl.berkas(a.id).buffer.length > 0);
  assert.equal(tpl.berkas("tidak-ada"), null);
});

test("template: batas jumlah dijaga", async () => {
  for (let i = 0; i < tpl.MAKS_TEMPLATE; i++) await tpl.tambah(PNG(), "image/png", {}, "T" + i);
  await assert.rejects(() => tpl.tambah(PNG(), "image/png", {}, "kelebihan"), /maksimal/);
});

test("template: nama dibersihkan & dipotong", async () => {
  const a = await tpl.tambah(PNG(), "image/png", {}, "  Lebaran <2026>\n  ");
  assert.equal(tpl.cari(a.id).nama, "Lebaran 2026");
});

test("template: nama kosong → diberi nama otomatis", async () => {
  const a = await tpl.tambah(PNG(), "image/png", {}, "");
  assert.ok(tpl.cari(a.id).nama.startsWith("Template"));
});

test("template: layout kebesaran ditandai tidak muat", async () => {
  const a = await tpl.tambah(PNG(), "image/png", {}, "A");
  const m = await tpl.ubah(a.id, { layout: { photoHmm: 60 } });
  assert.equal(m.muat, false);
  assert.ok(m.sisaBawahMm < 0);
});

test("template: nilai di luar batas dipotong server", async () => {
  const a = await tpl.tambah(PNG(), "image/png", {}, "A");
  const m = await tpl.ubah(a.id, { layout: { photoWmm: 999 } });
  assert.equal(m.layout.photoWmm, tpl.STRIP_W_MM, "dibatasi selebar strip");
});

test("renderer: tinggi strip mengikuti rasio fisik 56,1 : 171,5", () => {
  const W = 600;
  assert.ok(Math.abs(renderer.templateStripHeight(W) / W - 171.5 / 56.1) < 0.01);
});

test("renderer: posisi foto template dihitung dalam MILIMETER", () => {
  const pos = (W) => {
    const kotak = [];
    renderer.drawStripWithTemplate(mockDraw(kotak), [{ width: 100, height: 80 }], {
      width: W, layout: tpl.LAYOUT_BAWAAN, filter: "warna",
    });
    return kotak.map((k) => ({ y: k.y / W, w: k.w / W }));
  };
  const a = pos(600), b = pos(1200);
  assert.equal(a.length, 3);
  for (let i = 0; i < 3; i++) {
    assert.ok(Math.abs(a[i].y - b[i].y) < 0.001, "posisi harus sama antar resolusi");
  }
});

test("bingkai bawaan & template memakai LAYOUT_BAWAAN yang sama", () => {
  assert.deepEqual(renderer.LAYOUT_BAWAAN, tpl.LAYOUT_BAWAAN);
});

function mockDraw(kotak) {
  const noop = () => {};
  return {
    save: noop, restore: noop, translate: noop, rotate: noop, scale: noop,
    fillRect: noop, strokeRect: noop, beginPath: noop, arc: noop, ellipse: noop,
    fill: noop, stroke: noop, lineTo: noop, moveTo: noop, setLineDash: noop, fillText: noop,
    drawImage(img, ...a) { if (a.length === 8) kotak.push({ x: a[4], y: a[5], w: a[6], h: a[7] }); },
    set filter(v) {}, get filter() { return ""; },
    set fillStyle(v) {}, set strokeStyle(v) {}, set lineWidth(v) {},
    set font(v) {}, set textAlign(v) {},
  };
}

test("halaman: template muncul sebagai pilihan di baris Bingkai", () => {
  const { execFileSync } = require("child_process");
  const out = execFileSync("node", [
    path.join(__dirname, "..", "scripts", "simulasi-browser.js"),
  ], { encoding: "utf8", env: { ...process.env, UJI_TEMPLATE: "1" } });
  assert.match(out, /SEMUA LULUS/, "template tidak muncul sebagai bingkai:\n" + out);
});

/* ---------------- huruf vektor untuk template bertulisan ---------------- */

test("font: semua huruf yang dipakai template punya bentuk", () => {
  const { GLYPHS } = require("../lib/vector-font");
  const teks = "ONE STRIP CLOVER COLLECT MOMENTS, NOT THINGS @ONESTRIPCLOVER ·";
  for (const ch of teks.toUpperCase()) {
    assert.ok(GLYPHS[ch] !== undefined, `huruf "${ch}" belum ada bentuknya`);
  }
});

test("font: lebar teks bertambah sesuai panjang & ukuran", () => {
  const { ukurTeks } = require("../lib/vector-font");
  assert.ok(ukurTeks("AB", 100) > ukurTeks("A", 100), "makin panjang makin lebar");
  assert.ok(ukurTeks("A", 200) > ukurTeks("A", 100), "makin besar makin lebar");
});

test("template contoh: ukurannya persis 663 x 2026 px", () => {
  const { execFileSync } = require("child_process");
  const root = path.join(__dirname, "..");
  execFileSync("node", [
    path.join(root, "scripts", "make-template.js"), "--warna=clover", "--tekstur=kertas",
  ], { encoding: "utf8" });
  const f = path.join(root, "contoh-template-clover-kertas.png");
  const d = fs.readFileSync(f);
  assert.equal(d.slice(1, 4).toString(), "PNG", "harus berkas PNG");
  const w = d.readUInt32BE(16), h = d.readUInt32BE(20);
  assert.equal(w, 663);
  assert.equal(h, 2026);
  assert.ok(Math.abs(h / w - 171.5 / 56.1) < 0.01, "rasio strip");
});

/* -------------------- huruf sambung (skrip) -------------------- */

test("skrip: huruf yang dipakai judul & quote tersedia", () => {
  const { SKRIP } = require("../lib/script-font");
  const teks = "One Strip Clover Collect moments, not things @";
  for (const ch of teks) {
    assert.ok(SKRIP[ch] || SKRIP[ch.toLowerCase()], `huruf "${ch}" belum ada`);
  }
});

test("skrip: lebar teks masuk akal & bertambah sesuai ukuran", () => {
  const { ukurSkrip } = require("../lib/script-font");
  assert.ok(ukurSkrip("One", 100) > 0);
  assert.ok(ukurSkrip("One Strip Clover", 100) > ukurSkrip("One", 100));
  assert.ok(ukurSkrip("One", 200) > ukurSkrip("One", 100));
});

test("skrip: goresan punya tebal berubah (kesan pena, bukan garis rata)", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "lib", "script-font.js"), "utf8");
  assert.ok(src.includes("goresKaligrafi"), "harus ada goresan kaligrafi");
  assert.ok(src.includes("Math.sin(sudut"), "tebal harus bergantung arah goresan");
  assert.ok(src.includes("MIRING"), "huruf harus dicondongkan");
});

/* ------------------------- tekstur latar ------------------------- */

test("tekstur: latar TIDAK rata (ada serat & butiran)", () => {
  const { latarBertekstur } = require("../lib/texture");
  const warna = new Set();
  const kanvas = { set(x, y, r, g, b) { warna.add(`${r},${g},${b}`); } };
  latarBertekstur(kanvas, 60, 60, { warna: [246, 242, 228], jenis: "kertas", benih: 1 });
  assert.ok(warna.size > 50, `hanya ${warna.size} warna — latar masih terlalu rata`);
});

test("tekstur: 'polos' tetap tersedia untuk desain minimalis", () => {
  const { latarBertekstur } = require("../lib/texture");
  const warna = new Set();
  const kanvas = { set(x, y, r, g, b) { warna.add(`${r},${g},${b}`); } };
  latarBertekstur(kanvas, 40, 40, { warna: [200, 200, 200], jenis: "polos", kuat: 0, benih: 1 });
  assert.ok(warna.size <= 3, "mode polos harus nyaris satu warna");
});

test("tekstur: hasilnya bisa diulang (benih sama → gambar sama)", () => {
  const { latarBertekstur } = require("../lib/texture");
  const ambil = () => {
    const p = [];
    latarBertekstur({ set: (x, y, r, g, b) => p.push(r, g, b) }, 20, 20,
      { warna: [240, 240, 230], jenis: "linen", benih: 99 });
    return p.join(",");
  };
  assert.equal(ambil(), ambil(), "template yang sama harus selalu identik");
});
