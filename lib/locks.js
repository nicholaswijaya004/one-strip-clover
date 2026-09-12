/**
 * Kunci antre per kode.
 *
 * Kenapa perlu:
 *   Pemeriksaan jatah ("sudah 1 dari 2") dan penambahan hitungannya terpisah
 *   oleh proses kirim email/Drive yang makan beberapa detik. Kalau pembeli
 *   menekan "Kirim" dua kali cepat — atau membuka 2 tab — kedua permintaan
 *   bisa sama-sama membaca "baru 1", sama-sama lolos, lalu sama-sama kirim.
 *   Akibatnya jatah 2 bisa jebol jadi 3+.
 *
 * Solusinya: satu kode hanya boleh diproses satu per satu.
 * Permintaan kedua langsung ditolak, bukan diantrekan — pembeli lebih baik
 * dapat pesan "sedang diproses" daripada menunggu lama tanpa kejelasan.
 */

function createLocks() {
  const aktif = new Map(); // kode -> waktu mulai

  /** @returns {boolean} true kalau berhasil mengunci */
  function acquire(key, now = Date.now()) {
    if (!key) return false;
    const mulai = aktif.get(key);
    // Pengaman: kunci yang menggantung >2 menit dianggap basi (mis. proses crash)
    if (mulai && now - mulai < 2 * 60 * 1000) return false;
    aktif.set(key, now);
    return true;
  }

  function release(key) {
    aktif.delete(key);
  }

  function isLocked(key, now = Date.now()) {
    const mulai = aktif.get(key);
    return !!mulai && now - mulai < 2 * 60 * 1000;
  }

  return { acquire, release, isLocked, size: () => aktif.size };
}

module.exports = { createLocks };
