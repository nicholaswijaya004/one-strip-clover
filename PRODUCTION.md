# 🚀 KESIAPAN PRODUKSI — One Strip Clover

Ceklis sebelum menerima uang pembeli sungguhan.
Perbaikan keamanan yang sudah dikerjakan ada di `SECURITY.md`.

---

## 0. Luncurkan staging di Railway (±15 menit)

Staging = situs sungguhan di internet untuk dicoba dulu, dengan domain gratis
`nama-app.up.railway.app` (HTTPS otomatis — wajib untuk kamera).

> **Kenapa bukan Vercel/Netlify?** Mereka serverless: body permintaan maks.
> 4,5 MB (pesanan foto biasanya lebih besar), tidak ada disk permanen
> (`codes.json` bisa hilang = kode terjual ikut hilang), dan tidak bisa
> menjalankan antrean coba-ulang di latar. Render gratis juga menghapus
> semua berkas setiap kali tidur (15 menit tanpa pengunjung).

1. **railway.com → Login with GitHub.** Trial gratis $5 (30 hari, tanpa kartu).
   Setelah itu paket Hobby $5/bulan (sudah termasuk $5 pemakaian).
2. **New Project → Deploy from GitHub repo → `one-strip-clover`.**
   Railway membaca `railway.json` (perintah start, health check `/healthz`,
   restart otomatis) dan `.nvmrc` (Node 22) dari repo.
3. **Tambah Volume:** klik service → **Settings → Volumes → Add Volume**,
   mount path **`/data`**. Tanpa ini, kode & pesanan hilang setiap deploy.
4. **Variables** (tab Variables → Raw Editor), minimal:
   ```
   NODE_ENV=production
   SITE_ENV=staging
   DATA_DIR=/data
   SESSION_SECRET=<openssl rand -hex 32>      ← tandai Sealed
   ADMIN_KEY=<openssl rand -hex 24>           ← tandai Sealed
   ```
   Opsional untuk uji kirim ke studio: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`,
   `SMTP_PASS` (Sealed), `SMTP_FROM`, `STUDIO_EMAIL`. Pakai **email uji**,
   bukan inbox studio sungguhan. Link toko boleh dikosongkan di staging.
5. **Settings → Networking → Generate Domain** → dapat
   `https://nama-app.up.railway.app`.
6. **Deploy otomatis:** setiap merge ke `main` (yang sudah wajib lolos semua
   cek CI) langsung di-deploy ulang. Aktifkan **Settings → "Wait for CI"**
   supaya Railway menunggu CI hijau dulu.

**Uji setelah hidup:**

```bash
URL=https://nama-app.up.railway.app
curl -s $URL/healthz                  # {"ok":true,...}
curl -s $URL/robots.txt               # Disallow: /   ← staging tidak diindeks
curl -sI $URL/ | grep -i robots       # X-Robots-Tag: noindex
```

Lalu buka `/admin` (login dengan `ADMIN_KEY`) → buat 3 kode **Stok admin** →
buka `/booth` di HP → tukar kode, ambil foto, unduh strip, coba "Kirim ke studio".

**Dari staging ke produksi:** buat Environment baru di Railway (atau project
terpisah) dengan rahasia BARU, `SITE_ENV` dikosongkan, volume sendiri, lalu
pasang domain milikmu di **Settings → Networking → Custom Domain**. Jangan
memakai ulang `SESSION_SECRET`/`ADMIN_KEY` staging di produksi.

## 1. WAJIB sebelum go-live

| # | Hal | Cara memastikan |
|---|---|---|
| 1 | **`.env` terisi lengkap** | Jalankan `npm start`, lihat ringkasan KONFIGURASI. Semua harus `ON` |
| 1a | **`NODE_ENV=production`** | Dengan ini server MENOLAK hidup kalau rahasia kosong/lemah — deploy gagal terlihat, bukan diam-diam tidak aman |
| 2 | **`SESSION_SECRET` ≥ 32 karakter, beda dari `ADMIN_KEY`** | `openssl rand -hex 32`, simpan di Railway Variables (Sealed) — lihat bagian 1b. ⚠️ Sebelumnya boleh kosong (jatuh ke `ADMIN_KEY`); sekarang WAJIB — isi SEBELUM deploy versi ini, atau server tidak mau hidup |
| 3 | **`ADMIN_KEY` acak ≥ 16 karakter** | `openssl rand -hex 24` |
| 3a | **Node.js 22+** | Node 20 sudah end-of-life; `googleapis` mensyaratkan 22. Railway: set `NIXPACKS_NODE_VERSION=22` atau pakai `.nvmrc` (sudah ada) |
| 3b | **`TRUST_PROXY` benar** | Railway/Render = `1` (bawaan). Tanpa proxy = `false` |
| 4 | **`.env` TIDAK di GitHub** | `git status` — `.env` tidak boleh muncul |
| 5 | **Volume ter-mount di `/app/data`** | Tanpa ini, semua kode ter-reset tiap deploy |
| 6 | **HTTPS aktif** | Kamera browser tidak jalan tanpa HTTPS |
| 7 | **Uji beli sungguhan** | Beli 1 kode di marketplace-mu sendiri, tukar, pesan, cek email |
| 8 | **Uji di iPhone & Android asli** | Terutama izin kamera & tombol unduh |
| 9 | **Link toko diisi** | `curl https://domainmu/api/config` → `hasShop:true` |
| 10 | **Stok kode chatbot > 0** | Buka `/admin`, kotak STOK CHATBOT jangan 0 |
| 11 | **Render server aktif** | `npm i @napi-rs/canvas` + taruh font di `assets/fonts/`. Startup harus menampilkan `renderServer: ON` |

## 1b. Menyimpan rahasia (SESSION_SECRET, ADMIN_KEY, dll.)

**Aturan utama:** nilai rahasia TIDAK PERNAH masuk git. Repo hanya berisi
`.env.example` (templat kosong). Job `secret-scan` di CI menggagalkan PR
yang berisi rahasia.

Server membaca semua rahasia dari **environment variable**. Jadi tempat
penyimpanannya bisa diganti kapan saja tanpa mengubah kode.

### Di mana menyimpannya

| Tempat | Isi |
|---|---|
| **Railway → service → Variables** | Rahasia PRODUKSI. Tandai yang sensitif sebagai **Sealed** — setelah disimpan, nilainya tidak bisa dilihat lagi (hanya bisa diganti) |
| **Password manager** (1Password / Bitwarden) | SALINAN nilai produksi — variabel Sealed tidak bisa dibaca kembali |
| **`.env` di laptop** | Nilai untuk coba-coba lokal saja (sudah di `.gitignore`) — JANGAN pakai nilai produksi |
| **GitHub → Settings → Secrets and variables → Actions** | Rahasia untuk CI saja, mis. `ANTHROPIC_API_KEY` |

### Yang wajib diisi di Railway

| Variable | Cara membuat | Sealed? |
|---|---|---|
| `NODE_ENV` | `production` | tidak |
| `SESSION_SECRET` | `openssl rand -hex 32` | **ya** |
| `ADMIN_KEY` | `openssl rand -hex 24` — dibuat TERPISAH, harus beda dari `SESSION_SECRET` | **ya** |
| `SMTP_PASS` | App Password Gmail / API key Brevo atau Resend | **ya** |
| `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN` | dari `npm run auth` | **ya** |
| `SMTP_HOST`, `SMTP_USER`, `STUDIO_EMAIL`, link toko, harga, dll. | lihat `.env.example` | tidak |

Server produksi **menolak hidup** kalau `SESSION_SECRET` / `ADMIN_KEY`
kosong, terlalu pendek, atau sama — deploy terlihat gagal di log Railway,
bukan diam-diam tidak aman.

### Mengganti (rotasi) rahasia

| Rahasia | Kapan | Dampak |
|---|---|---|
| `ADMIN_KEY` | kapan saja; WAJIB kalau pernah dibagikan / orang keluar dari tim | cukup login `/admin` dengan kunci baru |
| `SESSION_SECRET` | segera kalau dicurigai bocor; selain itu saat sepi | pembeli premium yang sedang aktif perlu memasukkan kode sekali lagi (masih dalam masa tenggang, tidak rugi) |
| `SMTP_PASS`, token Google | kalau bocor / akun diganti | ganti di Railway, lalu `npm run test-email` |

Langkah: buat nilai baru → ganti di Railway → Railway deploy ulang otomatis
→ perbarui salinan di password manager.

### Nanti, kalau perlu secret manager khusus

Tidak perlu sekarang. Kalau suatu saat ada tim, beberapa lingkungan
(staging + produksi), atau butuh log audit siapa mengubah apa:

* **Doppler / Infisical** — sinkron langsung ke Railway, tanpa ubah kode.
* **AWS Secrets Manager** — masuk akal HANYA kalau server pindah ke AWS
  (ECS/EC2/Lambda) dan izinnya lewat IAM role. Di Railway justru menambah
  satu rahasia lagi (AWS access key) yang harus disimpan di Railway juga.

Karena server hanya membaca environment variable, perpindahan ke salah
satunya **tidak butuh perubahan kode**.

## 2. Setelah live — rutinitas

| Kapan | Lakukan |
|---|---|
| Tiap hari | Cek `/admin` → stok chatbot & pesanan masuk |
| Tiap minggu | `npm run backup` — otomatis ikut terunggah ke Drive |
| Tiap minggu | `npm run logs -- error` — lihat kegagalan email/Drive |
| Tiap bulan | `npm run cleanup` (cek dulu), lalu `npm run cleanup -- --hapus` |
| Tiap bulan | Bersihkan inbox Gmail — query-nya dicetak oleh perintah cleanup |

## 3. Pemantauan

Endpoint `GET /healthz` (publik) hanya mengembalikan hidup/tidak:

```json
{"ok":true,"uptime":3600}
```

Detail hanya dengan header `x-admin-key` (stok kode & konfigurasi adalah
info bisnis — dulu terbuka untuk siapa pun):

```bash
curl -H "x-admin-key: $ADMIN_KEY" https://domainmu/healthz
# {"ok":true,"uptime":3600,"email":true,"drive":true,"render":true,
#  "chatbotStock":437,"pendingOrders":0,"failedOrders":0}
```

Pasang yang publik di UptimeRobot / Better Stack (gratis), tiap 5 menit.
Yang detail cukup dicek dari `/admin` atau monitor berbayar yang mendukung
header. Saat deploy (SIGTERM) `/healthz` menjawab 503 supaya pembeli tidak
diarahkan ke proses yang sedang mati. Yang penting dipantau:

* **`ok:false` atau tidak merespons** → situs mati, pembeli tidak bisa apa-apa
* **`email:false`** → pesanan masuk tapi tidak sampai ke kamu
* **`chatbotStock` mendekati 0** → pembeli baru tidak dapat kode

## 4. Kepatuhan data (UU PDP) — perlu keputusanmu

Teks persetujuan di website menjanjikan data "dihapus setelah pesanan selesai".
Saat ini **tidak ada** yang benar-benar menghapusnya:

| Tempat | Isi | Status |
|---|---|---|
| Inbox email | Foto, nama, alamat, kontak | Menumpuk selamanya |
| Google Drive | Foto asli + strip | Menumpuk selamanya |
| `data/orders.log` | Nama, kontak, alamat | Menumpuk selamanya |

**Yang perlu kamu putuskan:** berapa lama data disimpan (saran: 30 hari setelah
pesanan dikirim), lalu jalankan penghapusan rutin. Kalau janji di teks
persetujuan tidak ditepati, itu risiko hukum — bukan sekadar kerapian.

Pilihan cepat: ubah teks persetujuan agar jujur ("disimpan maksimal 90 hari"),
lalu tandai kalender untuk membersihkan Drive & inbox.

## 5. Kapasitas — sanggup berapa pengunjung?

Pertanyaan: **20.000 pengunjung/hari, masih aman dengan 1 server?**
Jawaban singkat: **ya**, tapi bukan karena servernya kuat — melainkan karena
sebagian besar pekerjaan tidak terjadi di server.

**Yang TIDAK membebani server:** kamera, hitung mundur, filter, penyusunan
strip, watermark — semuanya berjalan di browser pengunjung. Pengunjung gratis
praktis hanya mengunduh halaman (±60 KB) satu kali.

Hitungan kasar 20.000/hari:

| Beban | Angka | Penilaian |
|---|---|---|
| Muat halaman | ±0,25 permintaan/detik rata-rata | Sangat ringan |
| Puncak jam ramai (20% trafik) | ±1,1 permintaan/detik | Ringan |
| Penukaran kode (1% membeli = 200) | 200 tulis/hari | Ringan |
| Unggah pesanan | 200 × ±3 MB = ±600 MB/hari masuk | Wajar |

**Yang justru jadi batas nyata — bukan jumlah pengunjung:**

1. **Ukuran `codes.json`.** Bacaan kini dari cache memori (hanya dibaca ulang
   kalau berkas berubah), tapi setiap penukaran masih MENULIS seluruh berkas.
   20.000 kode ≈ 4 MB (cepat). Di 100.000 kode ≈ 20 MB, tiap penukaran
   jadi puluhan milidetik → mulai terasa.
   *Tindakan:* pindahkan kode lama yang sudah hangus ke arsip, atau naik ke
   SQLite saat total kode melewati ±50.000.

2. **Memori saat unggahan bersamaan.** Kini dibatasi di server: maksimal
   6 unggahan besar + 2 render HD berjalan BERSAMAAN (kelebihannya dijawab
   503 "server ramai, coba lagi"), dan body besar tanpa token ditolak
   sebelum dibaca. Puncak memori ≈ 6 × 25 MB × 3 ≈ 450 MB.
   *Tindakan:* pakai Railway dengan RAM ≥ 1 GB. Kalau sering muncul
   `gate.busy` di log, naikkan RAM lalu naikkan `UPLOAD_PARALEL` di
   `public/shared/contract.js`.

3. **Kuota Gmail 500 email/hari.** Kalau pesanan > 500/hari, Gmail berhenti
   mengirim. *Tindakan:* pindah ke Brevo/Resend sebelum sampai situ.

4. **Google Drive 15 GB.** ±3 MB per pesanan → habis di ±5.000 pesanan.
   *Tindakan:* jalankan `npm run cleanup` rutin.

**Kesimpulan jujur:** 20.000 pengunjung/hari aman, tapi angka yang perlu kamu
awasi adalah **jumlah PESANAN**, bukan pengunjung. Di atas ±500 pesanan/hari,
yang perlu diganti duluan adalah pengiriman email dan penyimpanan kode —
bukan jumlah servernya. Catatan: ini hitungan di atas kertas, belum diuji
beban sungguhan. Sebelum kampanye besar, uji dengan k6/Artillery.

---

## 6. Yang BELUM ada — sadari batasnya

| Hal | Dampak | Kapan perlu dikerjakan |
|---|---|---|
| Basis data sungguhan | `lib/store.js` hanya aman untuk 1 proses server | Saat menaikkan ke 2+ instance |
| Panel pesanan di `/admin` | Sekarang pesanan hanya di email & log | Kalau pesanan > 20/hari |
| Uji beban | Belum diuji dengan puluhan pengunjung bersamaan | Sebelum kampanye TikTok besar |
| CDN / WAF di depan server | Serangan DDoS volumetrik (jutaan permintaan) tetap membanjiri 1 server; rate limit di aplikasi hanya menahan penyalahgunaan | Pasang Cloudflare (gratis) di depan domain sebelum promosi besar — lalu set `TRUST_PROXY=2` |
| Redis untuk rate limit | Rate limit & kunci pesanan di memori 1 proses | Saat menaikkan ke 2+ instance |

## 7. Rencana kalau ada masalah

**Kode pembeli tidak berfungsi**
1. Buka `/admin` → tab Log → cari kodenya
2. `redeem.spent` = sudah dipakai memesan (lihat nomor pesanannya)
3. `redeem.expired` = lewat batas waktu → berikan kode pengganti dari Stok Admin

**Pesanan tidak sampai ke email**
1. `npm run logs -- error` → cari `email.failed`
2. `npm run test-email` untuk menguji koneksi SMTP
3. Foto masih ada di Google Drive kalau Drive aktif

**Situs mati / error 500**
1. Railway → Logs → cari `unhandled.exception`
2. Server otomatis dinyalakan ulang; kode yang sudah ditukar tetap aman di volume
3. Kalau `codes.json` rusak: pulihkan dari `data/codes.json.bak` atau `data/backups/`

**Kode habis di tengah kampanye**
`/admin` → Buat kode baru → pilih **Untuk chatbot** → unggah ke pool chatbot.
Tidak perlu restart server.
