const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const renderer = require("../public/shared/strip-renderer.js");
const render = require("../lib/render");
const server = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
const index = fs.readFileSync(path.join(__dirname, "..", "public", "booth.html"), "utf8");

/* ---- renderer bersama: satu sumber kebenaran untuk browser & server ---- */

test("renderer: bisa dimuat di Node maupun browser (UMD)", () => {
  assert.equal(typeof renderer.drawStrip, "function");
  assert.equal(typeof renderer.stripHeight, "function");
  assert.equal(renderer.FRAMES.length, 5);
});

test("renderer: tinggi strip TIDAK bergantung rasio foto (ukurannya fisik)", () => {
  // Ini disengaja: ukuran cetak harus selalu 51 x 152 mm, apa pun rasio fotonya.
  // Dulu tingginya ikut rasio foto → ukuran cetak berubah-ubah.
  assert.equal(renderer.stripHeight(1200, 1), renderer.stripHeight(1200, 4 / 3));
  const rasio = renderer.stripHeight(1200) / 1200;
  assert.ok(Math.abs(rasio - 171.5 / 56.1) < 0.01, "harus 1 : 3,06");
});

test("renderer: bingkai gelap ditandai supaya warna teks menyesuaikan", () => {
  assert.equal(renderer.frameStyle("plum").dark, true);
  assert.equal(renderer.frameStyle("clover").dark, false);
});

test("renderer: TIDAK ada kode penggambar kembar di index.html", () => {
  // Kalau penggambaran ditulis dua kali, hasil browser & server pasti melenceng
  assert.ok(
    index.includes('src="/shared/strip-renderer.js"'),
    "halaman harus memakai modul bersama"
  );
});

/* --------------------------- endpoint premium --------------------------- */

test("render: endpoint wajib memverifikasi token premium", () => {
  // cari DEKLARASI rute-nya, bukan penyebutan namanya di daftar lain
  const mulai = server.indexOf('app.post(\n  "/api/render-strip"');
  assert.ok(mulai > -1, "deklarasi rute /api/render-strip tidak ditemukan");
  const potongan = server.slice(mulai, mulai + 1400);
  assert.ok(potongan.includes("verifyToken"), "token harus diperiksa");
  assert.ok(potongan.includes("PREMIUM_REQUIRED"), "harus menolak tanpa token");
});

test("render: endpoint dibatasi rate limit", () => {
  const mulai = server.indexOf('app.post(\n  "/api/render-strip"');
  const potongan = server.slice(mulai, mulai + 500);
  assert.ok(potongan.includes("rateLimit"), "endpoint render harus dibatasi");
});

test("render: server mati-suri dengan rapi kalau canvas tidak terpasang", () => {
  // Tidak boleh membuat deploy gagal — website harus tetap jalan
  render.init(null); // tanpa logger
  const st = render.status();
  assert.equal(typeof st.siap, "boolean");
  if (!st.siap) {
    assert.match(st.alasan || "", /canvas|render/i);
  }
});

test("render: browser jatuh ke versi berwatermark kalau server tidak bisa", () => {
  assert.ok(
    index.includes("RENDER_UNAVAILABLE") || index.includes("ambilStripUntukDiunduh"),
    "harus ada jalur cadangan"
  );
  const fn = index.slice(index.indexOf("async function ambilStripUntukDiunduh"));
  assert.ok(
    fn.slice(0, 1600).includes('$("stripImg").src'),
    "cadangannya memakai gambar yang sudah tampil (berwatermark)"
  );
});

test("render: unduhan premium TIDAK lagi memakai kanvas browser", () => {
  const fn = index.slice(index.indexOf("async function ambilStripUntukDiunduh"));
  const potongan = fn.slice(0, 1600);
  assert.ok(potongan.includes("/api/render-strip"), "premium harus minta ke server");
  assert.ok(potongan.includes("S.premium"), "hanya premium yang lewat server");
});

test("render: menolak jumlah foto yang tidak lengkap", async () => {
  await assert.rejects(
    () => render.renderStrip({ photos: ["a", "b"] }),
    /butuh 4 foto|belum terpasang|tidak aktif/
  );
});

/* ======================= 3 foto & lembar cetak A4 ======================= */

test("strip: sekarang 3 foto, bukan 4", () => {
  assert.equal(renderer.PHOTO_COUNT, 3);
});

test("strip: jumlah foto tidak ditulis ulang di index.html", () => {
  // kalau angkanya kembar, browser & server bisa beda jumlah foto
  assert.ok(
    index.includes("StripRenderer.PHOTO_COUNT"),
    "halaman harus mengambil jumlah foto dari modul bersama"
  );
});

test("strip: 3 kotak foto + ruang teks muat pas di dalam strip", () => {
  const L = renderer.LAYOUT_BAWAAN;
  const terpakai = L.topMm + L.photoHmm * 3 + L.gapMm * 2;
  assert.ok(terpakai < renderer.STRIP_H_MM, "tidak boleh melebihi tinggi strip");
  const sisaBawah = renderer.STRIP_H_MM - terpakai;
  assert.ok(sisaBawah > 15, `sisa bawah ${sisaBawah.toFixed(1)} mm untuk teks`);
  assert.ok(L.photoWmm < renderer.STRIP_W_MM, "foto harus lebih sempit dari strip");
});

test("A4: ukurannya benar-benar rasio A4", () => {
  const s = renderer.a4Size(2480);
  assert.equal(s.width, 2480);
  assert.ok(Math.abs(s.height / s.width - 297 / 210) < 0.001, "rasio A4 = 1.414");
});

test("A4: strip diputar & diletakkan di bagian atas kertas", () => {
  const kotak = [];
  const ctx = mockCtx(kotak);
  const img = { width: 1280, height: 960 };
  const size = renderer.a4Size(2480);
  renderer.drawA4Sheet(ctx, [img, img, img], {
    a4Width: size.width, copies: 1, stripWidth: 1000, aspect: 4 / 3, frameId: "clover",
  });

  const strip = kotak[1]; // kotak[0] = latar putih halaman
  assert.ok(strip.x2 - strip.x1 > strip.y2 - strip.y1, "strip harus MENDATAR (diputar)");
  assert.ok(strip.y1 < size.height * 0.3, "harus di bagian atas kertas");
  assert.ok(strip.x2 <= size.width && strip.y2 <= size.height, "tidak boleh keluar kertas");
});

test("A4: beberapa salinan tidak saling menimpa & tetap di dalam kertas", () => {
  const kotak = [];
  const ctx = mockCtx(kotak);
  const img = { width: 1280, height: 960 };
  const size = renderer.a4Size(2480);
  renderer.drawA4Sheet(ctx, [img, img, img], {
    a4Width: size.width, copies: 3, stripWidth: 1000, aspect: 4 / 3, frameId: "clover",
  });
  const strips = kotak.slice(1);
  assert.equal(strips.length, 3, "harus tergambar 3 salinan");
  for (let i = 1; i < strips.length; i++) {
    assert.ok(strips[i].y1 >= strips[i - 1].y2 - 1, "salinan tidak boleh bertumpuk");
  }
  assert.ok(strips[strips.length - 1].y2 <= size.height, "salinan terakhir harus muat");
});

/** Canvas tiruan: cukup untuk memeriksa posisi & transformasi */
function mockCtx(kotak) {
  let m = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
  const stack = [];
  const mul = (n) => {
    m = {
      a: m.a * n.a + m.c * n.b, b: m.b * n.a + m.d * n.b,
      c: m.a * n.c + m.c * n.d, d: m.b * n.c + m.d * n.d,
      e: m.a * n.e + m.c * n.f + m.e, f: m.b * n.e + m.d * n.f + m.f,
    };
  };
  const titik = (x, y) => ({ x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f });
  const noop = () => {};
  return {
    save() { stack.push({ ...m }); },
    restore() { m = stack.pop(); },
    translate(x, y) { mul({ a: 1, b: 0, c: 0, d: 1, e: x, f: y }); },
    rotate(t) { mul({ a: Math.cos(t), b: Math.sin(t), c: -Math.sin(t), d: Math.cos(t), e: 0, f: 0 }); },
    scale(x, y) { mul({ a: x, b: 0, c: 0, d: y, e: 0, f: 0 }); },
    fillRect(x, y, w, h) {
      const p1 = titik(x, y), p2 = titik(x + w, y + h);
      kotak.push({
        x1: Math.min(p1.x, p2.x), y1: Math.min(p1.y, p2.y),
        x2: Math.max(p1.x, p2.x), y2: Math.max(p1.y, p2.y),
      });
    },
    strokeRect: noop, beginPath: noop, arc: noop, ellipse: noop, fill: noop,
    stroke: noop, lineTo: noop, moveTo: noop, setLineDash: noop,
    fillText: noop, drawImage: noop,
    set filter(v) {}, get filter() { return ""; },
    set fillStyle(v) {}, set strokeStyle(v) {}, set lineWidth(v) {},
    set font(v) {}, set textAlign(v) {},
  };
}

/* =============== rasio strip klasik & lembar cetak A4 =============== */

test("strip: rasio 1 : 3 seperti photobox klasik (2 x 6 inci)", () => {
  const W = 1000;
  const rasio = renderer.stripHeight(W, 1) / W;
  assert.ok(rasio > 2.9 && rasio < 3.15, `rasio ${rasio.toFixed(2)} harus mendekati 3`);
});

test("strip: rasio foto SAMA di HP & laptop (hasil cetak tidak berbeda)", () => {
  // Dulu rasio berbeda antar perangkat → strip yang dicetak jadi beda bentuk.
  assert.ok(
    !index.includes('matchMedia("(max-width:560px)").matches ? 1 : 4/3'),
    "rasio tidak boleh bergantung lebar layar"
  );
  assert.ok(
    index.includes("LAYOUT_BAWAAN.photoWmm / StripRenderer.LAYOUT_BAWAAN.photoHmm"),
    "rasio diturunkan dari ukuran kotak foto (5:4), bukan angka tetap"
  );
});

test("strip: rasio mengikuti kotak foto template kalau ada", () => {
  // Template 5:4 → pratinjau kamera & jepretan ikut 5:4, supaya
  // yang dilihat pembeli = yang tercetak.
  assert.ok(
    index.includes("terapkanRasioFoto"),
    "harus ada penyesuaian rasio dari layout"
  );
  assert.ok(
    index.includes("L.photoWmm / L.photoHmm"),
    "rasio dihitung dari ukuran kotak foto"
  );
});

test("A4: pita strip menempati ±20% bagian atas halaman", () => {
  const kotak = [];
  const ctx = mockCtx(kotak);
  const img = { width: 1000, height: 1000 };
  const size = renderer.a4Size(2480);
  renderer.drawA4Sheet(ctx, [img, img, img], {
    a4Width: size.width, copies: 1, stripWidth: 1000, aspect: 1, frameId: "clover",
  });
  const s = kotak[1];
  const tinggi = (s.y2 - s.y1) / size.height;
  assert.ok(tinggi > 0.15 && tinggi < 0.28, `pita ${(tinggi * 100).toFixed(0)}% harus ±20%`);
  assert.ok(s.y1 < size.height * 0.15, "harus menempel di atas");
});

test("A4: ukuran potongan masuk akal untuk strip cetak", () => {
  const kotak = [];
  const ctx = mockCtx(kotak);
  const img = { width: 1000, height: 1000 };
  renderer.drawA4Sheet(ctx, [img, img, img], {
    a4Width: 2480, copies: 1, stripWidth: 1000, aspect: 1, frameId: "clover",
  });
  const s = kotak[1];
  const panjangCm = ((s.x2 - s.x1) / 300) * 2.54;
  const lebarCm = ((s.y2 - s.y1) / 300) * 2.54;
  assert.ok(panjangCm > 15 && panjangCm < 21, `panjang ${panjangCm.toFixed(1)} cm`);
  assert.ok(lebarCm > 5 && lebarCm < 8, `lebar ${lebarCm.toFixed(1)} cm`);
});

test("renderer: foto kurang tidak membuat seluruh render gagal", () => {
  const kotak = [];
  const ctx = mockCtx(kotak);
  const img = { width: 1000, height: 1000 };
  assert.doesNotThrow(() =>
    renderer.drawStrip(ctx, [img], { width: 600, aspect: 1, frameId: "clover" })
  );
});

test("pengiriman: lembar A4 jadi lampiran PERTAMA (yang dicetak staf)", () => {
  const delivery = fs.readFileSync(
    path.join(__dirname, "..", "lib", "delivery.js"), "utf8"
  );
  assert.ok(delivery.includes("buildAttachmentsAsync"), "harus ada penyusun A4");
  assert.ok(delivery.includes('att.a4 ? [att.a4] : []'), "A4 harus paling depan");
  assert.ok(delivery.includes("buildA4Pdf"), "lembar A4 dibuat sebagai PDF di server");
  assert.ok(delivery.includes("a4.no_strip"), "harus memberi peringatan kalau strip tidak ada");
});

test("kamera: rasio pratinjau = rasio kotak foto strip (5:4)", () => {
  // Kalau berbeda, pembeli membingkai di kotak persegi lalu hasil cetaknya
  // terpotong — inilah sumber keluhan 'hasilnya beda dengan pratinjau'.
  assert.ok(
    index.includes("StripRenderer.LAYOUT_BAWAAN.photoWmm / StripRenderer.LAYOUT_BAWAAN.photoHmm"),
    "ASPECT harus diturunkan dari ukuran kotak foto, bukan angka tetap"
  );
});

test("build: halaman mencetak penanda versi tata letak di console", () => {
  // supaya gampang memastikan build mana yang sedang jalan
  assert.ok(index.includes("tata letak mm-grid"), "penanda build hilang");
});

test("cache: HTML & JS TIDAK boleh di-cache browser", () => {
  // Cache 1 jam pernah menyebabkan campuran index.html baru + renderer lama,
  // yang membuat halaman rusak sebagian TANPA pesan error.
  assert.ok(!server.includes('maxAge: "1h"'), "cache agresif untuk semua berkas dihapus");
  assert.ok(server.includes("no-store"), "HTML & JS harus no-store");
});

test("halaman: gagal muat modul bersama ditampilkan JELAS, bukan diam", () => {
  assert.ok(index.includes("__oscSiap"), "harus ada pemeriksaan modul siap");
  assert.ok(index.includes("tampilkanErrorFatal"), "harus ada penampil error di layar");
});

test("halaman: template muncul sebagai pilihan di baris Bingkai", () => {
  const { execFileSync } = require("child_process");
  const out = execFileSync("node", [
    path.join(__dirname, "..", "scripts", "simulasi-browser.js"),
  ], { encoding: "utf8", env: { ...process.env, UJI_TEMPLATE: "1" } });
  assert.match(out, /SEMUA LULUS/, "template tidak muncul sebagai bingkai:\n" + out);
});

test("halaman: simulasi browser ketat lulus semua", () => {
  // Menjalankan skrip index.html dengan DOM tiruan yang berperilaku seperti
  // browser (getElementById → null untuk id tak dikenal, canvas API terbatas).
  // Menangkap kelas bug 'halaman diam saja' sebelum sampai ke pengguna.
  const { execFileSync } = require("child_process");
  const out = execFileSync("node", [
    path.join(__dirname, "..", "scripts", "simulasi-browser.js"),
  ], { encoding: "utf8" });
  assert.match(out, /SEMUA LULUS/, "ada pemeriksaan halaman yang gagal:\n" + out);
});

/* --------------------- alur halaman: depan → photobox --------------------- */

test("halaman: ada halaman pembuka terpisah dari photobox", () => {
  const root = path.join(__dirname, "..", "public");
  assert.ok(fs.existsSync(path.join(root, "index.html")), "halaman pembuka hilang");
  assert.ok(fs.existsSync(path.join(root, "booth.html")), "halaman photobox hilang");
});

test("halaman pembuka: punya tombol masuk ke /booth", () => {
  const depan = fs.readFileSync(
    path.join(__dirname, "..", "public", "index.html"), "utf8"
  );
  assert.match(depan, /href="\/booth"/, "tombol masuk harus mengarah ke /booth");
  assert.match(depan, /One Strip Clover/, "nama brand harus tampil");
});

test("halaman pembuka: TIDAK meminta izin kamera", () => {
  // Kamera baru diminta di /booth. Meminta di detik pertama membuat
  // pengunjung menutup halaman sebelum tahu ini apa.
  const depan = fs.readFileSync(
    path.join(__dirname, "..", "public", "index.html"), "utf8"
  );
  assert.ok(!depan.includes("getUserMedia"), "halaman depan tidak boleh menyalakan kamera");
});

test("server: rute /booth & /admin terdaftar", () => {
  assert.match(server, /app\.get\("\/booth"/, "rute /booth belum ada");
  assert.match(server, /app\.get\("\/admin"/, "rute /admin belum ada");
});

test("photobox: wordmark bisa diklik untuk kembali ke halaman depan", () => {
  assert.match(index, /class="wordmark" href="\/"/, "tidak ada jalan kembali");
});

test("halaman depan: angka langkah benar-benar di tengah lingkaran", () => {
  // letter-spacing menambah spasi SESUDAH karakter → angka bergeser ke kiri.
  // Lingkaran angka harus memakai flex + line-height:1 + letter-spacing:0.
  const depan = fs.readFileSync(
    path.join(__dirname, "..", "public", "index.html"), "utf8"
  );
  const blok = depan.slice(depan.indexOf(".no{"), depan.indexOf(".no{") + 600);
  assert.match(blok, /letter-spacing:\s*0/, "letter-spacing harus dinolkan");
  assert.match(blok, /line-height:\s*1\b/, "line-height harus 1");
  assert.match(blok, /justify-content:\s*center/, "harus ditengahkan mendatar");
  assert.match(blok, /align-items:\s*center/, "harus ditengahkan tegak");
});
