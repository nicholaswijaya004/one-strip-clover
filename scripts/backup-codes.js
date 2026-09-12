/**
 * CADANGKAN KODE
 *
 *   npm run backup            → simpan cadangan ke data/backups/
 *   npm run backup -- --list  → lihat daftar cadangan
 *
 * Kenapa perlu:
 *   codes.json adalah SATU-SATUNYA catatan kode yang sudah kamu jual.
 *   Kalau volume Railway salah konfigurasi, ter-reset, atau folder terhapus,
 *   semua pembeli kehilangan akses dan kamu tidak punya bukti apa pun.
 *
 * Jalankan rutin (mis. seminggu sekali), lalu UNDUH hasilnya ke laptop /
 * Google Drive. Cadangan yang tersimpan di server yang sama tidak menolong
 * kalau servernya yang hilang.
 */

const fs = require("fs");
const path = require("path");

const DATA = path.join(__dirname, "..", "data");
const SUMBER = path.join(DATA, "codes.json");
const FOLDER = path.join(DATA, "backups");
const SIMPAN_MAKS = 30; // cadangan lama otomatis dihapus

if (process.argv.includes("--list")) {
  if (!fs.existsSync(FOLDER)) {
    console.log("\nBelum ada cadangan.\n");
    process.exit(0);
  }
  const daftar = fs.readdirSync(FOLDER).filter((f) => f.endsWith(".json")).sort();
  console.log(`\n${daftar.length} cadangan di ${FOLDER}:\n`);
  for (const f of daftar) {
    const s = fs.statSync(path.join(FOLDER, f));
    console.log(`  ${f}  (${(s.size / 1024).toFixed(1)} KB)`);
  }
  console.log("");
  process.exit(0);
}

if (!fs.existsSync(SUMBER)) {
  console.error("\n❌ data/codes.json tidak ditemukan — tidak ada yang dicadangkan.\n");
  process.exit(1);
}

// Pastikan isinya JSON yang sah sebelum disimpan sebagai "cadangan baik"
let jumlah = 0;
try {
  const isi = JSON.parse(fs.readFileSync(SUMBER, "utf8"));
  jumlah = Object.keys(isi).length;
} catch (e) {
  console.error("\n❌ codes.json rusak, cadangan DIBATALKAN:", e.message);
  console.error("   Coba pulihkan dari data/codes.json.bak dulu.\n");
  process.exit(1);
}

fs.mkdirSync(FOLDER, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const tujuan = path.join(FOLDER, `codes-${stamp}.json`);
fs.copyFileSync(SUMBER, tujuan);

// Buang cadangan paling lama supaya disk tidak penuh
const semua = fs.readdirSync(FOLDER).filter((f) => f.endsWith(".json")).sort();
for (const f of semua.slice(0, Math.max(0, semua.length - SIMPAN_MAKS))) {
  fs.unlinkSync(path.join(FOLDER, f));
}

console.log(`\n✅ ${jumlah} kode dicadangkan → ${tujuan}`);
console.log(`   Menyimpan ${Math.min(semua.length, SIMPAN_MAKS)} cadangan terakhir.`);

// ---------------------------------------------------------------------
// Unggah ke Google Drive (GRATIS — pakai 15 GB akunmu, bukan S3 berbayar).
// Inilah yang membuat cadangan benar-benar berguna: kalau server hilang,
// cadangan yang ikut tersimpan di server itu ikut hilang juga.
// ---------------------------------------------------------------------
(async () => {
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN, DRIVE_FOLDER_ID } =
    process.env;

  if (!GOOGLE_CLIENT_ID || !GOOGLE_REFRESH_TOKEN || !DRIVE_FOLDER_ID) {
    console.log("\n⚠️  Drive belum dikonfigurasi — cadangan hanya ada di server ini.");
    console.log("   UNDUH file di atas ke laptopmu secara manual.\n");
    return;
  }

  try {
    const { google } = require("googleapis");
    const { Readable } = require("stream");
    const fs2 = require("fs");

    const oauth2 = new google.auth.OAuth2(
      GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI || "http://localhost:5555/oauth2callback"
    );
    oauth2.setCredentials({ refresh_token: GOOGLE_REFRESH_TOKEN });
    const drive = google.drive({ version: "v3", auth: oauth2 });

    // Folder khusus cadangan, dibuat sekali lalu dipakai terus
    const NAMA_FOLDER = "_BACKUP kode";
    const cari = await drive.files.list({
      q: `name='${NAMA_FOLDER}' and '${DRIVE_FOLDER_ID}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
      fields: "files(id)",
    });
    let folderId = cari.data.files && cari.data.files[0] && cari.data.files[0].id;
    if (!folderId) {
      const buat = await drive.files.create({
        requestBody: {
          name: NAMA_FOLDER,
          mimeType: "application/vnd.google-apps.folder",
          parents: [DRIVE_FOLDER_ID],
        },
        fields: "id",
      });
      folderId = buat.data.id;
    }

    await drive.files.create({
      requestBody: { name: path.basename(tujuan), parents: [folderId] },
      media: {
        mimeType: "application/json",
        body: Readable.from(fs2.readFileSync(tujuan)),
      },
      fields: "id",
    });

    console.log(`\n☁️  Terunggah juga ke Google Drive → folder "${NAMA_FOLDER}"`);
    console.log("   Aman walau server hilang total.\n");
  } catch (e) {
    console.error("\n⚠️  Gagal mengunggah ke Drive:", e.message);
    console.error("   Cadangan lokal tetap ada. UNDUH manual sebagai gantinya.\n");
    process.exitCode = 0; // cadangan lokal sudah berhasil, jangan dianggap gagal total
  }
})();
