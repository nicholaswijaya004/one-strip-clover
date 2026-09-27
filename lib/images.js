/**
 * VALIDASI GAMBAR KIRIMAN PENGGUNA
 *
 * Kenapa perlu:
 *   1. Bom dekompresi. JPEG 8 MB bisa berukuran 30.000 x 30.000 piksel —
 *      begitu di-decode butuh ±3,6 GB RAM dan server langsung mati (OOM).
 *      Ukuran piksel dibaca dari HEADER berkas (murah, tanpa decode) lalu
 *      ditolak sebelum menyentuh pustaka gambar.
 *   2. Berkas palsu. "foto" yang isinya HTML/EXE akan ikut terlampir di
 *      email studio dengan nama .jpg. Magic bytes diperiksa, bukan hanya
 *      awalan "data:image/jpeg" yang bisa ditulis siapa saja.
 *
 * Murni JavaScript, tanpa dependency.
 */

const { jpegSize } = require("./pdf");

const MIME = { JPEG: "image/jpeg", PNG: "image/png" };

/** Batas bawaan — longgar untuk kamera HP modern, ketat untuk serangan */
const BATAS = {
  FOTO_BYTE: 8 * 1024 * 1024,
  FOTO_SISI: 6000,
  FOTO_PIKSEL: 24 * 1000 * 1000, // 24 MP ≈ 96 MB RAM saat di-decode
};

function isJpeg(buf) {
  return buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
}

function isPng(buf) {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  return buf.length > 24 && sig.every((b, i) => buf[i] === b);
}

function pngSize(buf) {
  // IHDR selalu chunk pertama: lebar @16, tinggi @20 (big-endian)
  if (buf.toString("latin1", 12, 16) !== "IHDR") throw new Error("PNG tanpa IHDR");
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

/** Jenis & ukuran piksel dari isi berkas (bukan dari klaim pengirim) */
function sniff(buf) {
  if (isJpeg(buf)) return { mime: MIME.JPEG, ...jpegSize(buf) };
  if (isPng(buf)) return { mime: MIME.PNG, ...pngSize(buf) };
  throw new Error("bukan berkas JPEG/PNG");
}

/**
 * Urai & periksa satu data URL gambar.
 * @param {string} dataUrl  "data:image/jpeg;base64,...."
 * @param {object} opts { allowed:[mime], maxBytes, maxSide, maxPixels }
 * @returns {{mime:string, buffer:Buffer, width:number, height:number}}
 * @throws Error dengan pesan yang aman ditampilkan
 */
function parseImageDataUrl(dataUrl, opts = {}) {
  const allowed = opts.allowed || [MIME.JPEG, MIME.PNG];
  const maxBytes = opts.maxBytes || BATAS.FOTO_BYTE;
  const maxSide = opts.maxSide || BATAS.FOTO_SISI;
  const maxPixels = opts.maxPixels || BATAS.FOTO_PIKSEL;

  if (typeof dataUrl !== "string") throw new Error("format gambar tidak valid");
  const m = /^data:(image\/(?:jpeg|png));base64,/.exec(dataUrl.slice(0, 40));
  if (!m) throw new Error("format gambar tidak valid");

  const b64 = dataUrl.slice(m[0].length);
  // Perkiraan ukuran SEBELUM decode, supaya string raksasa tidak dialokasi dua kali
  if (Math.floor((b64.length * 3) / 4) > maxBytes + 3) throw new Error("gambar terlalu besar");

  const buffer = Buffer.from(b64, "base64");
  if (buffer.length === 0) throw new Error("gambar kosong");
  if (buffer.length > maxBytes) throw new Error("gambar terlalu besar");

  const info = sniff(buffer);
  if (!allowed.includes(info.mime)) throw new Error("jenis gambar tidak diizinkan");
  if (!info.width || !info.height) throw new Error("ukuran gambar tidak terbaca");
  if (info.width > maxSide || info.height > maxSide) throw new Error("dimensi gambar terlalu besar");
  if (info.width * info.height > maxPixels) throw new Error("dimensi gambar terlalu besar");

  return { mime: info.mime, buffer, width: info.width, height: info.height };
}

module.exports = { parseImageDataUrl, sniff, isJpeg, isPng, pngSize, MIME, BATAS };
