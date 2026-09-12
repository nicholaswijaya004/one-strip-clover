/**
 * RENDER STRIP DI SERVER (khusus premium)
 *
 * Kenapa ada:
 *   Selama strip HD dibuat di browser, siapa pun yang paham DevTools bisa
 *   memaksa `premium = true` dan mengunduh versi bersih tanpa bayar. Kalau
 *   caranya tersebar (satu komentar TikTok cukup), pembeli yang sudah bayar
 *   akan merasa dirugikan — dan itu kerusakan kepercayaan, bukan sekadar
 *   kehilangan beberapa file.
 *
 *   Di sini strip bersih HANYA dibuat oleh server, setelah token premium
 *   diverifikasi. Tidak ada jalan memaksanya dari browser.
 *
 * Ketergantungan:
 *   @napi-rs/canvas — biner siap pakai, tidak perlu compiler.
 *   Kalau paket ini tidak terpasang, modul ini otomatis nonaktif dan website
 *   kembali memakai render browser. Jadi deploy TIDAK akan gagal gara-gara ini.
 *
 * Font:
 *   Taruh berkas .ttf di assets/fonts/ (lihat README). Tanpa font itu, teks
 *   footer akan memakai font bawaan sistem dan hasilnya berbeda dari pratinjau.
 */

const fs = require("fs");
const path = require("path");
const renderer = require("../public/shared/strip-renderer.js");

const FONT_DIR = path.join(__dirname, "..", "assets", "fonts");

let canvasLib = null;
let siap = false;
let alasanTidakSiap = "render server belum diinisialisasi (init() belum dipanggil)";
let fontTerdaftar = [];

function init(log) {
  try {
    canvasLib = require("@napi-rs/canvas");
  } catch (e) {
    alasanTidakSiap =
      "@napi-rs/canvas belum terpasang — jalankan: npm install @napi-rs/canvas";
    log?.warn?.("render.disabled", { alasan: alasanTidakSiap });
    return false;
  }

  // Daftarkan font brand kalau tersedia
  const daftarFont = [
    ["Parisienne-Regular.ttf", "Parisienne"],
    ["Montserrat-SemiBold.ttf", "Montserrat"],
    ["Montserrat-Bold.ttf", "Montserrat"],
    ["IBMPlexMono-Regular.ttf", "IBM Plex Mono"],
  ];
  for (const [berkas, nama] of daftarFont) {
    const p = path.join(FONT_DIR, berkas);
    if (fs.existsSync(p)) {
      try {
        canvasLib.GlobalFonts.registerFromPath(p, nama);
        fontTerdaftar.push(nama);
      } catch (e) {
        log?.warn?.("render.font_failed", { berkas, msg: e.message });
      }
    }
  }

  if (fontTerdaftar.length === 0) {
    log?.warn?.("render.no_fonts", {
      hint: `taruh .ttf brand di ${FONT_DIR} agar hasil unduhan sama persis dengan pratinjau`,
    });
  }

  siap = true;
  log?.info?.("render.ready", { fonts: fontTerdaftar.join(",") || "(bawaan sistem)" });
  return true;
}

function tersedia() {
  return siap;
}

function status() {
  return { siap, alasan: alasanTidakSiap, fonts: fontTerdaftar };
}

/**
 * Susun strip bersih HD.
 * @param {object} o { photos:[dataURL], frameId, filter, aspect, width }
 * @returns {Promise<Buffer>} JPEG
 */
async function renderStrip(o) {
  if (!siap) throw new Error(alasanTidakSiap || "render server tidak aktif");

  const { createCanvas, loadImage } = canvasLib;

  const N = renderer.PHOTO_COUNT;
  const photos = Array.isArray(o.photos) ? o.photos.slice(0, N) : [];
  if (photos.length < N) throw new Error(`butuh ${N} foto`);

  const images = [];
  for (const p of photos) {
    const s = String(p || "");
    const koma = s.indexOf(",");
    const buf = Buffer.from(koma >= 0 ? s.slice(koma + 1) : s, "base64");
    if (buf.length === 0) throw new Error("foto tidak terbaca");
    if (buf.length > 8 * 1024 * 1024) throw new Error("foto terlalu besar");
    images.push(await loadImage(buf));
  }

  const aspect = Number(o.aspect) || 4 / 3;
  const opsi = {
    aspect,
    frameId: o.frameId || "clover",
    filter: o.filter || "warna",
    watermark: false, // versi premium: selalu bersih
    dateText: o.dateText || "",
  };

  // format "a4" = lembar siap cetak (strip diputar di atas kertas A4)
  if (o.format === "a4") {
    const size = renderer.a4Size(Number(o.a4Width) || 2480); // 300 dpi
    const canvas = createCanvas(size.width, size.height);
    renderer.drawA4Sheet(canvas.getContext("2d"), images, {
      ...opsi,
      a4Width: size.width,
      copies: Math.min(Math.max(Number(o.copies) || 1, 1), 4),
      stripWidth: Number(o.stripWidth) || 1000,
    });
    return canvas.toBuffer("image/jpeg", { quality: 0.95 });
  }

  const width = Math.min(Math.max(Number(o.width) || 1200, 600), 2000);
  const height = Math.ceil(renderer.stripHeight(width, aspect));
  const canvas = createCanvas(width, height);
  renderer.drawStrip(canvas.getContext("2d"), images, { ...opsi, width });
  return canvas.toBuffer("image/jpeg", { quality: 0.95 });
}

module.exports = { init, tersedia, status, renderStrip };
