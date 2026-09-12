/**
 * Penyimpanan JSON yang AMAN untuk codes.json.
 *
 * Dua masalah yang diperbaiki dari versi lama:
 *
 * 1. BALAPAN BACA-UBAH-TULIS (data hilang)
 *    Dua permintaan bersamaan sama-sama membaca seluruh file, mengubah
 *    bagiannya masing-masing, lalu menulis ulang SELURUH file. Yang menulis
 *    belakangan menimpa perubahan yang pertama.
 *    Akibat nyata: kode A ditukar dan kode B ditukar pada saat yang sama →
 *    salah satu penukaran hilang, kodenya kembali "belum dipakai" dan bisa
 *    dipakai orang lain lagi.
 *    Solusi: semua perubahan diantrekan (satu per satu), jadi tiap perubahan
 *    selalu membaca kondisi terbaru.
 *
 * 2. TULISAN TIDAK ATOMIK (file rusak)
 *    writeFileSync menimpa file di tempat. Kalau proses mati/kehabisan disk di
 *    tengah penulisan, codes.json jadi separuh dan SEMUA kode hilang.
 *    Solusi: tulis ke file sementara, fsync, baru rename (atomik di POSIX),
 *    plus simpan satu salinan cadangan .bak.
 */

const fs = require("fs");
const path = require("path");

function createJsonStore(filePath, { fallback = {} } = {}) {
  const tmpPath = `${filePath}.tmp`;
  const bakPath = `${filePath}.bak`;
  let antrean = Promise.resolve(); // rantai janji = kunci antre sederhana

  function readSync() {
    try {
      if (!fs.existsSync(filePath)) return { ...fallback };
      const teks = fs.readFileSync(filePath, "utf8");
      if (!teks.trim()) return { ...fallback };
      return JSON.parse(teks);
    } catch (e) {
      // File rusak → coba cadangan sebelum menyerah
      try {
        if (fs.existsSync(bakPath)) {
          const cadangan = JSON.parse(fs.readFileSync(bakPath, "utf8"));
          console.error(`⚠️  ${path.basename(filePath)} rusak, memakai cadangan .bak`);
          return cadangan;
        }
      } catch (e2) {
        /* cadangan ikut rusak */
      }
      throw new Error(`${path.basename(filePath)} rusak & tidak ada cadangan: ${e.message}`);
    }
  }

  function writeSync(data) {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    // simpan cadangan versi sebelumnya
    try {
      if (fs.existsSync(filePath)) fs.copyFileSync(filePath, bakPath);
    } catch (e) {
      /* cadangan gagal bukan alasan membatalkan penulisan */
    }

    const fd = fs.openSync(tmpPath, "w");
    try {
      fs.writeFileSync(fd, JSON.stringify(data, null, 2), "utf8");
      fs.fsyncSync(fd); // pastikan benar-benar sampai disk sebelum rename
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tmpPath, filePath); // atomik
  }

  /**
   * Ubah isi file dengan aman. Fungsi `mutator` menerima data terbaru,
   * boleh mengubahnya, dan nilai kembaliannya dikirim balik ke pemanggil.
   * Semua pemanggilan dijalankan berurutan, tidak pernah tumpang tindih.
   */
  function update(mutator) {
    const hasil = antrean.then(async () => {
      const data = readSync();
      const keluaran = await mutator(data);
      writeSync(data);
      return keluaran;
    });
    // rantai tetap jalan walau salah satu gagal
    antrean = hasil.then(
      () => undefined,
      () => undefined
    );
    return hasil;
  }

  return { read: readSync, update, _writeSync: writeSync };
}

module.exports = { createJsonStore };
