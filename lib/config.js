/**
 * Konfigurasi publik yang boleh dilihat pengunjung (link toko, harga).
 *
 * Diambil dari .env, BUKAN ditulis di index.html, supaya:
 *   • ganti harga/link cukup edit .env + restart, tanpa menyentuh kode
 *   • setelan tidak hilang saat kamu menimpa file website dengan versi baru
 *   • bisa beda antara laptop (uji coba) dan server (produksi)
 *
 * Fungsi murni supaya gampang diuji.
 */

/** Buang spasi & tolak nilai contoh yang belum diganti */
function bersih(v) {
  const s = String(v == null ? "" : v).trim();
  if (!s) return "";
  // placeholder yang belum diisi jangan sampai tampil sebagai tombol rusak
  if (s.includes("...") || s.toLowerCase().includes("example.com")) return "";
  return s;
}

/** Nomor WA → hanya angka (wa.me tidak menerima + atau spasi) */
function nomorWa(v) {
  const digits = bersih(v).replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 15) return "";
  return digits;
}

function buildPublicConfig(env = {}, extra = {}) {
  const shops = {
    tiktok: bersih(env.SHOP_TIKTOK),
    tokopedia: bersih(env.SHOP_TOKOPEDIA),
    shopee: bersih(env.SHOP_SHOPEE),
    whatsapp: nomorWa(env.SHOP_WHATSAPP),
  };

  // hanya http(s) yang boleh jadi tautan
  for (const k of ["tiktok", "tokopedia", "shopee"]) {
    if (shops[k] && !/^https?:\/\//i.test(shops[k])) shops[k] = "";
  }

  return {
    ok: true,
    price: bersih(env.PREMIUM_PRICE),
    shops,
    hasShop: Object.values(shops).some(Boolean),
    sessionHours: extra.sessionHours ?? Number(env.SESSION_HOURS || 3),
    graceHours: extra.graceHours ?? Number(env.REDEEM_GRACE_HOURS || 3),
  };
}

module.exports = { buildPublicConfig, bersih, nomorWa };
