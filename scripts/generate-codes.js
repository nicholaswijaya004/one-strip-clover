/**
 * Buat batch kode akses.
 *
 *   node scripts/generate-codes.js 500              → stok untuk /admin
 *   node scripts/generate-codes.js 500 --chatbot    → untuk pool chatbot
 *
 * Bedanya:
 *   tanpa --chatbot : kode "tersedia", bisa dibagikan lewat tombol di /admin
 *   dengan --chatbot: kode langsung ditandai "sudah dibagikan", supaya
 *                     tombol /admin tidak ikut membagikan kode yang sama
 *                     (mencegah 1 kode diterima 2 pembeli)
 *
 * Sama persis dengan tombol "Generate kode" di halaman /admin.
 */

const { generate, stats } = require("../lib/codes");

const args = process.argv.slice(2);
const forChatbot = args.includes("--chatbot");
const count = Number(args.find((a) => /^\d+$/.test(a)) || 20);

try {
  const r = generate(count, { forChatbot });
  console.log(
    `\n✅ ${r.codes.length} kode dibuat (${forChatbot ? "POOL CHATBOT" : "STOK ADMIN"})`
  );
  console.log(`   file: ${r.batchFile}\n`);
  console.log(r.codes.join("\n"));

  const s = stats();
  console.log(
    `\n📊 total ${s.total} · siap ${s.available} · dibagikan ${s.issued} · dipakai ${s.redeemed}\n`
  );
  if (forChatbot)
    console.log("→ Upload file di atas ke pool auto-kirim chatbot-mu.\n");
} catch (e) {
  console.error("\n❌ Gagal:", e.message, "\n");
  process.exit(1);
}
