/**
 * PENYUSUN STRIP — SATU KODE, DIPAKAI DUA TEMPAT
 *
 *   • di browser  : untuk pratinjau & unduhan versi gratis (berwatermark)
 *   • di server   : untuk unduhan HD premium (tidak bisa diakali DevTools)
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

  function frameStyle(id) {
    switch (id) {
      case "linen":
        return { bg: "#F3EEE2", accent: C.cloverDeep, dark: false };
      case "blush":
        return { bg: "#FFFDF9", wash: "rgba(249,228,235,.85)", accent: C.plum, dark: false };
      case "mint":
        return { bg: "#FBFFFE", wash: "rgba(134,242,236,.4)", accent: C.plum, dark: false };
      case "plum":
        return { bg: C.plum, accent: C.mint, dark: true };
      default:
        return { bg: C.cream, accent: C.clover, dark: false };
    }
  }

  /** Ornamen bingkai. `unit` = skala relatif lebar 104px (ukuran thumbnail). */
  function drawFrameDecor(x, id, W, H, opts) {
    var thumb = opts && opts.thumb;
    var s = function (v) {
      return v * (thumb ? 1 : W / 104);
    };

    if (id === "clover") {
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
    }

    if (id === "linen") {
      x.strokeStyle = "rgba(142,143,58,.5)";
      x.lineWidth = s(1.2);
      x.strokeRect(s(5), s(5), W - s(10), H - s(10));
      x.setLineDash([s(3), s(3)]);
      x.strokeStyle = "rgba(142,143,58,.32)";
      x.lineWidth = s(1);
      x.strokeRect(s(9), s(9), W - s(18), H - s(18));
      x.setLineDash([]);
    }

    if (id === "blush") {
      var petal = function (px, py, sz) {
        x.save();
        x.translate(px, py);
        x.fillStyle = "rgba(216,140,165,.85)";
        for (var a = 0; a < 5; a++) {
          x.rotate((Math.PI * 2) / 5);
          x.beginPath();
          x.ellipse(0, sz * 0.75, sz * 0.4, sz * 0.75, 0, 0, Math.PI * 2);
          x.fill();
        }
        x.fillStyle = C.clover;
        x.beginPath();
        x.arc(0, 0, sz * 0.34, 0, Math.PI * 2);
        x.fill();
        x.restore();
      };
      petal(s(12), s(12), s(5.5));
      petal(W - s(13), H - s(20), s(6.5));
      petal(W - s(16), s(24), s(4));
    }

    if (id === "mint") {
      x.strokeStyle = "rgba(108,72,98,.35)";
      x.lineWidth = s(1.4);
      x.beginPath();
      for (var i2 = 0; i2 <= W; i2 += s(4)) x.lineTo(i2, s(7) + Math.sin(i2 / s(9)) * s(2.2));
      x.stroke();
      x.beginPath();
      for (var i3 = 0; i3 <= W; i3 += s(4)) x.lineTo(i3, H - s(7) + Math.sin(i3 / s(9)) * s(2.2));
      x.stroke();
      x.fillStyle = "rgba(169,186,214,.9)";
      [[s(9), H * 0.42], [W - s(9), H * 0.6]].forEach(function (p) {
        x.beginPath();
        x.arc(p[0], p[1], s(2.6), 0, Math.PI * 2);
        x.fill();
      });
    }

    if (id === "plum") {
      x.fillStyle = "rgba(134,242,236,.9)";
      [[s(8), s(12)], [W - s(10), s(24)], [s(11), H - s(16)], [W - s(14), H - s(30)], [W / 2, s(6)]]
        .forEach(function (p) {
          x.beginPath();
          x.arc(p[0], p[1], s(1.7), 0, Math.PI * 2);
          x.fill();
        });
      x.strokeStyle = "rgba(249,228,235,.45)";
      x.lineWidth = s(1);
      x.strokeRect(s(6), s(6), W - s(12), H - s(12));
    }
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

    if (o.watermark) drawWatermark(ctx, W, H, false);
    return { width: W, height: H };
  }

  function drawWatermark(ctx, W, H, dark) {
    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.rotate(-Math.PI / 5);
    ctx.font = "700 " + W * 0.055 + "px 'Montserrat', sans-serif";
    ctx.fillStyle = dark ? "rgba(255,255,255,.22)" : "rgba(108,72,98,.22)";
    ctx.textAlign = "center";
    for (var wy = -H / 2; wy < H / 2; wy += W * 0.42) {
      ctx.fillText("ONE STRIP CLOVER · PREVIEW", 0, wy);
    }
    ctx.restore();
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

    if (o.watermark) drawWatermark(ctx, W, H, dark);
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
    var lebarTergambar = sh * scale;
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
    drawStrip: drawStrip,
    stripHeight: stripHeight,
  };
});
