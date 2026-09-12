# 🔒 AUDIT KEAMANAN & KESIAPAN PRODUKSI

Hasil pemeriksaan kode per Agustus 2026. Setiap temuan diberi tingkat
keparahan, penjelasan dampaknya, dan status perbaikannya.

---

## KRITIS — sudah diperbaiki

### 1. Balapan data pada `codes.json` (kode bisa dipakai dua kali)
**Dampak:** Dua permintaan bersamaan sama-sama membaca seluruh file, mengubah
bagiannya, lalu menulis ulang seluruh file. Penulis terakhir menimpa yang
pertama. Nyatanya: pembeli A dan B menukar kode pada detik yang sama → salah
satu penukaran **hilang**, kodenya kembali "belum dipakai" dan bisa ditukar
orang lain. Uang masuk, akses hilang, atau sebaliknya kode bocor gratis.

**Perbaikan:** `lib/store.js` — semua perubahan diantrekan (serialized), tiap
mutasi selalu membaca kondisi terbaru. Diuji dengan 50 perubahan paralel.

### 2. Penulisan file tidak atomik (risiko kehilangan SEMUA kode)
**Dampak:** `writeFileSync` menimpa file di tempat. Kalau server mati atau disk
penuh di tengah penulisan, `codes.json` tinggal separuh → JSON rusak → seluruh
kode yang pernah dijual hilang, semua pembeli terkunci.

**Perbaikan:** tulis ke `.tmp` → `fsync` → `rename` (atomik di POSIX), plus
cadangan otomatis `.bak` yang dipakai kalau file utama rusak.

### 3. Batas ukuran body 25 MB berlaku di SEMUA endpoint
**Dampak:** Penyerang mengirim 25 MB ke `/api/redeem` berulang kali → memori
server habis → layanan mati. Tidak perlu kode valid, tidak perlu login.

**Perbaikan:** 16 KB untuk semua rute, 25 MB **hanya** untuk unggah foto.

---

## PENTING — sudah diperbaiki

### 4. ADMIN_KEY bisa ditebak tanpa batas
**Dampak:** Hanya `/api/admin/next-code` yang dibatasi. `/api/admin/stats` dan
`/api/admin/logs` tidak — penyerang bisa mencoba jutaan kunci lewat situ. Kalau
tembus: bisa mengambil semua kode (kerugian langsung) dan membaca log berisi
nama, alamat, dan kontak pelanggan.

**Perbaikan:** semua rute admin dibatasi 60 percobaan / 15 menit per IP.

### 5. Perbandingan ADMIN_KEY membocorkan info lewat waktu
**Dampak:** `a === b` berhenti di karakter pertama yang berbeda, jadi lama
waktunya sedikit berbeda tergantung berapa karakter yang cocok. Bisa dipakai
menebak kunci karakter demi karakter.

**Perbaikan:** `crypto.timingSafeEqual`.

### 6. Panjang input tidak dibatasi
**Dampak:** Nama/catatan/alamat sepanjang megabyte masuk ke email, `orders.log`,
dan nama folder Drive. Log membengkak, disk penuh, email ditolak provider.

**Perbaikan:** nama 80, catatan 500, alamat 400, email 120, WA 25 karakter.

### 7. Log injection
**Dampak:** Nama berisi baris baru bisa menyisipkan baris log palsu — misalnya
membuat catatan pesanan fiktif untuk membantah tagihan atau menutupi jejak.

**Perbaikan:** baris baru & tab dibuang sebelum ditulis ke log.

### 8. Crash tak tertangani dibiarkan lanjut
**Dampak:** Setelah `uncaughtException`, kondisi memori tidak bisa dipercaya —
server bisa melayani permintaan dengan data setengah jadi (mis. pesanan
tercatat tapi email tidak terkirim).

**Perbaikan:** log lalu `process.exit(1)`; platform menyalakan ulang bersih.

### 9. Tidak ada header keamanan browser
**Perbaikan:** ditambahkan `Content-Security-Policy` (termasuk
`frame-ancestors 'none'` agar situs tidak bisa di-*iframe* untuk penipuan),
`Strict-Transport-Security`, `X-Content-Type-Options`, `X-Frame-Options`,
`Referrer-Policy`, `Permissions-Policy`.

### 10. Deploy memutus pesanan yang sedang diproses
**Dampak:** Railway mengirim SIGTERM saat deploy. Proses langsung mati →
pesanan yang emailnya belum terkirim hilang tanpa jejak. Pembeli merasa sudah
kirim, kamu tidak pernah menerimanya, kodenya sudah hangus.

**Perbaikan:** SIGTERM/SIGINT ditangani, koneksi ditutup rapi, batas paksa 25 detik.

---

## SUDAH AMAN SEBELUMNYA (hasil pemeriksaan)

| Aspek | Status |
|---|---|
| CSRF | Aman — autentikasi lewat header, bukan cookie |
| Injeksi header email | Aman — `fmt.clean()` membuang CR/LF |
| Path traversal nama folder | Aman — `/` dan `\` dibuang |
| Pemalsuan token premium | Aman — HMAC, diuji terhadap token diubah/palsu |
| Rahasia bocor ke frontend | Aman — diuji: SMTP_PASS/ADMIN_KEY tidak pernah masuk `/api/config` |
| Tebak kode akses | Aman — 887 juta kemungkinan + 12 percobaan/15 menit |
| Kode dipakai 2× | Aman — status disimpan permanen, diperiksa sebelum kirim |
| `javascript:` di link toko | Aman — hanya `http(s)` diterima |

---

## Pengikatan kode ke perangkat (anti kode dibagikan)

**Masalah:** selama masa tenggang, kode yang sudah ditukar masih bisa dipakai
masuk lagi. Tanpa pengaman, satu kode yang disebar di kolom komentar bisa
dipakai puluhan orang untuk membuka fitur premium.

**Solusi:** kode terikat ke **satu perangkat**.

* Browser membuat ID acak sekali (disimpan lokal, bukan data pribadi)
* Penukaran pertama **mengklaim** kode dengan ID itu
* Perangkat lain → ditolak `OTHER_DEVICE`
* Tanpa ID sama sekali (mode privat) → juga ditolak

**Jalan keluar untuk pembeli sah:** halaman `/admin` → **Lepas ikatan perangkat**.
Diperlukan karena kasus nyata: pembeli menukar kode di browser dalam aplikasi
TikTok, lalu membuka situsnya lagi di Safari — penyimpanannya terpisah, jadi
terbaca sebagai perangkat lain. Setiap pelepasan dicatat di `orders.log`
(`code.unbind`) supaya kamu bisa melihat kalau ada yang menyalahgunakannya.

**Setelan:** default **2 perangkat** — memberi ruang untuk perpindahan
browser-dalam-aplikasi → browser biasa, tapi tetap memblokir kode yang disebar
(orang ke-3 dan seterusnya ditolak).

Bisa diubah kapan saja dari **/admin → Setelan**, berlaku langsung tanpa restart.
Rentang yang diizinkan 1–5, dan batas itu dijaga di server — mengakali angka
lewat DevTools tidak berpengaruh.

---

## Catatan penting: IP ≠ perangkat

Operator seluler Indonesia memakai **CGNAT** — ribuan pelanggan bisa berbagi
satu alamat IP publik. WiFi kafe/kantor juga satu IP untuk semua orang.

Artinya pembatasan "sekian permintaan per IP" bisa **memblokir pembeli sah**
saat trafik ramai. Karena itu aturannya disesuaikan:

| Endpoint | Dibatasi berdasarkan | Alasan |
|---|---|---|
| `/api/redeem` | IP, **tapi hanya percobaan GAGAL** | Penebak kode selalu gagal; pembeli sah berhasil dan tidak memakan jatah |
| `/api/render-strip` | **Kode premium** (30/jam) | Adil per pembeli, kebal masalah CGNAT |
| `/api/orders` | Kode (`MAX_STUDIO_SUBMISSIONS`) | Batas IP dibuat longgar, hanya cadangan |
| `/api/admin/*` | IP | Hanya kamu yang memakainya |

---

## TEMUAN TERBUKA — status terbaru

### ✅ A. Foto hilang kalau email DAN Drive gagal — SUDAH DIPERBAIKI
Pesanan yang gagal kini diparkir ke `data/pending/` (volume yang sudah ada,
**tanpa database, tanpa biaya**), lalu dicoba ulang otomatis tiap 5 menit
sampai 24 jam. Pembeli tetap menerima konfirmasi karena pesanannya memang
sudah aman tersimpan. Kalau tetap gagal sampai batas usia, berkasnya pindah
ke `data/failed/` dan muncul peringatan di `/admin`.
Berkas: `lib/queue.js`, `lib/delivery.js`. Diuji: `test/queue.test.js`.

### ✅ B. Penghapusan data — SUDAH DIBUATKAN ALATNYA
`npm run cleanup` (laporan) / `npm run cleanup -- --hapus` (eksekusi):
menghapus folder pesanan Drive lebih tua dari 30 hari (dibuang ke Trash,
masih bisa dipulihkan 30 hari), plus berkas lokal lama.
**Inbox email tidak bisa otomatis** — kredensial SMTP hanya untuk mengirim,
bukan menghapus. Skrip mencetak query Gmail siap pakai untuk pembersihan massal.

### ⚠️ C. Satu server — AMAN untuk skala yang kamu sebut, dengan catatan
Lihat analisis lengkap di `PRODUCTION.md` bagian "Kapasitas".
Ringkasnya: 20.000 pengunjung/hari **bukan masalah** karena photobooth-nya
jalan di browser pembeli — server hanya melayani halaman statis dan pesanan.
Yang perlu dijaga: ukuran `codes.json` dan memori saat unggahan bersamaan.

### ✅ D. Cadangan — SUDAH DIBUAT, ke Drive (gratis)
`npm run backup` menyimpan salinan lokal **dan** mengunggahnya ke folder
`_BACKUP kode` di Google Drive-mu. S3 tidak dipakai karena berbayar setelah
free tier; Drive memakai 15 GB yang sudah kamu punya. Menyimpan 30 salinan
terakhir secara bergilir.

### ✅ E. Render strip di server — SUDAH DIPERBAIKI
Strip HD **bersih** kini hanya dibuat oleh server, setelah token premium
diverifikasi. Memaksa `premium = true` lewat DevTools tidak ada gunanya lagi:
tanpa token sah, server menolak (403) dan yang bisa diunduh tetap versi
berwatermark.

Alasan ini akhirnya dikerjakan bukan soal biaya file, tapi soal **keadilan**:
kalau cara membobolnya tersebar, pembeli yang sudah bayar akan merasa
dirugikan — dan kepercayaan jauh lebih mahal daripada beberapa JPEG.

Detail penting:
* Penggambaran ditulis **sekali** di `public/shared/strip-renderer.js`, dipakai
  browser DAN server. Tidak mungkin hasil unduhan berbeda dari pratinjau.
* `@napi-rs/canvas` dipasang sebagai **optionalDependency**. Kalau gagal
  dipasang, server tetap hidup, endpoint render mengembalikan 501, dan browser
  otomatis kembali ke versi berwatermark. Deploy tidak akan gagal karenanya.
* Font brand perlu ditaruh di `assets/fonts/` (lihat `assets/fonts/README.md`),
  kalau tidak teks footer memakai font bawaan sistem.
* Batas pemakaian dihitung **per kode** (30/jam), bukan per IP.
