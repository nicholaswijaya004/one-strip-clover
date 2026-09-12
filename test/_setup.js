/**
 * Dipanggil PALING ATAS di setiap berkas tes yang menyentuh data.
 *
 * Mengarahkan DATA_DIR ke folder sementara, supaya tes TIDAK PERNAH
 * menyentuh data/codes.json asli. Sebelum ini, menjalankan `npm test`
 * bisa menimpa kode yang sudah kamu jual.
 *
 * Harus dipanggil SEBELUM `require("../lib/...")` — modul membaca
 * lokasinya sekali saat dimuat.
 */
const fs = require("fs");
const os = require("os");
const path = require("path");

function pakaiDataSementara() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "osc-test-"));
  process.env.DATA_DIR = dir;
  return dir;
}

module.exports = { pakaiDataSementara };
