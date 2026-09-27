require("./_setup").pakaiDataSementara();
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
// Halaman photobox = HTML + skripnya (dipisah supaya CSP bisa melarang skrip inline)
const index =
  fs.readFileSync(path.join(root, "public", "booth.html"), "utf8") +
  fs.readFileSync(path.join(root, "public", "js", "booth.js"), "utf8");
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
  assert.doesNotMatch(index, /vt\.tiktok\.com/, "link contoh masih tertinggal di HTML");
  assert.doesNotMatch(index, /example\.com/, "link contoh masih tertinggal di HTML");
  assert.ok(index.includes("/api/config"), "frontend harus mengambil setelan dari server");
});

test("brand: kode akses memakai awalan OSC", () => {
  const lib = require("../lib/codes");
  const kode = lib.generate(3, { writeFile: false }).codes;
  for (const c of kode) assert.match(c, /^OSC-/);
});

test("booth (mobile): pesan kamera tetap satu paragraf, tanpa tombol play iOS", () => {
  const booth = fs.readFileSync(path.join(root, "public", "booth.html"), "utf8");
  const js = fs.readFileSync(path.join(root, "public", "js", "booth.js"), "utf8");
  // .lens-msg memakai display:grid — setiap anak langsung jadi baris sendiri,
  // jadi isinya WAJIB dibungkus satu <p> (dulu "Tekan" & "Mulai Sesi" terpisah)
  assert.match(booth, /id="lensMsg"><p>/);
  for (const m of js.match(/lensMsg\.innerHTML\s*=\s*"[^"]*"/g) || []) {
    assert.match(m, /="<p>.*<\/p>"$/, "pesan kamera harus dibungkus <p>");
  }
  // <video> kosong disembunyikan sampai stream hidup (iOS menggambar tombol play)
  assert.match(booth, /#cam:not\(\.on\)\{visibility:hidden\}/);
  assert.match(js, /cam\.classList\.add\("on"\)/);
  // penghitung foto yang kosong tidak boleh tampil sebagai pil abu-abu
  assert.match(booth, /\.shots:empty\{display:none\}/);
});

test("beranda: bagian cetak menampilkan strip JADI yang dikirim, bukan lembar A4", () => {
  const beranda = fs.readFileSync(path.join(root, "public", "index.html"), "utf8");
  const bagian = beranda.slice(beranda.indexOf('id="cetak"'), beranda.indexOf('id="beli"'));
  assert.ok(bagian.includes('class="kiriman'), "visual kiriman hilang");
  assert.ok(!/potong di sini|210 × 297/.test(bagian), "pembeli tidak menerima lembar A4");
  assert.match(bagian, /dipotong rapi/);
});
