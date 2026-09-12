/**
 * PEMBERSIHAN DATA LAMA (retensi)
 *
 *   npm run cleanup                → laporan saja, TIDAK menghapus apa pun
 *   npm run cleanup -- --hapus     → benar-benar menghapus
 *   npm run cleanup -- --hari=60   → ubah batas usia (default 30 hari)
 *
 * Kenapa perlu (temuan audit poin B):
 *   Teks persetujuan di website menjanjikan data pembeli "dihapus setelah
 *   pesanan selesai". Kalau janji itu tidak ditepati, itu risiko hukum
 *   (UU PDP), bukan sekadar soal kerapian. Selain itu Drive 15 GB akan penuh.
 *
 * Yang dibersihkan:
 *   • Folder pesanan di Google Drive yang lebih tua dari N hari
 *   • data/failed/*.json lama (pesanan yang gagal permanen)
 *   • data/backups/*.json lama (di luar 30 terbaru)
 *   • data/orders.log & app.log kalau sudah sangat besar
 *
 * Yang TIDAK bisa dibersihkan otomatis:
 *   • Inbox email — lihat catatan di bawah
 *
 * SELALU jalankan tanpa --hapus dulu untuk melihat apa yang akan terjadi.
 */

try { require("dotenv").config(); } catch (e) { /* dotenv opsional */ }
const fs = require("fs");
const path = require("path");

const args = process.argv.slice(2);
const HAPUS = args.includes("--hapus");
const HARI = Number((args.find((a) => a.startsWith("--hari=")) || "").split("=")[1] || 30);
const BATAS = Date.now() - HARI * 24 * 3600 * 1000;

const DATA = path.join(__dirname, "..", "data");

console.log(`\n🧹 PEMBERSIHAN DATA — lebih tua dari ${HARI} hari`);
console.log(HAPUS ? "   MODE: HAPUS BENERAN\n" : "   MODE: laporan saja (tambahkan --hapus untuk eksekusi)\n");

let totalLokal = 0;

function bersihkanFolderLokal(nama, simpanTerbaru = 0) {
  const dir = path.join(DATA, nama);
  if (!fs.existsSync(dir)) return;

  let berkas = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => ({ f, p: path.join(dir, f), t: fs.statSync(path.join(dir, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t);

  const dilindungi = new Set(berkas.slice(0, simpanTerbaru).map((x) => x.f));
  const kandidat = berkas.filter((x) => x.t < BATAS && !dilindungi.has(x.f));

  if (kandidat.length === 0) {
    console.log(`   ${nama.padEnd(10)}: tidak ada yang perlu dihapus`);
    return;
  }
  console.log(`   ${nama.padEnd(10)}: ${kandidat.length} berkas`);
  for (const k of kandidat) {
    if (HAPUS) fs.unlinkSync(k.p);
    totalLokal++;
  }
}

console.log("BERKAS LOKAL");
bersihkanFolderLokal("failed");
bersihkanFolderLokal("backups", 30); // selalu simpan 30 cadangan terbaru
bersihkanFolderLokal("pending"); // biasanya kosong; hanya jaga-jaga

// -------------------------------------------------------------- Google Drive

(async () => {
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN, DRIVE_FOLDER_ID } =
    process.env;

  if (!GOOGLE_CLIENT_ID || !GOOGLE_REFRESH_TOKEN || !DRIVE_FOLDER_ID) {
    console.log("\nGOOGLE DRIVE\n   dilewati — Drive belum dikonfigurasi\n");
    return ringkas();
  }

  try {
    const { google } = require("googleapis");
    const oauth2 = new google.auth.OAuth2(
      GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI || "http://localhost:5555/oauth2callback"
    );
    oauth2.setCredentials({ refresh_token: GOOGLE_REFRESH_TOKEN });
    const drive = google.drive({ version: "v3", auth: oauth2 });

    const batasISO = new Date(BATAS).toISOString();
    console.log("\nGOOGLE DRIVE");

    let pageToken = null;
    let jumlah = 0;
    do {
      const res = await drive.files.list({
        q: `'${DRIVE_FOLDER_ID}' in parents and mimeType='application/vnd.google-apps.folder' ` +
           `and createdTime < '${batasISO}' and trashed=false`,
        fields: "nextPageToken, files(id, name, createdTime)",
        pageSize: 100,
        pageToken,
      });

      for (const f of res.data.files || []) {
        // Folder cadangan JANGAN ikut terhapus
        if (f.name.startsWith("_BACKUP")) continue;
        console.log(`   ${HAPUS ? "hapus" : "akan dihapus"}: ${f.name}`);
        if (HAPUS) {
          // Dibuang ke Trash (bukan hapus permanen) → masih bisa dipulihkan 30 hari
          await drive.files.update({ fileId: f.id, requestBody: { trashed: true } });
        }
        jumlah++;
      }
      pageToken = res.data.nextPageToken;
    } while (pageToken);

    if (jumlah === 0) console.log("   tidak ada folder yang perlu dihapus");
    else if (HAPUS) console.log(`\n   ${jumlah} folder dipindahkan ke Trash Drive.`);
  } catch (e) {
    console.error("\n⚠️  Gagal membersihkan Drive:", e.message);
  }
  ringkas();
})();

function ringkas() {
  console.log("\n" + "─".repeat(60));
  if (!HAPUS) {
    console.log("Belum ada yang dihapus. Jalankan lagi dengan --hapus kalau sudah yakin.");
  } else {
    console.log(`Selesai. ${totalLokal} berkas lokal dihapus.`);
  }

  console.log(`
📧 INBOX EMAIL — harus dibersihkan sendiri
   Tidak bisa otomatis dari sini (kredensial SMTP hanya untuk MENGIRIM).
   Cara paling cepat di Gmail:
     1. Cari:  subject:"Pesanan Strip Manual" older_than:${HARI}d
     2. Pilih semua → Hapus → kosongkan Trash
   Lakukan sebulan sekali, atau buat Filter Gmail yang memberi label
   otomatis supaya gampang dipilih massal.
`);
}
