/**
 * Pembuat kode akses — dipakai bersama oleh:
 *   • scripts/generate-codes.js   (terminal)
 *   • POST /api/admin/generate    (tombol di halaman /admin)
 *
 * Ditaruh di satu tempat supaya logikanya tidak kembar dan bisa beda perilaku.
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { createJsonStore } = require("./store");

const { DATA_DIR: DIR } = require("./paths");
const CODES_FILE = path.join(DIR, "codes.json");

// Satu penyimpanan bersama: tulisan atomik + antre, jadi tidak ada
// perubahan yang saling menimpa (lihat lib/store.js)
const store = createJsonStore(CODES_FILE);

// Tanpa huruf/angka yang mirip (0/O, 1/I/L) supaya pembeli tidak salah ketik
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

// 8 karakter dari 31 simbol = 31^8 ≈ 852 miliar kombinasi.
// Dulu 6 karakter (≈ 887 juta): dengan 10.000 kode beredar, penyerang
// yang memutar IP hanya butuh ±88.000 tebakan untuk dapat satu kode gratis.
// Kode lama (6 karakter) tetap berlaku — yang berubah hanya kode baru.
const PANJANG_KODE = 8;

/**
 * Karakter acak TANPA bias modulo. `byte % 31` membuat 8 huruf pertama
 * alfabet muncul ±12% lebih sering (256 bukan kelipatan 31) — sedikit
 * memudahkan penebakan. crypto.randomInt memakai rejection sampling.
 */
function randomCode() {
  let s = "";
  for (let i = 0; i < PANJANG_KODE; i++) s += ALPHABET[crypto.randomInt(ALPHABET.length)];
  return `${process.env.CODE_PREFIX || "OSC"}-${s}`;
}

function load() {
  return store.read();
}

function save(codes) {
  store._writeSync(codes);
}

/**
 * @param {number} count jumlah kode
 * @param {object} opts
 * @param {boolean} opts.forChatbot  true = langsung ditandai "issued"
 *        (karena kodenya diekspor ke pool chatbot, jadi tidak boleh
 *         dibagikan lagi lewat tombol di /admin → mencegah kode dobel)
 * @param {boolean} opts.writeFile   tulis data/batch-*.txt (default true)
 */
function generate(count, opts = {}) {
  // Perilaku yang bisa ditebak:
  //   angka valid → dibatasi 1..5000 (desimal dibulatkan ke bawah)
  //   bukan angka / kosong → pakai default 20
  const parsed = Number(count);
  const n = Number.isFinite(parsed)
    ? Math.max(1, Math.min(Math.floor(parsed), 5000))
    : 20;
  const forChatbot = !!opts.forChatbot;
  const writeFile = opts.writeFile !== false;

  const codes = load();
  const fresh = [];
  let guard = 0;

  while (fresh.length < n) {
    if (++guard > n * 50) throw new Error("gagal membuat kode unik");
    const c = randomCode();
    if (codes[c]) continue;
    codes[c] = {
      used: false,
      issued: forChatbot,
      createdAt: new Date().toISOString(),
      ...(forChatbot
        ? { issuedAt: new Date().toISOString(), buyer: "(batch chatbot)" }
        : {}),
    };
    fresh.push(c);
  }

  save(codes);

  let batchFile = null;
  if (writeFile) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    batchFile = path.join(
      DIR,
      `batch-${forChatbot ? "chatbot-" : "admin-"}${stamp}.txt`
    );
    fs.writeFileSync(batchFile, fresh.join("\n") + "\n");
  }

  return { codes: fresh, batchFile, total: Object.keys(codes).length };
}

function stats() {
  const list = Object.values(load());
  const isChatbot = (c) => c.buyer === "(batch chatbot)";
  return {
    total: list.length,
    redeemed: list.filter((c) => c.used).length,
    available: list.filter((c) => !c.issued && !c.used).length,
    chatbotStock: list.filter((c) => c.issued && isChatbot(c) && !c.used).length,
    adminIssued: list.filter((c) => c.issued && !isChatbot(c)).length,
    issued: list.filter((c) => c.issued).length,
  };
}

/** Perubahan aman-balapan: mutator menerima data terbaru, hasil ditulis atomik */
function update(mutator) {
  return store.update(mutator);
}

module.exports = { generate, stats, load, save, update, randomCode, CODES_FILE, ALPHABET, PANJANG_KODE };
