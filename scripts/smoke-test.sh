#!/usr/bin/env bash
# =====================================================================
#  SMOKE TEST PRODUKSI — dipakai job "integration" di CI.
#
#  Menyalakan server SUNGGUHAN dengan NODE_ENV=production lalu memeriksanya
#  dari luar (curl), seperti yang dilihat pengunjung dan penyerang.
#  Bisa dijalankan di laptop:   bash scripts/smoke-test.sh
# =====================================================================
set -euo pipefail

PORT="${PORT:-3123}"
BASE="http://127.0.0.1:$PORT"
DATA_DIR="$(mktemp -d)"
LOG="$DATA_DIR/server.out"
gagal=0

export PORT DATA_DIR NODE_ENV=production TRUST_PROXY=false
export ADMIN_KEY="smoke-admin-key-$(openssl rand -hex 16)"
export SESSION_SECRET="$(openssl rand -hex 32)"

cek() { # cek <nama> <harapan> <nilai>
  if [ "$2" = "$3" ]; then echo "  ✓ $1"; else echo "  ✗ $1 — harap '$2', dapat '$3'"; gagal=1; fi
}
status() { curl -s -o /dev/null -w "%{http_code}" "$@"; }

echo "── 1. Produksi MENOLAK hidup dengan rahasia lemah"
if SESSION_SECRET=pendek ADMIN_KEY=123 timeout 10 node server.js > "$DATA_DIR/lemah.out" 2>&1; then
  echo "  ✗ server hidup dengan SESSION_SECRET/ADMIN_KEY lemah"; gagal=1
else
  grep -q "tidak aman" "$DATA_DIR/lemah.out" && echo "  ✓ ditolak dengan pesan jelas" \
    || { echo "  ✗ keluar tanpa pesan yang jelas"; cat "$DATA_DIR/lemah.out"; gagal=1; }
fi

echo "── 2. Nyalakan server produksi"
node server.js > "$LOG" 2>&1 &
PID=$!
# Beres-beres: matikan server, TUNGGU sampai benar-benar keluar (ia masih
# menulis log ke DATA_DIR saat mati), baru hapus foldernya. Kode keluar
# skrip dipertahankan — kegagalan beres-beres tidak boleh mengubah hasil tes.
beres() {
  local kode=$?
  kill "$PID" 2>/dev/null || true
  wait "$PID" 2>/dev/null || true
  rm -rf "$DATA_DIR" 2>/dev/null || true
  exit "$kode"
}
trap beres EXIT
for _ in $(seq 1 30); do
  curl -sf "$BASE/healthz" > /dev/null 2>&1 && break
  sleep 1
done
curl -sf "$BASE/healthz" > /dev/null || { echo "  ✗ server tidak hidup"; cat "$LOG"; exit 1; }
echo "  ✓ hidup"

echo "── 3. Halaman & API publik"
for jalur in / /booth /admin /api/config /api/template /js/booth.js /shared/contract.js; do
  cek "GET $jalur" 200 "$(status "$BASE$jalur")"
done
cek "API tak dikenal → 404" 404 "$(status "$BASE/api/tidak-ada")"
cek "berkas tersembunyi tidak dilayani" 404 "$(status "$BASE/.env")"

echo "── 4. Header keamanan"
H="$(curl -sI "$BASE/")"
grep -qi "^content-security-policy:.*script-src 'self';" <<<"$H" && echo "  ✓ CSP tanpa skrip inline" || { echo "  ✗ CSP"; gagal=1; }
grep -qi "^x-frame-options: DENY" <<<"$H" && echo "  ✓ anti-clickjacking" || { echo "  ✗ X-Frame-Options"; gagal=1; }
grep -qi "^x-content-type-options: nosniff" <<<"$H" && echo "  ✓ nosniff" || { echo "  ✗ nosniff"; gagal=1; }
grep -qi "^x-powered-by" <<<"$H" && { echo "  ✗ X-Powered-By bocor"; gagal=1; } || echo "  ✓ X-Powered-By disembunyikan"

echo "── 5. Kontrol akses"
cek "admin tanpa kunci → 401" 401 "$(status -X POST -H 'content-type: application/json' -d '{}' "$BASE/api/admin/stats")"
cek "admin kunci salah → 401" 401 "$(status -X POST -H 'content-type: application/json' -H 'x-admin-key: salah' -d '{}' "$BASE/api/admin/stats")"
cek "admin kunci benar → 200" 200 "$(status -X POST -H 'content-type: application/json' -H "x-admin-key: $ADMIN_KEY" -d '{}' "$BASE/api/admin/stats")"
curl -s "$BASE/healthz" | grep -q chatbotStock && { echo "  ✗ /healthz publik membocorkan stok"; gagal=1; } || echo "  ✓ /healthz publik minimal"

echo "── 6. Anti-DoS: body besar tanpa token ditolak SEBELUM dibaca"
head -c 5000000 /dev/zero | tr '\0' 'a' | sed 's/^/{"x":"/; s/$/"}/' > "$DATA_DIR/besar.json"
cek "upload 5 MB tanpa token → 403" 403 "$(status -X POST -H 'content-type: application/json' --data-binary @"$DATA_DIR/besar.json" "$BASE/api/fallback-upload")"
cek "render 5 MB tanpa token → 403" 403 "$(status -X POST -H 'content-type: application/json' --data-binary @"$DATA_DIR/besar.json" "$BASE/api/render-strip")"
cek "rute biasa 5 MB → 413" 413 "$(status -X POST -H 'content-type: application/json' --data-binary @"$DATA_DIR/besar.json" "$BASE/api/redeem")"
cek "JSON rusak → 400" 400 "$(status -X POST -H 'content-type: application/json' -d '{rusak' "$BASE/api/redeem")"

echo "── 7. Anti tebak-kode"
kena=0
for i in $(seq 1 20); do
  s="$(status -X POST -H 'content-type: application/json' -d "{\"code\":\"OSC-SMOKE$i\"}" "$BASE/api/redeem")"
  [ "$s" = "429" ] && { kena=1; break; }
done
cek "tebakan beruntun diblokir (429)" 1 "$kena"

echo "── 8. Bingkai premium tidak bocor ke browser"
grep -q "rgba(216,140,165" <(curl -s "$BASE/shared/strip-renderer.js") \
  && { echo "  ✗ desain bingkai premium ada di kode browser"; gagal=1; } \
  || echo "  ✓ desain bingkai premium hanya di server"
cek "thumbnail bingkai premium dari server" 200 "$(status "$BASE/api/frame-thumb?id=blush")"
cek "pratinjau: bingkai asing ditolak" 400 "$(status -X POST -H 'content-type: application/json' -d '{"frameId":"x","photos":[]}' "$BASE/api/preview-strip")"
cek "pratinjau: body besar ditolak" 413 "$(status -X POST -H 'content-type: application/json' --data-binary @"$DATA_DIR/besar.json" "$BASE/api/preview-strip")"

echo "── 9. Server masih sehat setelah semua serangan"
cek "healthz" 200 "$(status "$BASE/healthz")"
if grep -q "unhandled" "$LOG"; then echo "  ✗ ada error tak tertangani:"; grep unhandled "$LOG"; gagal=1; else echo "  ✓ tidak ada error tak tertangani"; fi

echo
if [ "$gagal" = 0 ]; then echo "✅ SMOKE TEST LULUS"; else echo "❌ SMOKE TEST GAGAL"; echo "--- log server ---"; tail -50 "$LOG"; fi
exit "$gagal"
