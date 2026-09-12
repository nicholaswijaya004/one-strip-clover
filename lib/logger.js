/**
 * LOGGER — tulis ke console + file di data/ (ikut persistent volume)
 *
 * File yang dihasilkan:
 *   data/app.log     → semua kejadian teknis (debug, error, request)
 *   data/orders.log  → catatan bisnis: pesanan studio & kode ditukar
 *
 * Kenapa dua file?
 *   app.log berisik dan cepat besar (dipakai saat debugging).
 *   orders.log rapi, jarang berubah, dan aman dibaca kapan pun untuk
 *   menjawab "pesanan si A tanggal sekian benar masuk tidak?".
 *
 * File dirotasi otomatis kalau lewat 5 MB (jadi .1), supaya disk tidak penuh.
 */

const fs = require("fs");
const path = require("path");

const DIR = path.join(__dirname, "..", "data");
const APP_LOG = path.join(DIR, "app.log");
const ORDER_LOG = path.join(DIR, "orders.log");
const MAX_BYTES = 5 * 1024 * 1024;

function ensureDir() {
  try {
    if (!fs.existsSync(DIR)) fs.mkdirSync(DIR, { recursive: true });
  } catch (e) {
    /* diabaikan: kalau gagal, logging file dimatikan sendiri di append() */
  }
}

function rotate(file) {
  try {
    if (fs.existsSync(file) && fs.statSync(file).size > MAX_BYTES) {
      fs.renameSync(file, `${file}.1`); // yang lama ditimpa, simpan 1 generasi
    }
  } catch (e) {
    /* abaikan */
  }
}

function append(file, text) {
  try {
    ensureDir();
    rotate(file);
    fs.appendFileSync(file, text + "\n", "utf8");
  } catch (e) {
    console.error("⚠️  gagal menulis log:", e.message);
  }
}

const wib = (d) =>
  (d || new Date()).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" });

/** ubah objek jadi `key=value` yang gampang di-grep */
function fmt(fields) {
  if (!fields) return "";
  return Object.entries(fields)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => {
      // Buang baris baru & kutip: tanpa ini, nama berisi "\n2026-01-01 [ORDER]..."
      // bisa menyisipkan baris log palsu (log injection).
      const s = String(v)
        .replace(/[\r\n\t]/g, " ")
        .replace(/"/g, "'")
        .replace(/\s+/g, " ")
        .slice(0, 300);
      return s.includes(" ") ? `${k}="${s}"` : `${k}=${s}`;
    })
    .join(" ");
}

function line(level, event, fields) {
  return `${new Date().toISOString()} [${level.padEnd(5)}] ${event} ${fmt(fields)}`.trim();
}

const ICON = { INFO: "·", WARN: "⚠️ ", ERROR: "❌", ORDER: "📮" };

function emit(level, event, fields, alsoOrders) {
  const l = line(level, event, fields);
  if (level === "ERROR") console.error(`${ICON[level]} ${event}`, fmt(fields));
  else if (level === "WARN") console.warn(`${ICON[level]} ${event}`, fmt(fields));
  else console.log(`${ICON[level] || "·"} ${event}`, fmt(fields));
  append(APP_LOG, l);
  if (alsoOrders) append(ORDER_LOG, l);
}

module.exports = {
  info: (event, fields) => emit("INFO", event, fields),
  warn: (event, fields) => emit("WARN", event, fields),
  error: (event, fields) => emit("ERROR", event, fields),

  /** kejadian bisnis: ikut masuk orders.log */
  order: (event, fields) => emit("ORDER", event, fields, true),

  /** blok multi-baris yang enak dibaca manusia di orders.log */
  orderBlock: (title, obj) => {
    const aman = (v) =>
      v == null ? "-" : String(v).replace(/[\r\n]/g, " ").slice(0, 400);
    const body = Object.entries(obj)
      .map(([k, v]) => `  ${k.padEnd(14)}: ${aman(v)}`)
      .join("\n");
    append(
      ORDER_LOG,
      `\n=== ${title} — ${wib()} WIB ===\n${body}\n`
    );
  },

  /** baca N baris terakhir sebuah log */
  tail(which, n) {
    const file = which === "orders" ? ORDER_LOG : APP_LOG;
    try {
      if (!fs.existsSync(file)) return [];
      const txt = fs.readFileSync(file, "utf8");
      return txt.split("\n").filter(Boolean).slice(-(n || 100));
    } catch (e) {
      return [`(gagal membaca log: ${e.message})`];
    }
  },

  files: { APP_LOG, ORDER_LOG },
};
