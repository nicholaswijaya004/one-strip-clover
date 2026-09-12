const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const index = fs.readFileSync(path.join(root, "public", "booth.html"), "utf8");
const server = fs.readFileSync(path.join(root, "server.js"), "utf8");

// Palet resmi dari company profile
const PALET = {
  clover: "#AEAF4E",
  blush: "#F9E4EB",
  mint: "#86F2EC",
  plum: "#6C4862",
  peri: "#A9BAD6",
};

test("brand: semua warna palet resmi dipakai di stylesheet", () => {
  for (const [nama, hex] of Object.entries(PALET)) {
    assert.ok(index.includes(hex), `warna ${nama} (${hex}) belum dipakai`);
  }
});

test("brand: nama & tagline muncul di halaman", () => {
  assert.ok(index.includes("One Strip Clover"), "wordmark hilang");
  assert.match(index, /one lucky charm/i, "tagline hilang");
});

test("brand: sisa identitas lama sudah dibersihkan", () => {
  assert.ok(!index.includes("FOTOBOX ONLINE"), "masih ada teks FOTOBOX ONLINE");
  assert.ok(!index.includes("Alfa Slab One"), "font lama masih dimuat");
  assert.ok(!server.includes("FOTOBOX ONLINE"), "server masih menyebut brand lama");
});

test("brand: font brand dimuat dari Google Fonts", () => {
  assert.ok(index.includes("Parisienne"), "font skrip belum dimuat");
  assert.ok(index.includes("Montserrat"), "font display belum dimuat");
});

test("brand: bingkai sesuai daftar brand baru", () => {
  // Daftar bingkai kini tinggal di modul bersama (dipakai browser & server)
  const renderer = require("../public/shared/strip-renderer.js");
  const ids = renderer.FRAMES.map((f) => f.id);
  for (const f of ["clover", "linen", "blush", "mint", "plum"]) {
    assert.ok(ids.includes(f), `bingkai ${f} tidak ada`);
  }
  for (const lama of ["brass", "midnight", "bunga"]) {
    assert.ok(!ids.includes(lama), `bingkai lama ${lama} masih ada`);
  }
});

test("brand: daftar bingkai TIDAK ditulis ulang di index.html", () => {
  assert.ok(
    index.includes("StripRenderer.FRAMES"),
    "halaman harus memakai daftar dari modul bersama, bukan salinannya sendiri"
  );
});

test("brand: nomor pesanan & subject email pakai awalan OSC", () => {
  const fmt = require("../lib/format");
  assert.match(fmt.buildRef("abc123"), /^OSC\d{6}-ABC123$/);
});

test("konfigurasi: link toko tidak lagi ditulis di dalam HTML", () => {
  assert.ok(!index.includes("vt.tiktok.com"), "link contoh masih tertinggal di HTML");
  assert.ok(!index.includes("example.com"), "link contoh masih tertinggal di HTML");
  assert.ok(index.includes("/api/config"), "frontend harus mengambil setelan dari server");
});

test("brand: kode akses memakai awalan OSC", () => {
  const lib = require("../lib/codes");
  const kode = lib.generate(3, { writeFile: false }).codes;
  for (const c of kode) assert.match(c, /^OSC-/);
});
