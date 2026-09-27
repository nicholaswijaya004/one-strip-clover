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
 *
 * 3. BACA ULANG SELURUH FILE DI SETIAP PERMINTAAN (lambat & memblokir)
 *    Setiap /api/redeem, /api/session, /healthz membaca + JSON.parse SELURUH
 *    codes.json secara sinkron. Dengan 50.000 kode (±5 MB) itu puluhan ms
 *    per permintaan di thread tunggal Node — cukup 20 permintaan/detik untuk
 *    membuat server macet total.
 *    Solusi: simpan hasil parse di memori, dan hanya baca ulang kalau berkas
 *    di disk BERUBAH (dicek lewat stat: inode, mtime, ukuran — murah).
 *    Skrip terminal (npm run codes) yang menulis berkas dari proses lain
 *    tetap langsung terlihat.
 */

const fs = require("fs");
const path = require("path");

function createJsonStore(filePath, { fallback = {} } = {}) {
  const tmpPath = `${filePath}.tmp`;
  const bakPath = `${filePath}.bak`;
  let antrean = Promise.resolve(); // rantai janji = kunci antre sederhana

  // Cache hasil parse + sidik berkas saat dibaca
  let cache = null;
  let sidikCache = null;

  const sidik = (st) => `${st.ino}:${st.mtimeMs}:${st.ctimeMs}:${st.size}`;

  function invalidate() {
    cache = null;
    sidikCache = null;
  }

  /**
   * Baca isi berkas. PENTING: yang dikembalikan adalah objek cache bersama.
   * Pemanggil yang mengubahnya WAJIB langsung menyimpannya (writeSync/update)
   * di giliran event-loop yang sama — pola yang sudah dipakai server.js.
   */
  function readSync() {
    let st;
    try {
      st = fs.statSync(filePath);
    } catch {
      invalidate();
      return { ...fallback };
    }
    if (cache && sidikCache === sidik(st)) return cache;

    try {
      const teks = fs.readFileSync(filePath, "utf8");
      if (!teks.trim()) {
        invalidate();
        return { ...fallback };
      }
      const data = JSON.parse(teks);
      cache = data;
      sidikCache = sidik(st);
      return data;
    } catch (e) {
      invalidate();
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
      throw new Error(`${path.basename(filePath)} rusak & tidak ada cadangan: ${e.message}`, { cause: e });
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

    try {
      const fd = fs.openSync(tmpPath, "w");
      try {
        fs.writeFileSync(fd, JSON.stringify(data, null, 2), "utf8");
        fs.fsyncSync(fd); // pastikan benar-benar sampai disk sebelum rename
      } finally {
        fs.closeSync(fd);
      }
      fs.renameSync(tmpPath, filePath); // atomik
    } catch (e) {
      // Disk penuh / izin: isi cache mungkin sudah diubah pemanggil tapi
      // tidak tersimpan. Buang cache supaya bacaan berikutnya = isi disk.
      invalidate();
      throw e;
    }
    try {
      cache = data;
      sidikCache = sidik(fs.statSync(filePath));
    } catch {
      invalidate();
    }
  }

  /**
   * Ubah isi file dengan aman. Fungsi `mutator` menerima data terbaru,
   * boleh mengubahnya, dan nilai kembaliannya dikirim balik ke pemanggil.
   * Semua pemanggilan dijalankan berurutan, tidak pernah tumpang tindih.
   */
  function update(mutator) {
    const hasil = antrean.then(async () => {
      const data = readSync();
      let keluaran;
      try {
        keluaran = await mutator(data);
      } catch (e) {
        invalidate(); // mutator gagal di tengah jalan → cache bisa setengah berubah
        throw e;
      }
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

  return { read: readSync, update, invalidate, _writeSync: writeSync };
}

module.exports = { createJsonStore };
