# 🍀 ONE STRIP CLOVER

*One strip, one memory, one lucky charm.*

Photobox digital di browser + monetisasi kode akses
sekali-pakai (dijual via TikTok Shop / Tokopedia / Shopee) + fallback kirim foto
ke studio (email & Google Drive) untuk diproses manual.

Bekerja di semua perangkat: desktop, laptop, tablet/iPad, HP — satu URL yang sama.

---

## Alur halaman

| URL | Isi |
|---|---|
| `/` | **Halaman pembuka** — penjelasan singkat + tombol "Masuk ke Photobox" |
| `/booth` | Photobox: kamera, bingkai, strip, kode premium, kirim ke studio |
| `/admin` | Panel admin (kode, template, setelan, log) |

Kenapa dipisah: kalau kamera langsung menyala begitu halaman dibuka,
pengunjung baru yang belum paham ini apa cenderung langsung menutupnya.
Halaman pembuka menjelaskan dulu, izin kamera baru diminta di `/booth`.
Wordmark di halaman photobox bisa diklik untuk kembali ke depan.

---

## Template strip (ganti desain tanpa deploy)

`/admin` → **Template strip** → unggah gambar desain strip.

| Hal | Nilai |
|---|---|
| Ukuran strip | **56,1 x 171,5 mm** (rasio 1 : 3,06) |
| Ukuran berkas disarankan | **663 x 2026 px** (300 dpi) — PNG atau JPG, maks 8 MB |
| Kotak foto bawaan | **47,7 x 38,2 mm** (rasio 5:4), 3 buah |
| Nama template | diisi saat unggah, muncul di /admin & log |
| Jarak dari tepi atas | 24 mm · antar foto 5 mm · sisa bawah 22,9 mm |
| Margin samping foto | 4,2 mm kiri & kanan |

**Bisa menyimpan banyak template.** Setiap template yang diunggah muncul
sebagai pilihan bingkai tersendiri di halaman utama (di depan bingkai bawaan).
Di /admin ada galeri "Bingkai": klik satu template untuk mengubah nama,
mengatur posisi kotak foto, atau menghapusnya. Menghapus sebuah template
langsung menghilangkan bingkai itu dari halaman utama.

Cara kerjanya: foto pembeli digambar dulu, lalu **template ditimpa di atasnya** —
jadi bingkai, hiasan, dan teks di template tetap terlihat menutupi foto.
Bagian template yang menutupi kotak foto sebaiknya dibuat transparan (PNG).

Posisi kotak foto diatur dalam **milimeter**, bukan piksel. Artinya template
beresolusi berapa pun menghasilkan tata letak yang sama persis — dan ukuran
cetaknya tetap benar.

Admin akan menolak gambar yang rasionya meleset >3% (kalau dipaksa, hasil
cetaknya gepeng), dan memberi peringatan kalau kotak foto tidak muat di strip.

**Menghapus template:** tombol 🗑 di /admin (butuh dua ketukan sebagai
konfirmasi). Berkasnya dihapus dari disk dan strip langsung kembali ke
desain bawaan — pembeli cukup memuat ulang halaman.

Tanpa template, strip memakai desain bawaan (bingkai Clover, Linen, Blush,
Mint, Plum) — kelimanya kini memakai **grid milimeter yang sama**, jadi
hasil cetaknya identik ukurannya dengan template unggahan.

**Contoh template siap uji:**

```bash
npm run template -- --warna=clover --tekstur=kertas
npm run template -- --judul="One Strip Clover" --quote="Carry the memory" --ig="@onestripclover"

  --warna   : clover | blush | mint | plum | langit
  --tekstur : kertas | linen | catair | polos
```

Menghasilkan PNG 663 x 2026 px dengan kotak foto TRANSPARAN — langsung
bisa diunggah di /admin. Tambahkan teks/logomu di area atas & bawah lewat
Canva/Figma, jangan menutupi kotak fotonya.

---

## Atur harga & link toko

Semua di `.env` — **tidak perlu menyentuh kode**:

```
PREMIUM_PRICE=Rp 15.000
SHOP_TIKTOK=https://vt.tiktok.com/xxxxx
SHOP_TOKOPEDIA=https://tokopedia.com/tokomu/produk
SHOP_SHOPEE=https://shopee.co.id/product/xxxx
SHOP_WHATSAPP=6281234567890
```

Restart server setelah mengubah. Yang dikosongkan tombolnya tidak muncul;
kalau semuanya kosong, kotak "Belum punya kode?" otomatis disembunyikan.

---

## Identitas brand

Palet resmi (dari company profile) — dipakai di `public/index.html` (`:root`) dan `lib`:

| Warna | Hex | Pemakaian |
|---|---|---|
| Clover (olive) | `#AEAF4E` | warna utama, tombol, aksen |
| Blush | `#F9E4EB` | latar lembut, bingkai Blush |
| Mint | `#86F2EC` | aksen, bingkai Mint |
| Plum | `#6C4862` | teks pekat, tombol sekunder |
| Periwinkle | `#A9BAD6` | latar info, aksen |

Font: **Parisienne** (wordmark), **Montserrat** (judul/label), **Karla** (teks).
Bingkai strip: Clover & Linen (gratis) · Blush, Mint, Plum (premium).
Satu strip = **3 foto kotak (1:1)** → rasio strip **1 : 3**, sama seperti
strip photobox klasik 2 x 6 inci. Foto sengaja kotak, bukan 4:3: dengan 4:3
strip jadi 1 : 2,37 (terlihat pendek). Diubah di satu tempat saja:
`PHOTO_COUNT` di `public/shared/strip-renderer.js`.

**Lembar cetak A4 — `CETAK-A4-*.pdf` (lampiran PERTAMA di email & Drive)**

Strip diputar 90° dan ditempel di bagian atas kertas A4. Staf tinggal
mencetak lalu memotong.

* Ukuran cetak strip: **51 x 152 mm** (ukuran photobox klasik 2 x 6 inci)
* Halaman: A4 tepat 210 x 297 mm · strip ditengahkan · 10 mm dari tepi atas
* **PDF, bukan JPEG** — ukuran fisiknya pasti berapa pun setelan DPI printer.
  Kalau JPEG, hasil cetaknya bergantung tafsiran printer dan potongannya meleset.
* Dibuat di server dengan `lib/pdf.js` — **JavaScript murni, tanpa dependency**,
  jadi tidak bisa gagal karena pustaka gambar tidak terpasang. Berkas JPEG strip
  ditempelkan apa adanya (DCTDecode), tidak di-encode ulang → kualitas tidak turun.
* Setelan di `.env`: `A4_COPIES` (1–4 strip per lembar) dan `A4_MARGIN_MM`

---

## Dokumen penting

| Berkas | Isi |
|---|---|
| `SECURITY.md` | Hasil audit keamanan: 10 celah yang ditemukan & diperbaiki |
| `PRODUCTION.md` | Ceklis go-live, pemantauan, rencana darurat |
| `ARCHITECTURE.md` | Materi belajar OOAD & design pattern (proyek Go/React) |

---

## Unit test

```bash
npm test
```

171 tes, tanpa dependency tambahan (memakai `node --test` bawaan Node 18+):

| Berkas | Yang diuji |
|---|---|
| `test/tokens.test.js` | tanda tangan HMAC, token palsu/diubah/kedaluwarsa |
| `test/format.test.js` | pembersihan nama file, label folder, nomor pesanan, validasi form |
| `test/codes.test.js` | keunikan kode, pemisahan pool chatbot vs admin, statistik |
| `test/ratelimit.test.js` | batas percobaan, pemulihan jatah, kode sekali pakai, batas pesanan |
| `test/branding.test.js` | palet & font brand terpasang, sisa brand lama bersih |
| `test/redeem.test.js` | masa tenggang kode, pemulihan sesi, jatah pesanan tidak bertambah |
| `test/config.test.js` | link toko dari .env, tolak link palsu/berbahaya, rahasia tidak bocor |
| `test/buybox.test.js` | kotak beli muncul/sembunyi dengan benar (termasuk saat setelan datang belakangan) |
| `test/locks.test.js` | jatah pesanan tidak jebol walau kode ditukar ulang / dikirim berbarengan |

Tes menulis ke `data/codes.json`, tapi isinya dicadangkan & dikembalikan otomatis.

---

## Struktur project

```
fotobox/
├── server.js                  # Backend (Express): redeem kode + fallback upload
├── package.json
├── .env.example               # Template konfigurasi → copy jadi .env
├── data/
│   └── codes.json             # "Database" kode (file JSON, single-use)
├── scripts/
│   ├── generate-codes.js      # Generator batch kode untuk chatbot
│   └── google-auth.js         # Setup Drive sekali jalan (OAuth)
└── public/
    └── index.html             # Seluruh frontend photobox (kamera, filter, strip)
```

---

## 1. Jalankan di laptop (5 menit)

Butuh Node.js 18+ (nodejs.org).

```bash
cd fotobox
npm install
npm start
```

Buka http://localhost:3000

Sudah ada 5 kode demo di `data/codes.json` (lihat isinya) — coba tombol
**"🎟 Punya kode premium?"** dengan salah satu kode itu. Kode yang sudah dipakai
akan ditolak selamanya (single-use).

> Kamera jalan di `localhost` tanpa HTTPS. Tapi kalau diakses lewat IP
> (mis. dari HP ke laptop), browser memblokir kamera — itu normal.
> Setelah di-deploy (HTTPS otomatis), kamera jalan di semua perangkat.

---

## 2. Konfigurasi fallback studio

Copy `.env.example` → `.env`, lalu isi:

**Email (wajib untuk fitur "Kirim ke studio"):**
- Paling gampang: Gmail → aktifkan 2FA → buat **App Password**
  (Google Account → Security → App passwords), pakai sebagai `SMTP_PASS`.
- Alternatif free tier: Brevo (300 email/hari) atau Resend SMTP.

**Google Drive (opsional) — pakai akun Gmail biasa:**

Service account TIDAK dipakai (service account punya kuota penyimpanan 0 byte
dan selalu gagal di Gmail pribadi). Kita login sebagai **akunmu sendiri**,
jadi file masuk ke 15 GB gratis milikmu.

1. console.cloud.google.com → buat project → **enable Google Drive API**
2. **OAuth consent screen** → External → isi nama app & email
   → **PUBLISH APP** (status "In production")
   ⚠️ Kalau dibiarkan "Testing", refresh token mati tiap 7 hari.
   Scope yang dipakai (`drive.file`) tidak sensitif, jadi tidak perlu verifikasi.
3. **Credentials** → Create Credentials → OAuth client ID
   → Application type: **Desktop app**
4. Salin Client ID & Secret ke `.env`
5. Jalankan sekali di laptop:

```bash
node scripts/google-auth.js
```

Browser terbuka → approve → script mencetak `GOOGLE_REFRESH_TOKEN` dan
`DRIVE_FOLDER_ID` → paste ke `.env`. Selesai.

> Folder Drive dibuat OTOMATIS oleh script. Jangan ganti dengan folder yang
> kamu buat manual — scope `drive.file` hanya mengizinkan app menyentuh
> file/folder buatannya sendiri, folder manual akan error 404.

Setiap kiriman masuk ke **subfolder sendiri** (`waktu__kontak`) berisi 4 foto
asli + preview strip yang customer coba buat + `_INFO.txt` (kontak, catatan,
filter & bingkai pilihannya).

Kalau Drive tidak diisi, fallback tetap jalan via email saja.

---

## 3. Deploy (Railway / Render, ±15 menit)

Rekomendasi: **Railway.app** atau **Render.com** — keduanya kasih HTTPS otomatis
(wajib untuk kamera) dan punya **persistent disk / volume** untuk `data/codes.json`.

Langkah (Railway):
1. Push folder ini ke GitHub (repo private).
2. Railway → New Project → Deploy from GitHub repo.
3. Tambahkan **Volume**, mount ke `/app/data`  ← PENTING (lihat catatan bawah).
4. Isi environment variables sesuai `.env`.
5. Settings → Domains → tambahkan custom domain-mu (beli di Niagahoster/dll,
   arahkan CNAME sesuai instruksi Railway).

> ⚠️ **Jangan deploy ke Vercel/Netlify** untuk versi ini. Mereka serverless:
> file `codes.json` tidak permanen di sana, kode yang "sudah dipakai" bisa
> ter-reset. Kalau nanti mau pindah ke Vercel, ganti penyimpanan kode ke
> Supabase (gratis) — hanya fungsi `loadCodes()/saveCodes()` di server.js
> yang perlu diubah.

---

## 4. Operasional kode (rutinitas 1 menit)

**Cara paling gampang: lewat halaman `/admin`** → kartu "Buat kode baru".
Isi jumlah, pilih tujuan, klik Generate, lalu Salin / Unduh .txt.

Dua tujuan, jangan tertukar:

| Pilihan | Kodenya | Dipakai untuk |
|---|---|---|
| **Untuk chatbot** | langsung ditandai "sudah dibagikan" | diupload ke pool auto-kirim marketplace |
| **Stok admin** | tetap "tersedia" | dibagikan satu-satu lewat tombol di /admin (order manual, kode pengganti) |

Kenapa dibedakan: kode yang sudah diekspor ke chatbot tidak boleh ikut
dibagikan tombol /admin — kalau ikut, 1 kode bisa sampai ke 2 pembeli.

**Lewat terminal** (kalau lebih suka):

```bash
node scripts/generate-codes.js 500 --chatbot   # pool chatbot
node scripts/generate-codes.js 50              # stok admin
```

- Kode baru otomatis diterima server (tanpa restart).
- File `data/batch-<waktu>.txt` berisi daftar kode baru → download / copy,
  upload ke pool auto-reply chatbot marketplace-mu (fitur "kirim item
  berikutnya dari daftar, tanpa mengulang").

Di Railway: buka service → tab **"Shell"** (atau `railway run`) → jalankan
perintah di atas, lalu ambil isi file batch dengan `cat data/batch-*.txt`.

**Alur lengkap:**
pembeli checkout di marketplace → chatbot kirim 1 kode →
pembeli buka website → masukkan kode → premium aktif (bingkai eksklusif,
HD, tanpa watermark) → kode terkunci selamanya.

---

## 5. Apa yang didapat pembeli premium (bisa kamu ubah)

Di `public/index.html`:
- `FRAMES` — daftar bingkai; `premium:true` = terkunci untuk gratisan.
- Watermark versi gratis — cari `FOTOBOX · PREVIEW`.
- Resolusi: gratis 480px, premium 960px — cari `const W  = HD ? 960 : 480`.
- Durasi sesi premium: `SESSION_HOURS` di `server.js` (default 6 jam).

---

## 6. Keterbatasan yang perlu kamu tahu (jujur)

1. **Status premium dicek di sisi klien setelah redeem.** Orang yang paham
   DevTools bisa memaksa `S.premium=true` dan dapat HD tanpa bayar. Untuk
   v1 ini risiko kecil (mayoritas pembeli tidak akan melakukannya), tapi
   kalau mau rapat: pindahkan render strip HD ke server dan wajibkan token.
2. **Satu server, file JSON.** Aman sampai ribuan redeem/hari. Di atas itu,
   pindah ke SQLite/Supabase.
3. **Drive & email belum pernah diuji beneran** dari sisi saya (sandbox tanpa
   internet). Lakukan satu kiriman uji setelah kredensial terpasang, lalu cek
   console server — error email/Drive tercetak di sana.
4. **Foto pengguna TIDAK disimpan** kecuali mereka sendiri menekan
   "Kirim ke studio" dan mencentang persetujuan — ini bagus untuk privasi
   dan sesuai UU PDP. Jangan ubah perilaku ini diam-diam.
5. **iOS Safari** kadang rewel soal izin kamera — jalur "Unggah foto" selalu
   tersedia sebagai cadangan. Tes di iPhone asli sebelum launch.

---

## 7. Biaya bulanan realistis

| Item | Biaya |
|---|---|
| Domain | ±Rp 150–250rb / tahun |
| Hosting Railway/Render | $0–5 / bulan (free tier cukup untuk mulai) |
| Email (Gmail app password / Brevo) | Rp 0 |
| Google Drive API | Rp 0 (penyimpanan pakai 15 GB gratis akunmu) |
| Chatbot auto-reply marketplace | sesuai tool yang kamu pakai |

Total bisa di bawah Rp 100rb/bulan sampai trafficmu besar.
