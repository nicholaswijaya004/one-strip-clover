/**
 * ONE-TIME GOOGLE DRIVE SETUP  (jalankan sekali saja di laptop)
 *
 *   node scripts/google-auth.js
 *
 * Script ini akan:
 *   1. Membuka link login Google di terminal → kamu approve di browser
 *   2. Menangkap kode dari redirect, menukarnya jadi REFRESH TOKEN
 *   3. Membuat folder "One Strip Clover Uploads" di Drive-mu lewat API
 *   4. Mencetak GOOGLE_REFRESH_TOKEN + DRIVE_FOLDER_ID untuk kamu paste ke .env
 *
 * PENTING: folder sengaja dibuat OLEH APLIKASI, bukan manual di Drive.
 * Dengan scope `drive.file`, aplikasi hanya boleh menyentuh file/folder yang
 * ia buat sendiri — jadi folder buatan script ini pasti bisa diakses,
 * sementara folder yang kamu buat manual akan ditolak (error 404).
 *
 * PRASYARAT (di console.cloud.google.com):
 *   1. Buat project → APIs & Services → Library → enable "Google Drive API"
 *   2. APIs & Services → "Google Auth Platform" (dulu namanya "OAuth consent
 *      screen") → Get Started → isi App name & email → Audience: External
 *   3. Tab "Audience" → klik PUBLISH APP (status jadi "In production")
 *      ⚠️ Kalau dibiarkan "Testing", refresh token EXPIRED tiap 7 hari.
 *      Scope drive.file tidak sensitif, jadi publish tidak butuh verifikasi.
 *   4. Tab "Clients" → Create client → Application type: "Desktop app"
 *   5. Salin Client ID & Client Secret ke .env sebagai
 *      GOOGLE_CLIENT_ID dan GOOGLE_CLIENT_SECRET, lalu jalankan script ini.
 */

// --- cek versi Node ---
const _major = Number(process.versions.node.split(".")[0]);
if (_major < 18) {
  console.error(
    `\n❌ Node.js kamu versi ${process.versions.node}, terlalu lama.\n` +
      `   Butuh Node 18 atau lebih baru (disarankan LTS 22).\n\n` +
      `   Cara update di Mac:\n` +
      `     1. Download installer LTS dari https://nodejs.org  (paling gampang), ATAU\n` +
      `     2. brew install node   (kalau pakai Homebrew), ATAU\n` +
      `     3. nvm install 22 && nvm use 22   (kalau pakai nvm)\n\n` +
      `   Setelah update, jalankan ulang:\n` +
      `     rm -rf node_modules package-lock.json\n` +
      `     npm install\n`
  );
  process.exit(1);
}

require("dotenv").config();
const http = require("http");
const { google } = require("googleapis");

const PORT = 5555;
const REDIRECT = `http://localhost:${PORT}/oauth2callback`;
const SCOPES = ["https://www.googleapis.com/auth/drive.file"];
const FOLDER_NAME = process.env.DRIVE_FOLDER_NAME || "One Strip Clover Uploads";

const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } = process.env;

if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
  console.error(
    "\n❌ GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET belum diisi di .env\n" +
      "   Baca komentar di atas file ini untuk cara membuatnya.\n"
  );
  process.exit(1);
}

const oauth2 = new google.auth.OAuth2(
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  REDIRECT
);

const authUrl = oauth2.generateAuthUrl({
  access_type: "offline", // wajib, supaya dapat refresh_token
  prompt: "consent", // paksa refresh_token baru walau sudah pernah approve
  scope: SCOPES,
});

console.log("\n=============================================================");
console.log(" BUKA LINK INI DI BROWSER, LOGIN & APPROVE:\n");
console.log(authUrl);
console.log("\n (Kalau muncul peringatan 'Google hasn't verified this app',");
console.log("  klik Advanced → Go to <nama app> (unsafe). Itu app-mu sendiri.)");
console.log("=============================================================\n");
console.log("Menunggu approval di browser…");

const server = http.createServer(async (req, res) => {
  if (!req.url.startsWith("/oauth2callback")) {
    res.writeHead(404).end();
    return;
  }

  const code = new URL(req.url, `http://localhost:${PORT}`).searchParams.get("code");

  if (!code) {
    res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
    res.end("<h2>Gagal: tidak ada kode. Coba jalankan script lagi.</h2>");
    return;
  }

  try {
    const { tokens } = await oauth2.getToken(code);
    oauth2.setCredentials(tokens);

    if (!tokens.refresh_token) {
      throw new Error(
        "Google tidak mengirim refresh_token. Hapus akses app di " +
          "myaccount.google.com/permissions lalu jalankan script ini lagi."
      );
    }

    // Buat folder induk lewat API supaya app punya akses penuh ke folder ini
    const drive = google.drive({ version: "v3", auth: oauth2 });
    const folder = await drive.files.create({
      requestBody: {
        name: FOLDER_NAME,
        mimeType: "application/vnd.google-apps.folder",
      },
      fields: "id, webViewLink",
    });

    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(
      "<h2>Berhasil ✅</h2><p>Kembali ke terminal, salin nilai yang tercetak ke file .env.</p>"
    );

    console.log("\n✅ BERHASIL. Paste dua baris ini ke file .env kamu:\n");
    console.log("-------------------------------------------------------------");
    console.log(`GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}`);
    console.log(`DRIVE_FOLDER_ID=${folder.data.id}`);
    console.log("-------------------------------------------------------------");
    console.log(`\nFolder Drive: ${folder.data.webViewLink}`);
    console.log(
      "\n⚠️  Refresh token = kunci akses ke Drive-mu. Jangan commit ke GitHub,\n" +
        "    jangan bagikan ke siapa pun. File .env sudah masuk .gitignore.\n"
    );
  } catch (e) {
    res.writeHead(500, { "Content-Type": "text/html; charset=utf-8" });
    res.end(`<h2>Gagal</h2><pre>${e.message}</pre>`);
    console.error("\n❌ Gagal:", e.message, "\n");
  } finally {
    server.close();
    setTimeout(() => process.exit(0), 300);
  }
});

server.listen(PORT);
