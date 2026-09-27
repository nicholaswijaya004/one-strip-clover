/**
 * PEMBATAS PEKERJAAN BERSAMAAN (semaphore tanpa antrean)
 *
 * Rate limit menjawab "berapa kali per jam", bukan "berapa yang jalan
 * SEKARANG". Render strip & parsing unggahan 25 MB itu berat di CPU/RAM —
 * 30 permintaan sah yang datang di detik yang sama tetap bisa membuat
 * server kehabisan memori. Pembatas ini menolak kelebihannya dengan 503
 * (browser mencoba lagi) daripada membiarkan seluruh server tumbang.
 *
 * Sengaja TIDAK mengantre: antrean panjang = permintaan menggantung dan
 * memori tetap terpakai. Gagal cepat lebih jujur.
 */

function createLimiter(max) {
  if (!(max >= 1)) throw new Error("max harus >= 1");
  let aktif = 0;

  return {
    /** @returns {boolean} true kalau dapat jatah — WAJIB diikuti release() */
    tryAcquire() {
      if (aktif >= max) return false;
      aktif++;
      return true;
    },
    release() {
      if (aktif > 0) aktif--;
    },
    get active() {
      return aktif;
    },
    max,
  };
}

module.exports = { createLimiter };
