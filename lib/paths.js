/**
 * LOKASI FOLDER DATA
 *
 * Semua modul yang menyimpan data jalan (kode, setelan, template, antrean,
 * log) HARUS mengambil lokasinya dari sini — jangan menulis path sendiri.
 *
 * Kenapa perlu satu tempat:
 *   Dulu tiap modul menghitung path-nya masing-masing ke `data/`. Akibatnya
 *   tes unit menulis ke data/codes.json ASLI — kode yang sudah kamu jual
 *   ikut terhapus/tertimpa setiap kali `npm test` dijalankan. Dengan
 *   DATA_DIR, tes cukup mengarahkannya ke folder sementara.
 *
 * Dipakai juga saat deploy: di Railway, volume bisa di-mount di mana saja
 * lalu DATA_DIR diarahkan ke sana tanpa mengubah kode.
 */

const path = require("path");

const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(__dirname, "..", "data");

const di = (...bagian) => path.join(DATA_DIR, ...bagian);

module.exports = {
  DATA_DIR,
  di,
  CODES_FILE: di("codes.json"),
  SETTINGS_FILE: di("settings.json"),
  TEMPLATE_DIR: di("template"),
  PENDING_DIR: di("pending"),
  FAILED_DIR: di("failed"),
  BACKUP_DIR: di("backups"),
  APP_LOG: di("app.log"),
  ORDER_LOG: di("orders.log"),
};
