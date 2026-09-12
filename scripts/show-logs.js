/**
 * LIHAT LOG
 *
 *   npm run logs            → 40 baris terakhir orders.log (catatan pesanan)
 *   npm run logs -- app     → 40 baris terakhir app.log (teknis)
 *   npm run logs -- app 200 → 200 baris terakhir
 *   npm run logs -- error   → hanya baris ERROR dari app.log
 *
 * Berguna di Railway Shell saat sudah live:
 *   node scripts/show-logs.js orders 100
 */

const log = require("../lib/logger");

const arg = (process.argv[2] || "orders").toLowerCase();
const n = Number(process.argv[3] || 40);

if (arg === "error" || arg === "errors") {
  const lines = log.tail("app", 2000).filter((l) => l.includes("[ERROR]"));
  console.log(`\n=== ${Math.min(lines.length, n)} ERROR terakhir ===\n`);
  console.log(lines.slice(-n).join("\n") || "(tidak ada error 🎉)");
} else if (arg === "app") {
  console.log(`\n=== app.log — ${n} baris terakhir ===\n`);
  console.log(log.tail("app", n).join("\n") || "(kosong)");
} else {
  console.log(`\n=== orders.log — ${n} baris terakhir ===\n`);
  console.log(log.tail("orders", n).join("\n") || "(belum ada pesanan)");
}
console.log("");
