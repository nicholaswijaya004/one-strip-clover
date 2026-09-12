/**
 * TES KONFIGURASI EMAIL (jalankan kapan saja untuk cek .env)
 *
 *   node scripts/test-email.js
 *
 * Script ini TIDAK menyentuh website. Ia hanya:
 *   1. Membaca .env
 *   2. Menampilkan konfigurasi (password disamarkan)
 *   3. Mencoba login ke server SMTP
 *   4. Mengirim 1 email tes ke STUDIO_EMAIL
 * Kalau gagal, ia mencetak penyebab + cara memperbaikinya.
 */

require("dotenv").config();
const nodemailer = require("nodemailer");

const {
  SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM, STUDIO_EMAIL,
} = process.env;

console.log("\n=== KONFIGURASI TERBACA DARI .env ===");
console.log("SMTP_HOST    :", SMTP_HOST || "❌ KOSONG");
console.log("SMTP_PORT    :", SMTP_PORT || "(default 587)");
console.log("SMTP_USER    :", SMTP_USER || "❌ KOSONG");
console.log(
  "SMTP_PASS    :",
  SMTP_PASS ? `${SMTP_PASS.length} karakter${/\s/.test(SMTP_PASS) ? "  ⚠️ ADA SPASI!" : ""}` : "❌ KOSONG"
);
console.log("SMTP_FROM    :", SMTP_FROM || "(pakai SMTP_USER)");
console.log("STUDIO_EMAIL :", STUDIO_EMAIL || "❌ KOSONG");
console.log("=====================================\n");

if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS || !STUDIO_EMAIL) {
  console.error(
    "❌ Ada yang kosong di atas.\n" +
      "   Kemungkinan file .env tidak terbaca. Cek:\n" +
      "   • File bernama persis  .env  (bukan .env.txt / env)\n" +
      "   • Letaknya sejajar dengan package.json\n" +
      "   • Tidak ada tanda kutip di sekitar nilainya\n"
  );
  process.exit(1);
}

if (SMTP_HOST.includes("gmail") && SMTP_PASS.length !== 16) {
  console.warn(
    `⚠️  App Password Gmail biasanya 16 karakter, punyamu ${SMTP_PASS.length}.\n` +
      "   Pastikan spasinya dihapus, dan ini App Password (bukan sandi akun).\n"
  );
}

(async () => {
  const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT || 587),
    secure: String(SMTP_PORT) === "465",
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });

  try {
    console.log("① Mencoba login ke server SMTP…");
    await transporter.verify();
    console.log("   ✅ Login berhasil.\n");

    console.log("② Mengirim email tes ke", STUDIO_EMAIL, "…");
    const info = await transporter.sendMail({
      from: SMTP_FROM || SMTP_USER,
      to: STUDIO_EMAIL,
      subject: "[ONE STRIP CLOVER] Tes konfigurasi email ✅",
      text: "Kalau kamu membaca ini, konfigurasi SMTP-mu sudah benar.",
    });
    console.log("   ✅ Terkirim! Message ID:", info.messageId);
    console.log("\n🎉 Konfigurasi email SUDAH BENAR. Cek inbox (dan folder Spam).\n");
  } catch (e) {
    console.error("\n❌ GAGAL:", e.message, "\n");

    const m = String(e.message).toLowerCase();
    if (m.includes("invalid login") || m.includes("username and password") || m.includes("535")) {
      console.error(
        "PENYEBAB: username/password ditolak.\n" +
          "  • Gmail WAJIB pakai App Password 16 huruf, bukan sandi akun\n" +
          "  • Hapus semua spasi dari App Password\n" +
          "  • Pastikan Verifikasi 2 Langkah aktif\n" +
          "  • Buat ulang App Password kalau ragu\n"
      );
    } else if (m.includes("timeout") || m.includes("econnrefused") || m.includes("enotfound")) {
      console.error(
        "PENYEBAB: tidak bisa menjangkau server SMTP.\n" +
          "  • Cek koneksi internet\n" +
          "  • Cek ejaan SMTP_HOST (smtp.gmail.com)\n" +
          "  • Beberapa WiFi kantor/kampus memblokir port 587 → coba SMTP_PORT=465\n"
      );
    } else if (m.includes("self signed") || m.includes("certificate")) {
      console.error("PENYEBAB: masalah sertifikat TLS — biasanya antivirus/proxy.\n");
    }
    process.exit(1);
  }
})();
