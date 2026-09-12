# Alur Kerja & Setup CI

Dokumen ini menjelaskan cara kerja repo ini: dari menulis kode sampai
masuk ke `main`, plus cara menyalakan CI pertama kali.

---

## 1. Sekali saja: menyalakan CI

### a. Tambahkan API key Anthropic

Review otomatis oleh Claude butuh satu secret.

1. Ambil API key di https://console.anthropic.com → API Keys
2. Di repo GitHub: **Settings → Secrets and variables → Actions → New repository secret**
3. Nama: `ANTHROPIC_API_KEY`, isi: key-nya

Cara paling cepat sebenarnya lewat Claude Code di terminal:

```bash
claude
/install-github-app
```

Perintah itu memandu pemasangan GitHub App sekaligus secret-nya.
Kamu harus admin di repo tersebut.

> Tanpa secret ini, workflow lain (tes, cakupan, smoke test) tetap jalan —
> hanya review Claude yang dilewati.

### b. Kunci branch `main`

Supaya kode tidak bisa masuk ke `main` tanpa lewat CI:

**Settings → Branches → Add branch protection rule**

- Branch name pattern: `main`
- ✅ Require a pull request before merging
- ✅ Require status checks to pass before merging
  - pilih: `Tes & cakupan (Node 20)`, `Tes & cakupan (Node 22)`,
    `Server benar-benar bisa hidup`, `Tidak ada rahasia / data ikut ter-commit`
- ✅ Require branches to be up to date before merging
- ✅ Do not allow bypassing the above settings

Kalau kamu bekerja sendirian, **jangan** centang "Require approvals" —
kamu tidak bisa menyetujui PR-mu sendiri dan malah terkunci.

---

## 2. Alur harian

```
branch baru  →  koding  →  commit  →  push  →  PR  →  CI + review Claude  →  merge
```

```bash
git checkout -b fitur/nama-singkat
# ... koding ...
npm run ci                 # jalankan semua pemeriksaan SEBELUM push
git add .
git commit -m "Tambah X supaya Y"
git push -u origin fitur/nama-singkat
```

Lalu buka PR di GitHub. Dalam ±2 menit kamu akan melihat:

| Pemeriksaan | Yang dijaga |
|---|---|
| **Tes & cakupan** (Node 20 & 22) | 218 tes lulus, cakupan tidak turun |
| **Server benar-benar bisa hidup** | server boot, semua halaman 200, endpoint admin menolak tanpa kunci |
| **Tidak ada rahasia** | `.env` & `data/` tidak ikut ter-commit |
| **Review oleh Claude** | komentar berisi temuan keamanan/logika |

Merge kalau semuanya hijau.

### Minta bantuan Claude di tengah PR

Tulis komentar di PR atau issue:

```
@claude tolong jelaskan kenapa tes template gagal
@claude tambahkan tes untuk kasus kode kedaluwarsa
```

---

## 3. Perintah yang sering dipakai

```bash
npm test              # jalankan semua tes
npm run test:coverage # tes + ambang cakupan (yang dipakai CI)
npm run sim           # simulasi browser: halaman photobox benar-benar hidup?
npm run ci            # ketiganya sekaligus — jalankan ini sebelum push
npm start             # nyalakan server lokal
```

---

## 4. Ambang cakupan

Saat ini: **±94% baris, 93% fungsi, 79% cabang**.

Ambang di CI sengaja dipasang sedikit di bawahnya:

| | Ambang | Sekarang |
|---|---|---|
| Baris | 85% | 94% |
| Fungsi | 85% | 93% |
| Cabang | 70% | 79% |

Alasannya: PR yang menurunkan cakupan **secara berarti** akan gagal, tapi
perbaikan kecil tidak terhambat hanya karena turun 0,3%. Naikkan angkanya
di `package.json` seiring cakupan membaik.

`lib/render.js` cakupannya rendah karena butuh `@napi-rs/canvas` yang
opsional. Itu wajar dan sudah diperhitungkan.

---

## 5. Tes tidak boleh menyentuh data asli

Setiap berkas tes yang memakai `lib/codes`, `lib/template`, `lib/settings`,
`lib/queue`, atau `lib/logger` WAJIB diawali baris ini:

```js
require("./_setup").pakaiDataSementara();
```

Itu mengarahkan `DATA_DIR` ke folder sementara. Tanpa itu, `npm test`
akan menulis ke `data/codes.json` ASLI — kode yang sudah kamu jual bisa
tertimpa. Ada tes yang menjaga aturan ini, jadi kalau lupa, CI akan gagal.

Lokasi folder data hanya boleh dihitung di `lib/paths.js`.

---

## 6. Tidak ada teks ajaib

Kode error, alamat API, batas ukuran, dan status HTTP **tidak boleh** ditulis
sebagai teks/angka mentah. Semuanya ada di `public/shared/contract.js` —
satu berkas yang dipakai server DAN browser.

```js
// ❌ jangan
res.status(409).json({ error: "SPENT" });
if (d.error === "SPENT") { ... }

// ✅ begini
res.status(HTTP.CONFLICT).json({ error: ERR.SPENT });
if (d.error === ERR.SPENT) { ... }
```

Alasannya bukan kerapian: dulu `"SPENT"` ditulis terpisah di server dan di
browser. Salah ketik di salah satu sisi tidak ketahuan sampai ada pembeli
melihat pesan kosong. Dengan konstanta, salah ketik langsung jadi `undefined`.

Ada 5 tes yang menjaga aturan ini — CI gagal kalau ada yang tercecer.

---

## 7. Aturan yang dijaga CI

Tiga hal ini pernah menjadi bug nyata di proyek ini, jadi sekarang dijaga
otomatis:

1. **Penggambar strip hanya boleh ada di satu berkas.**
   `public/shared/strip-renderer.js` dipakai browser DAN server. Salinan
   kedua pasti akan melenceng suatu hari, dan hasil unduhan pembeli jadi
   berbeda dari pratinjau.

2. **Penulisan `codes.json` harus lewat `lib/store.js`.**
   Penulisan langsung dengan `fs` menyebabkan dua permintaan bersamaan
   saling menimpa — kode yang sudah ditukar bisa "hidup lagi".

3. **Pemeriksaan yang menyangkut uang harus di server.**
   Apa pun di browser bisa diubah lewat DevTools.

---

## 8. Struktur repo

```
lib/          logika inti (diuji unit, tanpa I/O kalau bisa)
lib/http/     middleware Express (keamanan, rate limit, ukuran badan)
lib/paths.js  satu-satunya tempat yang tahu lokasi folder data
public/       halaman: index (depan), booth (photobox), admin
public/shared/ kode yang dipakai browser DAN server:
                 contract.js      kode error, rute, batasan
                 strip-renderer.js penggambar strip
scripts/      perkakas: generate kode, backup, template, simulasi
test/         tes unit (node --test bawaan, tanpa framework)
data/         data jalan — TIDAK ikut git, ada di volume server
backend-go/   proyek belajar (Go + OOAD) — BELUM dipakai produksi
frontend-react/ proyek belajar (React) — BELUM dipakai produksi
```
