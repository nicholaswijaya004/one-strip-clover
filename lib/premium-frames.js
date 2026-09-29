/**
 * DESAIN BINGKAI PREMIUM — HANYA ADA DI SERVER
 *
 * Kenapa tidak di public/shared/strip-renderer.js bersama bingkai gratis:
 *   Semua yang dikirim ke browser bisa dibaca & dijalankan pengunjung. Dulu
 *   kode bingkai Blush/Mint/Plum ikut terkirim, jadi siapa pun yang paham
 *   DevTools bisa menggambar strip premium BERSIH tanpa membeli kode.
 *   Sekarang browser hanya menerima gambar pratinjau kecil berwatermark
 *   (lihat /api/preview-strip); desainnya sendiri tidak pernah keluar server.
 *
 * Cara kerja: modul ini mendaftarkan desainnya ke penyusun strip bersama
 * (registerFrame). Cukup di-require sekali — lib/render.js melakukannya.
 */
const renderer = require("../public/shared/strip-renderer.js");
const { C } = renderer;

renderer.registerFrame("blush", {
  style: { bg: "#FFFDF9", wash: "rgba(249,228,235,.85)", accent: C.plum, dark: false },
  decor(x, W, H, s) {
    const petal = (px, py, sz) => {
      x.save();
      x.translate(px, py);
      x.fillStyle = "rgba(216,140,165,.85)";
      for (let a = 0; a < 5; a++) {
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
  },
});

renderer.registerFrame("mint", {
  style: { bg: "#FBFFFE", wash: "rgba(134,242,236,.4)", accent: C.plum, dark: false },
  decor(x, W, H, s) {
    x.strokeStyle = "rgba(108,72,98,.35)";
    x.lineWidth = s(1.4);
    x.beginPath();
    for (let i = 0; i <= W; i += s(4)) x.lineTo(i, s(7) + Math.sin(i / s(9)) * s(2.2));
    x.stroke();
    x.beginPath();
    for (let i = 0; i <= W; i += s(4)) x.lineTo(i, H - s(7) + Math.sin(i / s(9)) * s(2.2));
    x.stroke();
    x.fillStyle = "rgba(169,186,214,.9)";
    for (const [px, py] of [[s(9), H * 0.42], [W - s(9), H * 0.6]]) {
      x.beginPath();
      x.arc(px, py, s(2.6), 0, Math.PI * 2);
      x.fill();
    }
  },
});

renderer.registerFrame("plum", {
  style: { bg: C.plum, accent: C.mint, dark: true },
  decor(x, W, H, s) {
    x.fillStyle = "rgba(134,242,236,.9)";
    for (const [px, py] of [[s(8), s(12)], [W - s(10), s(24)], [s(11), H - s(16)], [W - s(14), H - s(30)], [W / 2, s(6)]]) {
      x.beginPath();
      x.arc(px, py, s(1.7), 0, Math.PI * 2);
      x.fill();
    }
    x.strokeStyle = "rgba(249,228,235,.45)";
    x.lineWidth = s(1);
    x.strokeRect(s(6), s(6), W - s(12), H - s(12));
  },
});

// Setiap bingkai premium di daftar WAJIB punya desain di sini — kalau ada
// yang terlewat, server gagal menyala dengan pesan jelas (bukan diam-diam
// merender bingkai gratis untuk pembeli premium).
for (const f of renderer.FRAMES) {
  if (!renderer.hasFrame(f.id)) {
    throw new Error(`desain bingkai "${f.id}" belum ada di lib/premium-frames.js`);
  }
}

module.exports = renderer;
