const { ERR, LIMIT } = require("../public/shared/contract.js");

/**
 * Pembentuk label & validasi input pesanan studio.
 * Dipisah dari server.js agar bisa diuji unit.
 */

/** Buang karakter yang bikin nama file/folder & subject email rusak */
function clean(v, max) {
  return String(v == null ? "" : v)
    .replace(/[\\/:*?"<>|\r\n\t]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max || 60);
}

/** Tanggal & jam WIB, format: 2026-07-28 18.07 */
function takenLabel(takenAt, nowFn = () => new Date()) {
  const t =
    takenAt && !isNaN(Date.parse(takenAt)) ? new Date(takenAt) : nowFn();
  return t
    .toLocaleString("id-ID", {
      timeZone: "Asia/Jakarta",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    })
    .replace(/(\d{2})\/(\d{2})\/(\d{4})/, "$3-$2-$1")
    .replace(",", "")
    .trim();
}

/** "Nama - kontak - tanggal - kode" (nama folder Drive & subject email) */
function buildLabel({ name, email, wa, contact, takenAt, code }, nowFn) {
  return [
    clean(name, 40),
    clean(email || wa || contact, 40),
    takenLabel(takenAt, nowFn),
    clean(code, 15),
  ].join(" - ");
}

/** Nomor pesanan: OSC260728-A3F9C1 */
function buildRef(rid, date = new Date()) {
  const d = date.toISOString().slice(2, 10).replace(/-/g, "");
  return `OSC${d}-${String(rid || "").toUpperCase()}`;
}

// Domain dipecah per label tanpa titik → tidak ada dua bagian yang bisa
// mencocokkan karakter yang sama (bebas ReDoS), dan tetap menerima a@b.co.id.
const EMAIL_RE = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/;

/** true kalau email berbentuk wajar. Panjang dicek DULU (murah) sebelum regex. */
function isEmail(v) {
  const s = String(v == null ? "" : v).trim();
  return s.length > 0 && s.length <= 254 && EMAIL_RE.test(s);
}
const WA_RE = /^[0-9+()\-\s]{8,20}$/;

/**
 * Validasi payload "Kirim ke Studio".
 * @returns {null|string} null kalau valid, atau kode error.
 */
function validateOrder(body, opts = {}) {
  const maxPhotos = opts.maxPhotos || LIMIT.FOTO_MAKS;
  const b = body || {};

  if (!b.consent) return ERR.CONSENT_REQUIRED;
  if (!Array.isArray(b.photos) || b.photos.length === 0) return ERR.NO_PHOTOS;
  if (b.photos.length > maxPhotos) return ERR.TOO_MANY;
  if (!b.name || !String(b.name).trim()) return ERR.NAME_REQUIRED;
  if (!b.email && !b.wa && !b.contact) return ERR.CONTACT_REQUIRED;
  if (b.email && !isEmail(b.email)) return ERR.BAD_EMAIL;
  if (b.wa && !WA_RE.test(String(b.wa).trim())) return ERR.BAD_WA;
  if (!b.address || String(b.address).trim().length < LIMIT.ALAMAT_MIN) return ERR.ADDRESS_REQUIRED;
  return null;
}

module.exports = { clean, takenLabel, buildLabel, buildRef, validateOrder, isEmail, EMAIL_RE, WA_RE };
