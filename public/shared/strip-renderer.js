/**
 * PENYUSUN STRIP — SATU KODE, DIPAKAI DUA TEMPAT
 *
 *   • di browser  : untuk pratinjau & unduhan versi gratis (berwatermark)
 *   • di server   : untuk unduhan HD premium (tidak bisa diakali DevTools)
 *
 * Bingkai PREMIUM sengaja TIDAK ada di berkas ini. Desainnya tinggal di
 * lib/premium-frames.js (hanya di server) dan didaftarkan lewat
 * registerFrame(). Browser hanya menerima gambar pratinjau kecil
 * berwatermark dari server — kode desainnya tidak pernah sampai ke HP
 * pengunjung, jadi strip premium bersih mustahil dibuat tanpa kode.
 *
 * Kenapa harus satu berkas:
 *   Kalau penggambaran ditulis dua kali (sekali di browser, sekali di server),
 *   suatu hari keduanya PASTI berbeda — pembeli protes "hasil unduhannya tidak
 *   sama dengan yang saya lihat". Dengan satu berkas, mustahil melenceng.
 *
 * Berkas ini sengaja polos: tidak menyentuh DOM, tidak fetch, tidak require
 * apa pun. Ia hanya menerima `ctx` (canvas 2D) dan menggambar. Di browser
 * ctx-nya dari <canvas>; di server dari @napi-rs/canvas. Keduanya API sama.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.StripRenderer = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // Palet resmi brand (dari company profile)
  var C = {
    clover: "#AEAF4E",
    cloverDeep: "#8E8F3A",
    blush: "#F9E4EB",
    mint: "#86F2EC",
    plum: "#6C4862",
    peri: "#A9BAD6",
    cream: "#FCFAF3",
    ink: "#3B2E38",
  };

  // Jumlah foto per strip. Diubah di SINI saja — browser, server, dan
  // penghitung tinggi kanvas semuanya mengikuti angka ini.
  var PHOTO_COUNT = 3;

  var FILTERS = {
    warna: "saturate(1.12) contrast(1.05) brightness(1.02)",
    bw: "grayscale(1) contrast(1.18) brightness(1.05)",
    sepia: "sepia(.75) contrast(1.08) brightness(1.03) saturate(1.1)",
  };

  var FRAMES = [
    { id: "clover", name: "Clover", premium: false },
    { id: "linen", name: "Linen", premium: false },
    { id: "blush", name: "Blush", premium: true },
    { id: "mint", name: "Mint", premium: true },
    { id: "plum", name: "Plum", premium: true },
  ];

  /*
   * DAFTAR DESAIN BINGKAI: id → { style, decor }
   *   style  { bg, wash?, accent, dark }
   *   decor  function (x, W, H, s, C) — s(v) mengubah ukuran relatif lebar
   *          104 px (thumbnail) ke ukuran kanvas sebenarnya
   * Hanya bingkai GRATIS yang didefinisikan di sini.
   */
  var DESAIN = {
    clover: {
      style: { bg: C.cream, accent: C.clover, dark: false },
      decor: function (x, W, H, s) {
        var clover = function (cx, cy, r, color) {
          x.save();
          x.translate(cx, cy);
          x.fillStyle = color;
          for (var i = 0; i < 4; i++) {
            x.rotate(Math.PI / 2);
            x.beginPath();
            x.ellipse(0, -r * 0.85, r * 0.6, r * 0.85, 0, 0, Math.PI * 2);
            x.fill();
          }
          x.restore();
        };
        clover(s(13), s(13), s(6), C.clover);
        clover(W - s(14), H - s(18), s(7), "rgba(174,175,78,.75)");
        clover(W - s(15), s(20), s(4.5), "rgba(174,175,78,.45)");
      },
    },
    linen: {
      style: { bg: "#F3EEE2", accent: C.cloverDeep, dark: false },
      decor: function (x, W, H, s) {
        x.strokeStyle = "rgba(142,143,58,.5)";
        x.lineWidth = s(1.2);
        x.strokeRect(s(5), s(5), W - s(10), H - s(10));
        x.setLineDash([s(3), s(3)]);
        x.strokeStyle = "rgba(142,143,58,.32)";
        x.lineWidth = s(1);
        x.strokeRect(s(9), s(9), W - s(18), H - s(18));
        x.setLineDash([]);
      },
    },
  };

  /** Server menambahkan desain bingkai premium lewat fungsi ini. */
  function registerFrame(id, def) {
    DESAIN[id] = def;
  }

  /** true = desain bingkai ini tersedia di sini (browser: hanya yang gratis) */
  function hasFrame(id) {
    return Object.prototype.hasOwnProperty.call(DESAIN, id);
  }

  function frameStyle(id) {
    return (hasFrame(id) ? DESAIN[id] : DESAIN.clover).style;
  }

  /** Ornamen bingkai. `thumb` = gambar di ukuran thumbnail (lebar 104 px). */
  function drawFrameDecor(x, id, W, H, opts) {
    if (!hasFrame(id) || !DESAIN[id].decor) return;
    var thumb = opts && opts.thumb;
    var s = function (v) {
      return v * (thumb ? 1 : W / 104);
    };
    DESAIN[id].decor(x, W, H, s, C);
  }

  /** Thumbnail mini bingkai (104 x 148) untuk baris pilihan bingkai */
  function drawThumb(x, id, W, H) {
    var st = frameStyle(id);
    x.fillStyle = st.bg;
    x.fillRect(0, 0, W, H);
    if (st.wash) {
      x.fillStyle = st.wash;
      x.fillRect(0, 0, W, H);
    }
    var pad = W * 0.14, pw = W - pad * 2, ph = pw * 0.62, gap = H * 0.045;
    for (var i = 0; i < 3; i++) {
      var y = pad * 0.8 + i * (ph + gap);
      x.fillStyle = st.dark ? "#4A3A46" : "#D7D0C4";
      x.fillRect(pad, y, pw, ph);
      x.fillStyle = st.dark ? "#5D4A58" : "#C3BAAB";
      x.beginPath();
      x.arc(pad + pw * 0.5, y + ph * 0.42, ph * 0.22, 0, Math.PI * 2);
      x.fill();
    }
    drawFrameDecor(x, id, W, H, { thumb: true });
    x.fillStyle = st.accent;
    x.fillRect(pad, H - pad * 0.85, pw, 2.5);
  }

  /**
   * Gambar strip lengkap ke ctx yang diberikan.
   *
   * @param {CanvasRenderingContext2D} ctx
   * @param {Array} images  4 objek gambar yang SUDAH dimuat
   * @param {Object} o
   *   width      lebar kanvas (px)
   *   aspect     rasio foto (lebar/tinggi)
   *   frameId    id bingkai
   *   filter     "warna" | "bw" | "sepia"
   *   watermark  true = tempel watermark (versi gratis)
   *   watermarkSeed  angka (opsional) — pola watermark; kosong = acak
   *   dateText   teks tanggal di footer
   */
  // ---- Ukuran fisik strip (mm). SATU acuan untuk semuanya ----
  // Bingkai bawaan dan template unggahan memakai grid yang sama persis,
  // jadi hasil cetaknya selalu 51 x 152 mm di atas A4 apa pun desainnya.
  var STRIP_W_MM = 56.1;
  var STRIP_H_MM = 171.5;

  // Kotak foto bawaan: 5:4, selebar 85% strip — diturunkan dari desain contoh
  var LAYOUT_BAWAAN = {
    photoWmm: 47.7,
    photoHmm: 38.2,
    topMm: 24.0,   // ruang teks ATAS
    gapMm: 5.0,    // jarak antar foto
  };

  /**
   * Gambar strip memakai TEMPLATE yang diunggah admin.
   *
   * Template digambar sebagai LATAR seukuran penuh strip, lalu foto pembeli
   * ditempel di atasnya pada kotak yang posisinya diukur dalam milimeter.
   * Karena itu template beresolusi berapa pun menghasilkan tata letak sama.
   *
   * @param o.templateImage gambar template yang sudah dimuat
   * @param o.layout {photoWmm, photoHmm, topMm, gapMm}
   */
  function drawStripWithTemplate(ctx, images, o) {
    var W = o.width;
    var skala = W / STRIP_W_MM; // piksel per milimeter
    var H = Math.round(STRIP_H_MM * skala);
    var L = o.layout || {};

    var pw = (L.photoWmm || 47.7) * skala;
    var ph = (L.photoHmm || 38.2) * skala;
    var top = (L.topMm || 26) * skala;
    var gap = (L.gapMm || 2.5) * skala;
    var x = (W - pw) / 2; // foto selalu ditengahkan

    // 1) foto dulu, 2) template di atasnya — supaya bingkai/hiasan template
    //    (termasuk bagian tembus pandang) tetap terlihat menimpa foto
    for (var i = 0; i < PHOTO_COUNT; i++) {
      var img = images[i] || images[images.length - 1];
      if (!img) continue;
      var y = top + i * (ph + gap);

      // potong-tengah supaya foto mengisi kotak tanpa gepeng
      var tR = pw / ph, iR = img.width / img.height;
      var sx = 0, sy = 0, sw = img.width, sh = img.height;
      if (iR > tR) { sw = img.height * tR; sx = (img.width - sw) / 2; }
      else { sh = img.width / tR; sy = (img.height - sh) / 2; }

      ctx.save();
      if (FILTERS[o.filter]) ctx.filter = FILTERS[o.filter];
      ctx.drawImage(img, sx, sy, sw, sh, x, y, pw, ph);
      ctx.restore();
    }

    if (o.templateImage) ctx.drawImage(o.templateImage, 0, 0, W, H);

    if (o.watermark) drawWatermark(ctx, W, H, false, o.watermarkSeed);
    return { width: W, height: H };
  }

  /** Angka acak ber-benih (mulberry32): pola watermark beda di tiap strip */
  function acak(benih) {
    var a = (benih >>> 0) || 1;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /*
   * WATERMARK VERSI GRATIS — dibuat supaya SULIT dihapus, bukan sekadar terlihat:
   *   • rapat & menutupi SELURUH strip, termasuk wajah di tiap foto
   *   • dua warna berselang (terang & gelap): terlihat di foto terang maupun
   *     gelap, dan tidak bisa dibuang dengan satu penyesuaian warna
   *   • sudut, pergeseran baris, dan posisi tanda semanggi ACAK per strip —
   *     tidak ada pola tetap yang bisa "dipelajari" penghapus AI
   */
  function drawWatermark(ctx, W, H, dark, benih) {
    var rnd = acak(benih == null ? Math.floor(Math.random() * 4294967296) : benih);
    var teks = "ONE STRIP CLOVER \u00B7 PREVIEW \u00B7 ";
    var fs = W * 0.05;

    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.rotate(-Math.PI / 5 + (rnd() - 0.5) * 0.3);
    ctx.font = "700 " + fs + "px 'Montserrat', sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    var lebarTeks = Math.max(ctx.measureText(teks).width, fs * 4);
    var jangkau = W + H; // cukup untuk menutup strip setelah diputar
    var baris = 0;
    for (var wy = -jangkau / 2; wy < jangkau / 2; wy += W * 0.15, baris++) {
      ctx.fillStyle = baris % 2
        ? "rgba(255,255,255,.34)"
        : (dark ? "rgba(20,12,18,.32)" : "rgba(59,46,56,.28)");
      var mulai = -jangkau / 2 - rnd() * lebarTeks;
      for (var wx = mulai; wx < jangkau / 2; wx += lebarTeks) ctx.fillText(teks, wx, wy);
    }
    ctx.restore();

    // tanda semanggi tersebar acak
    for (var i = 0; i < 16; i++) {
      var r = W * (0.025 + rnd() * 0.03);
      ctx.save();
      ctx.translate(rnd() * W, rnd() * H);
      ctx.rotate(rnd() * Math.PI);
      ctx.fillStyle = i % 2 ? "rgba(255,255,255,.4)" : "rgba(108,72,98,.3)";
      for (var k = 0; k < 4; k++) {
        ctx.rotate(Math.PI / 2);
        ctx.beginPath();
        ctx.ellipse(0, -r * 0.85, r * 0.6, r * 0.85, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  /** Tinggi strip saat memakai template = rasio fisik 56,1 : 171,5 */
  function templateStripHeight(W) {
    return (W / STRIP_W_MM) * STRIP_H_MM;
  }

  function drawStrip(ctx, images, o) {
    // Kalau ada template yang diunggah admin, pakai jalur itu
    if (o.templateImage) return drawStripWithTemplate(ctx, images, o);

    var W = o.width;
    var skala = W / STRIP_W_MM;              // piksel per milimeter
    var H = STRIP_H_MM * skala;
    var L = o.layout || LAYOUT_BAWAAN;

    var pw = L.photoWmm * skala;
    var ph = L.photoHmm * skala;
    var top = L.topMm * skala;
    var gap = L.gapMm * skala;
    var x = (W - pw) / 2;

    var atasFooter = top + ph * PHOTO_COUNT + gap * (PHOTO_COUNT - 1);
    var tinggiFooter = H - atasFooter;

    var st = frameStyle(o.frameId);
    var dark = st.dark;

    ctx.fillStyle = st.bg;
    ctx.fillRect(0, 0, W, H);
    if (st.wash) {
      ctx.fillStyle = st.wash;
      ctx.fillRect(0, 0, W, H);
    }

    for (var i = 0; i < PHOTO_COUNT; i++) {
      var img = images[i] || images[images.length - 1];
      if (!img) continue;
      var y = top + i * (ph + gap);

      // potong-tengah agar foto mengisi kotak tanpa gepeng
      var tR = pw / ph, iR = img.width / img.height;
      var sx = 0, sy = 0, sw = img.width, sh = img.height;
      if (iR > tR) { sw = img.height * tR; sx = (img.width - sw) / 2; }
      else { sh = img.width / tR; sy = (img.height - sh) / 2; }

      ctx.save();
      if (FILTERS[o.filter]) ctx.filter = FILTERS[o.filter];
      ctx.drawImage(img, sx, sy, sw, sh, x, y, pw, ph);
      ctx.restore();

      ctx.strokeStyle = dark ? "rgba(255,255,255,.16)" : "rgba(59,46,56,.14)";
      ctx.lineWidth = Math.max(1, W * 0.003);
      ctx.strokeRect(x, y, pw, ph);
    }

    drawFrameDecor(ctx, o.frameId, W, H, { thumb: false });

    // ---- Teks ATAS (seperti desain contoh: nama brand di ujung satu) ----
    ctx.textAlign = "center";
    ctx.fillStyle = dark ? C.mint : C.cloverDeep;
    ctx.font = W * 0.085 + "px 'Parisienne', cursive";
    ctx.fillText("One Strip Clover", W / 2, top * 0.62);

    ctx.fillStyle = dark ? "rgba(249,228,235,.75)" : "rgba(108,72,98,.6)";
    ctx.font = "600 " + W * 0.021 + "px 'Montserrat', sans-serif";
    ctx.fillText("PHOTOBOX DIGITAL", W / 2, top * 0.85);

    // ---- Teks BAWAH: slogan + tanggal ----
    ctx.fillStyle = dark ? "rgba(249,228,235,.8)" : "rgba(108,72,98,.7)";
    ctx.font = "600 " + W * 0.024 + "px 'Montserrat', sans-serif";
    ctx.fillText("ONE STRIP · ONE MEMORY · ONE LUCKY CHARM",
      W / 2, atasFooter + tinggiFooter * 0.42);

    ctx.font = W * 0.026 + "px 'IBM Plex Mono', monospace";
    ctx.fillStyle = dark ? "rgba(249,228,235,.55)" : "rgba(108,72,98,.5)";
    ctx.fillText(o.dateText || "", W / 2, atasFooter + tinggiFooter * 0.72);

    if (o.watermark) drawWatermark(ctx, W, H, dark, o.watermarkSeed);
    return { width: W, height: H };
  }

  /** Hitung tinggi kanvas tanpa menggambar (dipakai untuk membuat kanvas). */
  // Tinggi strip TIDAK lagi bergantung rasio foto — ukurannya fisik:
  // 56,1 x 171,5 mm, supaya hasil cetak selalu pas di kotak 51 x 152 mm.
  function stripHeight(W) {
    return (W / STRIP_W_MM) * STRIP_H_MM;
  }

  /**
   * LEMBAR CETAK A4
   *
   * Strip diputar 90° dan diletakkan di bagian atas kertas A4 putih —
   * bentuk yang dipakai studio untuk mencetak lalu memotongnya.
   * Memutar strip membuatnya muat di lebar kertas tanpa mengecil banyak.
   *
   * @param o
   *   a4Width    lebar kanvas A4 dalam piksel (2480 = 300 dpi)
   *   copies     berapa strip dalam satu halaman (default 1, seperti contoh)
   *   stripWidth lebar strip sebelum diputar (mempengaruhi ketajaman)
   */
  function drawA4Sheet(ctx, images, o) {
    var A4W = o.a4Width || 2480;
    var A4H = Math.round((A4W * 297) / 210); // rasio A4
    var copies = Math.max(1, Math.min(o.copies || 1, 4));

    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, A4W, A4H);

    var margin = A4W * 0.04;
    var tersedia = A4W - margin * 2;

    var sw = o.stripWidth || 1000;
    var sh = stripHeight(sw, o.aspect || 4 / 3);

    // Setelah diputar 90°, TINGGI strip terbentang mendatar
    var scale = tersedia / sh;
    var tinggiTergambar = sw * scale;
    var jarak = A4W * 0.03;

    for (var c = 0; c < copies; c++) {
      var y = margin + c * (tinggiTergambar + jarak);
      if (y + tinggiTergambar > A4H - margin) break; // jangan keluar kertas

      ctx.save();
      ctx.translate(margin, y + tinggiTergambar);
      ctx.rotate(-Math.PI / 2);
      ctx.scale(scale, scale);
      drawStrip(ctx, images, {
        width: sw,
        aspect: o.aspect,
        frameId: o.frameId,
        filter: o.filter,
        watermark: o.watermark,
        dateText: o.dateText,
      });
      ctx.restore();
    }

    return { width: A4W, height: A4H };
  }

  /** Ukuran kanvas A4 (untuk membuat canvas sebelum menggambar) */
  function a4Size(a4Width) {
    var W = a4Width || 2480;
    return { width: W, height: Math.round((W * 297) / 210) };
  }

  return {
    C: C,
    PHOTO_COUNT: PHOTO_COUNT,
    STRIP_W_MM: STRIP_W_MM,
    LAYOUT_BAWAAN: LAYOUT_BAWAAN,
    STRIP_H_MM: STRIP_H_MM,
    drawStripWithTemplate: drawStripWithTemplate,
    templateStripHeight: templateStripHeight,
    drawA4Sheet: drawA4Sheet,
    a4Size: a4Size,
    FILTERS: FILTERS,
    FRAMES: FRAMES,
    frameStyle: frameStyle,
    drawFrameDecor: drawFrameDecor,
    drawThumb: drawThumb,
    registerFrame: registerFrame,
    hasFrame: hasFrame,
    drawStrip: drawStrip,
    stripHeight: stripHeight,
  };
});
