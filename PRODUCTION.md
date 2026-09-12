# 🚀 KESIAPAN PRODUKSI — One Strip Clover

Ceklis sebelum menerima uang pembeli sungguhan.
Perbaikan keamanan yang sudah dikerjakan ada di `SECURITY.md`.

---

## 1. WAJIB sebelum go-live

| # | Hal | Cara memastikan |
|---|---|---|
| 1 | **`.env` terisi lengkap** | Jalankan `npm start`, lihat ringkasan KONFIGURASI. Semua harus `ON` |
| 2 | **`SESSION_SECRET` diisi** | Kalau kosong, sesi pembeli hangus tiap deploy |
| 3 | **`ADMIN_KEY` acak & panjang** | `node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"` |
| 4 | **`.env` TIDAK di GitHub** | `git status` — `.env` tidak boleh muncul |
| 5 | **Volume ter-mount di `/app/data`** | Tanpa ini, semua kode ter-reset tiap deploy |
| 6 | **HTTPS aktif** | Kamera browser tidak jalan tanpa HTTPS |
| 7 | **Uji beli sungguhan** | Beli 1 kode di marketplace-mu sendiri, tukar, pesan, cek email |
| 8 | **Uji di iPhone & Android asli** | Terutama izin kamera & tombol unduh |
| 9 | **Link toko diisi** | `curl https://domainmu/api/config` → `hasShop:true` |
| 10 | **Stok kode chatbot > 0** | Buka `/admin`, kotak STOK CHATBOT jangan 0 |
| 11 | **Render server aktif** | `npm i @napi-rs/canvas` + taruh font di `assets/fonts/`. Startup harus menampilkan `renderServer: ON` |

## 2. Setelah live — rutinitas

| Kapan | Lakukan |
|---|---|
| Tiap hari | Cek `/admin` → stok chatbot & pesanan masuk |
| Tiap minggu | `npm run backup` — otomatis ikut terunggah ke Drive |
| Tiap minggu | `npm run logs -- error` — lihat kegagalan email/Drive |
| Tiap bulan | `npm run cleanup` (cek dulu), lalu `npm run cleanup -- --hapus` |
| Tiap bulan | Bersihkan inbox Gmail — query-nya dicetak oleh perintah cleanup |

## 3. Pemantauan

Endpoint `GET /healthz` mengembalikan:

```json
{"ok":true,"uptime":3600,"email":true,"drive":true,"chatbotStock":437}
```

Pasang di UptimeRobot / Better Stack (gratis), periksa tiap 5 menit.
Yang penting dipantau:

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

1. **Ukuran `codes.json`.** Setiap penukaran membaca & menulis SELURUH berkas.
   20.000 kode ≈ 4 MB (masih cepat). Di 100.000 kode ≈ 20 MB, tiap penukaran
   jadi ratusan milidetik dan operasinya berurutan → mulai terasa.
   *Tindakan:* pindahkan kode lama yang sudah hangus ke arsip, atau naik ke
   SQLite saat total kode melewati ±50.000.

2. **Memori saat unggahan bersamaan.** Tiap unggahan bisa 25 MB di memori.
   10 orang mengirim bersamaan ≈ 250-400 MB.
   *Tindakan:* pakai Railway dengan RAM ≥ 1 GB, jangan paket paling kecil.

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
