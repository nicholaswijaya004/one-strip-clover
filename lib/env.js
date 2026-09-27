/**
 * VALIDASI KONFIGURASI SAAT START
 *
 * Prinsip "gagal cepat": kalau produksi dinyalakan dengan rahasia kosong
 * atau lemah, lebih baik server MENOLAK hidup (deploy terlihat gagal,
 * kamu langsung tahu) daripada hidup dengan celah diam-diam:
 *
 *   • SESSION_SECRET kosong → dulu jatuh ke ADMIN_KEY. Satu rahasia dipakai
 *     dua tugas: kalau salah satunya bocor, keduanya jebol.
 *   • SESSION_SECRET pendek → token premium bisa ditebak/dipalsukan =
 *     fitur berbayar gratis untuk siapa pun.
 *   • ADMIN_KEY pendek → panel admin (buat kode = buat uang) bisa ditebak.
 *
 * Di luar produksi (laptop, tes) hanya peringatan, supaya `npm start`
 * tetap jalan tanpa .env.
 */

const crypto = require("crypto");

const MIN_SESSION_SECRET = 32;
const MIN_ADMIN_KEY = 16;

function isProduction(env = process.env) {
  return String(env.NODE_ENV || "").toLowerCase() === "production";
}

/**
 * @returns {{errors:string[], warnings:string[], sessionSecret:string}}
 */
function checkConfig(env = process.env) {
  const errors = [];
  const warnings = [];
  const prod = isProduction(env);
  const complain = (msg) => (prod ? errors : warnings).push(msg);

  let sessionSecret = env.SESSION_SECRET || "";
  if (!sessionSecret) {
    complain("SESSION_SECRET belum diisi (buat dengan: openssl rand -hex 32)");
    // Laptop/tes: acak tiap start. Token hangus saat restart, tapi aman.
    sessionSecret = crypto.randomBytes(32).toString("hex");
  } else if (sessionSecret.length < MIN_SESSION_SECRET) {
    complain(`SESSION_SECRET terlalu pendek (min ${MIN_SESSION_SECRET} karakter)`);
  }
  if (env.SESSION_SECRET && env.ADMIN_KEY && env.SESSION_SECRET === env.ADMIN_KEY) {
    complain("SESSION_SECRET tidak boleh sama dengan ADMIN_KEY");
  }

  if (!env.ADMIN_KEY) {
    warnings.push("ADMIN_KEY belum diisi — halaman /admin nonaktif");
  } else if (env.ADMIN_KEY.length < MIN_ADMIN_KEY) {
    complain(`ADMIN_KEY terlalu pendek (min ${MIN_ADMIN_KEY} karakter)`);
  }

  const tp = env.TRUST_PROXY;
  if (tp != null && tp !== "" && parseTrustProxy(tp) === undefined) {
    complain(`TRUST_PROXY tidak dikenali: "${tp}" (pakai angka hop, mis. 1, atau false)`);
  }

  return { errors, warnings, sessionSecret };
}

/**
 * Berapa hop proxy yang dipercaya untuk X-Forwarded-For.
 * Salah setel = rate limit bisa diakali: kalau server TIDAK di belakang
 * proxy tapi kita percaya 1 hop, penyerang cukup mengirim header
 * X-Forwarded-For palsu untuk mendapat "IP baru" di setiap permintaan.
 * Railway/Render = 1 hop (bawaan). Tanpa proxy: TRUST_PROXY=false.
 */
function parseTrustProxy(v) {
  if (v == null || v === "") return 1;
  const s = String(v).trim().toLowerCase();
  if (s === "false" || s === "0") return false;
  if (/^\d+$/.test(s)) return Number(s);
  return undefined;
}

module.exports = { checkConfig, isProduction, parseTrustProxy, MIN_SESSION_SECRET, MIN_ADMIN_KEY };
