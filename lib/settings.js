/**
 * SETELAN YANG BISA DIUBAH SAAT SERVER JALAN
 *
 * Beda dengan .env:
 *   .env      → dibaca sekali saat start, mengubahnya butuh restart server
 *   file ini  → bisa diubah dari halaman /admin, langsung berlaku
 *
 * Dipakai untuk angka-angka yang mungkin ingin kamu setel setelah melihat
 * keluhan pembeli sungguhan — mis. berapa perangkat yang boleh memakai satu
 * kode. Menunggu deploy hanya untuk mengganti angka 1 jadi 2 itu tidak masuk akal.
 *
 * Nilai awal diambil dari .env, lalu bisa ditimpa lewat /admin.
 * Semua nilai DIBATASI rentangnya supaya salah ketik tidak membuka celah.
 */

const path = require("path");
const { createJsonStore } = require("./store");

const FILE = path.join(__dirname, "..", "data", "settings.json");
const store = createJsonStore(FILE);

/**
 * Definisi setelan: batas bawah/atas dijaga di sini, bukan di UI —
 * UI bisa diakali, server tidak.
 */
const SKEMA = {
  maxDevicesPerCode: {
    label: "Perangkat per kode",
    keterangan:
      "Berapa perangkat berbeda yang boleh memakai satu kode. " +
      "1 = paling ketat. 2 memberi ruang untuk pembeli yang pindah dari " +
      "browser dalam aplikasi (TikTok/Instagram) ke browser biasa.",
    min: 1,
    max: 5,
    envKey: "MAX_DEVICES_PER_CODE",
    bawaan: 2,
  },
  maxStudioSubmissions: {
    label: "Pesanan studio per kode",
    keterangan:
      "Berapa kali satu kode boleh memesan strip cetak. " +
      "Tiap pesanan = kerja manual + cetak + ongkir yang kamu tanggung.",
    min: 1,
    max: 5,
    envKey: "MAX_STUDIO_SUBMISSIONS",
    bawaan: 1,
  },
  redeemGraceHours: {
    label: "Batas waktu kode (jam)",
    keterangan:
      "Setelah ditukar tapi BELUM dipakai memesan, berapa lama kode masih " +
      "bisa dipakai masuk lagi. Kode tetap hangus seketika begitu memesan.",
    min: 0.5,
    max: 72,
    envKey: "REDEEM_GRACE_HOURS",
    bawaan: 3,
  },
};

function bawaanDariEnv(env = process.env) {
  const out = {};
  for (const [k, def] of Object.entries(SKEMA)) {
    const dariEnv = Number(env[def.envKey]);
    out[k] = Number.isFinite(dariEnv) ? batasi(k, dariEnv) : def.bawaan;
  }
  return out;
}

function batasi(kunci, nilai) {
  const def = SKEMA[kunci];
  if (!def) return nilai;
  const n = Number(nilai);
  if (!Number.isFinite(n)) return def.bawaan;
  return Math.min(Math.max(n, def.min), def.max);
}

/** Setelan efektif = bawaan dari .env, ditimpa yang tersimpan dari /admin */
function all(env = process.env) {
  let tersimpan = {};
  try {
    tersimpan = store.read() || {};
  } catch {
    tersimpan = {};
  }
  const hasil = bawaanDariEnv(env);
  for (const kunci of Object.keys(SKEMA)) {
    if (tersimpan[kunci] != null) hasil[kunci] = batasi(kunci, tersimpan[kunci]);
  }
  return hasil;
}

function get(kunci, env = process.env) {
  return all(env)[kunci];
}

/** Simpan perubahan dari /admin. Mengembalikan setelan efektif terbaru. */
async function update(perubahan, env = process.env) {
  const bersih = {};
  for (const [k, v] of Object.entries(perubahan || {})) {
    if (!SKEMA[k]) continue; // abaikan kunci yang tidak dikenal
    bersih[k] = batasi(k, v);
  }
  await store.update((data) => {
    Object.assign(data, bersih);
  });
  return all(env);
}

module.exports = { all, get, update, SKEMA, batasi, FILE };
