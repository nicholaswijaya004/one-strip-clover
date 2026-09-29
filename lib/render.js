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
 *   Font brand (.ttf, lisensi OFL) ikut di repo: assets/fonts/. Tanpa font itu,
 *   teks footer memakai font bawaan sistem dan hasilnya berbeda dari pratinjau.
 */

const fs = require("fs");
const path = require("path");
// premium-frames = penyusun strip bersama + desain bingkai premium (server saja)
const renderer = require("./premium-frames");
const { parseImageDataUrl } = require("./images");

/*
 * BATAS UKURAN KANVAS — semua angka dari klien WAJIB dijepit.
 * Dulu `a4Width`, `stripWidth`, dan `aspect` diteruskan apa adanya:
 * satu permintaan dengan a4Width=100000 membuat kanvas 100.000 x 141.429
 * piksel (±56 GB) → server mati kehabisan memori. Cukup SATU kode premium
 * (Rp 15 rb) untuk mematikan website kapan saja.
 */
const BATAS = {
  LEBAR_STRIP: [600, 2000],
  LEBAR_A4: [1240, 2480],      // 150–300 dpi
  LEBAR_STRIP_A4: [400, 1400],
  ASPEK: [0.5, 2],
};

// Ukuran pratinjau — sengaja kecil (lihat renderPreview)
const PRATINJAU = {
  LEBAR_GRATIS: 360,
  LEBAR_PREMIUM: 720,
  FOTO_SISI: 720,
};

const jepit = (v, [min, max], bawaan) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return bawaan;
  return Math.min(Math.max(n, min), max);
};

const teks = (v, max = 40) => String(v == null ? "" : v).slice(0, max);

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
  const hilang = [];
  for (const [berkas, nama] of daftarFont) {
    const p = path.join(FONT_DIR, berkas);
    if (!fs.existsSync(p)) {
      hilang.push(berkas);
      continue;
    }
    try {
      canvasLib.GlobalFonts.registerFromPath(p, nama);
      // Montserrat punya 2 berkas (600 & 700) — namanya cukup dicatat sekali
      if (!fontTerdaftar.includes(nama)) fontTerdaftar.push(nama);
    } catch (e) {
      hilang.push(berkas);
      log?.warn?.("render.font_failed", { berkas, msg: e.message });
    }
  }

  if (fontTerdaftar.length === 0) {
    log?.warn?.("render.no_fonts", {
      hint: `taruh .ttf brand di ${FONT_DIR} agar hasil unduhan sama persis dengan pratinjau`,
    });
  } else if (hilang.length) {
    log?.warn?.("render.font_missing", { berkas: hilang.join(",") });
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

  // Header gambar diperiksa DULU (murah) — bom dekompresi ditolak sebelum
  // pustaka gambar sempat mengalokasikan memori untuk men-decode-nya.
  const images = [];
  for (const p of photos) {
    let img;
    try {
      img = parseImageDataUrl(p);
    } catch (e) {
      const err = new Error(e.message);
      err.code = "BAD_PHOTO";
      throw err;
    }
    images.push(await loadImage(img.buffer));
  }

  const aspect = jepit(o.aspect, BATAS.ASPEK, 4 / 3);
  const opsi = {
    aspect,
    frameId: teks(o.frameId) || "clover",
    filter: teks(o.filter) || "warna",
    watermark: false, // versi premium: selalu bersih
    dateText: teks(o.dateText),
  };

  // format "a4" = lembar siap cetak (strip diputar di atas kertas A4)
  if (o.format === "a4") {
    const size = renderer.a4Size(Math.round(jepit(o.a4Width, BATAS.LEBAR_A4, 2480))); // 300 dpi
    const canvas = createCanvas(size.width, size.height);
    renderer.drawA4Sheet(canvas.getContext("2d"), images, {
      ...opsi,
      a4Width: size.width,
      copies: Math.round(jepit(o.copies, [1, 4], 1)),
      stripWidth: jepit(o.stripWidth, BATAS.LEBAR_STRIP_A4, 1000),
    });
    return canvas.toBuffer("image/jpeg", { quality: 0.95 });
  }

  const width = Math.round(jepit(o.width, BATAS.LEBAR_STRIP, 1200));
  const height = Math.ceil(renderer.stripHeight(width, aspect));
  const canvas = createCanvas(width, height);
  renderer.drawStrip(canvas.getContext("2d"), images, { ...opsi, width });
  return canvas.toBuffer("image/jpeg", { quality: 0.95 });
}

/** Hanya id bingkai bawaan yang dikenal (dicocokkan ===, bukan dari objek) */
function bingkaiDikenal(id) {
  return renderer.FRAMES.some((f) => f.id === id);
}

/**
 * PRATINJAU strip — dipakai halaman booth untuk bingkai yang desainnya tidak
 * ada di browser (premium). Kecil & murah:
 *   • tanpa kode premium : lebar 360 px + watermark acak (tidak layak cetak)
 *   • dengan kode premium: lebar 720 px, bersih (unduhan HD tetap lewat
 *                          renderStrip yang dijatah per kode)
 * Foto yang diterima dibatasi kecil (sisi ≤ PRATINJAU_FOTO_SISI) supaya
 * decode-nya ringan walau dipanggil tanpa login.
 */
async function renderPreview(o) {
  if (!siap) throw new Error(alasanTidakSiap || "render server tidak aktif");
  const frameId = teks(o.frameId);
  if (!bingkaiDikenal(frameId)) {
    const err = new Error("bingkai tidak dikenal");
    err.code = "BAD_FRAME";
    throw err;
  }
  const { createCanvas, loadImage } = canvasLib;
  const N = renderer.PHOTO_COUNT;
  const photos = Array.isArray(o.photos) ? o.photos.slice(0, N) : [];
  if (photos.length < N) {
    const err = new Error(`butuh ${N} foto`);
    err.code = "BAD_PHOTO";
    throw err;
  }
  const images = [];
  for (const p of photos) {
    let img;
    try {
      img = parseImageDataUrl(p, {
        maxSide: PRATINJAU.FOTO_SISI,
        maxPixels: PRATINJAU.FOTO_SISI * PRATINJAU.FOTO_SISI,
      });
    } catch (e) {
      const err = new Error(e.message);
      err.code = "BAD_PHOTO";
      throw err;
    }
    images.push(await loadImage(img.buffer));
  }

  const width = o.premium ? PRATINJAU.LEBAR_PREMIUM : PRATINJAU.LEBAR_GRATIS;
  const canvas = createCanvas(width, Math.ceil(renderer.stripHeight(width)));
  renderer.drawStrip(canvas.getContext("2d"), images, {
    width,
    frameId,
    filter: teks(o.filter) || "warna",
    watermark: !o.premium,
    dateText: teks(o.dateText),
  });
  return canvas.toBuffer("image/jpeg", { quality: o.premium ? 0.85 : 0.72 });
}

// Thumbnail bingkai (tanpa foto pembeli) — sama untuk semua orang, jadi
// cukup dibuat sekali per bingkai lalu disimpan di memori.
const cacheThumb = new Map();
function renderThumb(id) {
  if (!siap) throw new Error(alasanTidakSiap || "render server tidak aktif");
  if (!bingkaiDikenal(id)) return null;
  if (!cacheThumb.has(id)) {
    const W = 104, H = 148;
    const canvas = canvasLib.createCanvas(W, H);
    renderer.drawThumb(canvas.getContext("2d"), id, W, H);
    cacheThumb.set(id, canvas.toBuffer("image/png"));
  }
  return cacheThumb.get(id);
}

module.exports = { init, tersedia, status, renderStrip, renderPreview, renderThumb, BATAS, jepit };
