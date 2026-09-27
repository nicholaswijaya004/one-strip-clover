/**
 * TES KONFIGURASI EMAIL (jalankan kapan saja untuk cek .env)
 *
 *   npm run test-email
 *
 * Script ini TIDAK menyentuh website. Ia hanya:
 *   1. Membaca .env
 *   2. Menampilkan konfigurasi (rahasia disamarkan)
 *   3. Mengirim 1 email tes ke STUDIO_EMAIL lewat jalur yang SAMA dengan
 *      pesanan sungguhan: Resend dulu, lalu SMTP kalau Resend gagal
 * Kalau gagal, ia mencetak penyebab + cara memperbaikinya.
 */

require("dotenv").config({ quiet: true });
const delivery = require("../lib/delivery");

const env = process.env;
const {
  RESEND_API_KEY, RESEND_FROM,
  SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM, STUDIO_EMAIL,
} = env;

// Rahasia TIDAK pernah dicetak — bahkan panjangnya pun tidak. Cukup ada/tidak.
const samar = (v) => (v ? "✅ terisi" : "❌ KOSONG");

console.log("\n=== KONFIGURASI TERBACA DARI .env ===");
console.log("STUDIO_EMAIL   :", STUDIO_EMAIL || "❌ KOSONG");
console.log("— jalur 1: Resend (HTTPS) —");
console.log("RESEND_API_KEY :", RESEND_API_KEY ? samar(RESEND_API_KEY) : "(tidak dipakai)");
console.log("RESEND_FROM    :", RESEND_FROM || "(bawaan: onboarding@resend.dev)");
console.log("— jalur 2: SMTP (cadangan) —");
console.log("SMTP_HOST      :", SMTP_HOST || "(tidak dipakai)");
console.log("SMTP_PORT      :", SMTP_PORT || "(default 587)");
console.log("SMTP_USER      :", SMTP_USER || (SMTP_HOST ? "❌ KOSONG" : "-"));
console.log("SMTP_PASS      :", SMTP_HOST ? samar(SMTP_PASS) : "-");
console.log("SMTP_FROM      :", SMTP_FROM || (SMTP_HOST ? "(pakai SMTP_USER)" : "-"));
console.log("=====================================\n");

if (!delivery.emailConfigured(env)) {
  console.error(
    "❌ Email belum diatur. Isi STUDIO_EMAIL + RESEND_API_KEY (disarankan)\n" +
      "   dan/atau SMTP_HOST, SMTP_USER, SMTP_PASS.\n" +
      "   • File bernama persis  .env  (bukan .env.txt / env)\n" +
      "   • Letaknya sejajar dengan package.json\n" +
      "   • Tidak ada tanda kutip di sekitar nilainya\n"
  );
  process.exit(1);
}

if (SMTP_HOST && SMTP_HOST.includes("gmail") && SMTP_PASS && (SMTP_PASS.length !== 16 || /\s/.test(SMTP_PASS))) {
  console.warn(
    "⚠️  App Password Gmail harus 16 huruf TANPA spasi.\n" +
      "   Pastikan spasinya dihapus, dan ini App Password (bukan sandi akun).\n"
  );
}

const pesananUji = {
  ref: "TES-EMAIL",
  code: "TES",
  name: "Tes konfigurasi",
  email: "",
  wa: "",
  address: "(email tes — bukan pesanan)",
  note: "Kalau kamu membaca ini, konfigurasi email-mu sudah benar.",
  createdAt: new Date().toISOString(),
};

(async () => {
  try {
    console.log("Mengirim email tes ke", STUDIO_EMAIL, "…");
    const via = await delivery.sendEmail(pesananUji, { semua: [], rawPhotos: [] }, env);
    console.log(`   ✅ Terkirim lewat ${via.toUpperCase()}.`);
    console.log("\n🎉 Konfigurasi email SUDAH BENAR. Cek inbox (dan folder Spam).\n");
  } catch (e) {
    console.error("\n❌ GAGAL:", e.message, "\n");

    const m = String(e.message).toLowerCase();
    if (m.includes("resend http 401") || m.includes("resend http 403")) {
      console.error(
        "PENYEBAB (Resend): API key ditolak, ATAU pengirim/penerima tidak diizinkan.\n" +
          "  • Cek RESEND_API_KEY (diawali re_)\n" +
          "  • Tanpa domain terverifikasi, onboarding@resend.dev HANYA bisa\n" +
          "    mengirim ke email pemilik akun Resend → samakan STUDIO_EMAIL,\n" +
          "    atau verifikasi domain di resend.com/domains\n"
      );
    }
    if (m.includes("invalid login") || m.includes("username and password") || m.includes("535")) {
      console.error(
        "PENYEBAB (SMTP): username/password ditolak.\n" +
          "  • Gmail WAJIB pakai App Password 16 huruf, bukan sandi akun\n" +
          "  • Hapus semua spasi dari App Password\n" +
          "  • Pastikan Verifikasi 2 Langkah aktif\n"
      );
    } else if (m.includes("timeout") || m.includes("econnrefused") || m.includes("enotfound")) {
      console.error(
        "PENYEBAB (SMTP): tidak bisa menjangkau server SMTP.\n" +
          "  • Railway paket Trial/Hobby MEMBLOKIR SMTP — pakai Resend\n" +
          "  • Cek ejaan SMTP_HOST (smtp.gmail.com)\n" +
          "  • Beberapa WiFi kantor/kampus memblokir port 587 → coba SMTP_PORT=465\n"
      );
    }
    process.exit(1);
  }
})();
