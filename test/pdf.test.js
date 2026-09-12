const test = require("node:test");
const assert = require("node:assert/strict");
const pdf = require("../lib/pdf");

/** JPEG minimal (hanya header SOF) untuk menguji tanpa berkas gambar sungguhan */
function jpegPalsu(w, h) {
  const b = Buffer.alloc(20);
  b[0] = 0xff; b[1] = 0xd8;          // SOI
  b[2] = 0xff; b[3] = 0xc0;          // SOF0
  b.writeUInt16BE(11, 4);
  b[6] = 8;
  b.writeUInt16BE(h, 7);
  b.writeUInt16BE(w, 9);
  b[11] = 3;
  return b;
}

/** Ambil matriks penempatan dari isi PDF → posisi strip dalam milimeter */
function posisiStrip(buf, indeks = 0) {
  const teks = buf.toString("latin1");
  const semua = [...teks.matchAll(/q\n([\d.\- ]+) cm/g)];
  const m = semua[indeks];
  if (!m) return null;
  const [, b, c, , e, f] = m[1].trim().split(/\s+/).map(Number);
  const lebar = Math.abs(c) / pdf.MM;   // mendatar (sisi panjang)
  const tinggi = b / pdf.MM;            // tegak (sisi pendek)
  const kiri = e / pdf.MM - lebar;
  const bawah = f / pdf.MM;
  return { lebar, tinggi, kiri, bawah, atas: bawah + tinggi, jumlah: semua.length };
}

test("pdf: ukuran JPEG terbaca dari penanda SOF", () => {
  assert.deepEqual(pdf.jpegSize(jpegPalsu(1000, 3034)), { width: 1000, height: 3034 });
});

test("pdf: berkas bukan JPEG ditolak dengan jelas", () => {
  assert.throws(() => pdf.jpegSize(Buffer.from("bukan gambar")), /bukan berkas JPEG/);
});

test("pdf: menghasilkan PDF yang sah (header & penutup benar)", () => {
  const out = pdf.buildA4Pdf(jpegPalsu(1000, 3034));
  assert.equal(out.slice(0, 8).toString("latin1"), "%PDF-1.4");
  assert.match(out.slice(-8).toString("latin1"), /%%EOF/);
  assert.match(out.toString("latin1"), /\/Type \/Catalog/);
  assert.match(out.toString("latin1"), /\/Filter \/DCTDecode/, "JPEG ditempel apa adanya");
});

test("pdf: halaman berukuran A4 (210 x 297 mm)", () => {
  const out = pdf.buildA4Pdf(jpegPalsu(1000, 3034)).toString("latin1");
  const m = out.match(/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/);
  assert.ok(m, "MediaBox harus ada");
  assert.ok(Math.abs(Number(m[1]) / pdf.MM - 210) < 0.5, "lebar 210 mm");
  assert.ok(Math.abs(Number(m[2]) / pdf.MM - 297) < 0.5, "tinggi 297 mm");
});

test("pdf: strip tercetak ±51 x 152 mm (ukuran photobox klasik)", () => {
  const p = posisiStrip(pdf.buildA4Pdf(jpegPalsu(1000, 3034)));
  assert.ok(Math.abs(p.lebar - 152) < 1.5, `sisi panjang ${p.lebar.toFixed(1)} mm ≈ 152`);
  assert.ok(Math.abs(p.tinggi - 51) < 1.5, `sisi pendek ${p.tinggi.toFixed(1)} mm ≈ 51`);
});

test("pdf: strip DIPUTAR (mendatar di kertas potret)", () => {
  const p = posisiStrip(pdf.buildA4Pdf(jpegPalsu(1000, 3034)));
  assert.ok(p.lebar > p.tinggi, "sisi panjang harus mendatar");
});

test("pdf: strip menempel PERSIS di tepi atas kertas (tanpa jarak)", () => {
  const p = posisiStrip(pdf.buildA4Pdf(jpegPalsu(1000, 3034)));
  assert.ok(Math.abs(297 - p.atas) < 0.05, `masih ada jarak ${(297 - p.atas).toFixed(2)} mm`);
});

test("pdf: jarak atas bisa ditambah kalau printer memotong tepi", () => {
  const p = posisiStrip(pdf.buildA4Pdf(jpegPalsu(1000, 3034), { marginMm: 5 }));
  assert.ok(Math.abs(297 - p.atas - 5) < 0.05, "jarak 5 mm harus dihormati");
});

test("pdf: strip ditengahkan mendatar & tidak keluar kertas", () => {
  const p = posisiStrip(pdf.buildA4Pdf(jpegPalsu(1000, 3034)));
  assert.ok(Math.abs(p.kiri - (210 - p.lebar) / 2) < 0.5, "harus di tengah");
  assert.ok(p.kiri >= 0 && p.kiri + p.lebar <= 210, "tidak boleh keluar kertas");
  assert.ok(p.bawah >= -0.01 && p.atas <= 297.01, "tidak boleh keluar kertas");
});

test("pdf: proporsi gambar TIDAK dipaksa (wajah tidak gepeng)", () => {
  // gambar lebih jangkung dari 1:3 → lebarnya yang menyesuaikan
  const p = posisiStrip(pdf.buildA4Pdf(jpegPalsu(1000, 4000)));
  const rasioDiKertas = p.lebar / p.tinggi;
  assert.ok(Math.abs(rasioDiKertas - 4) < 0.05, "proporsi asli harus dipertahankan");
  assert.ok(p.lebar <= 152.5 && p.tinggi <= 51.5, "tetap muat di kotak 51x152");
});

test("pdf: beberapa strip per halaman tidak bertumpuk & tetap muat", () => {
  const out = pdf.buildA4Pdf(jpegPalsu(1000, 3034), { copies: 4 });
  const p0 = posisiStrip(out, 0);
  assert.equal(p0.jumlah, 4, "harus ada 4 strip");
  for (let i = 1; i < 4; i++) {
    const a = posisiStrip(out, i - 1);
    const b = posisiStrip(out, i);
    assert.ok(b.atas <= a.bawah + 0.01, `strip ${i + 1} bertumpuk dengan sebelumnya`);
    assert.ok(b.bawah >= 0, "strip terakhir keluar kertas");
  }
});

test("pdf: jumlah salinan dibatasi 1-4", () => {
  assert.equal(posisiStrip(pdf.buildA4Pdf(jpegPalsu(1000, 3034), { copies: 99 }), 0).jumlah, 4);
  assert.equal(posisiStrip(pdf.buildA4Pdf(jpegPalsu(1000, 3034), { copies: 0 }), 0).jumlah, 1);
});
