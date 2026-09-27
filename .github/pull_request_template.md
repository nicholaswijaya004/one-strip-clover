## Apa yang berubah

<!-- Jelaskan singkat: apa & kenapa. Bukan daftar berkas — itu sudah terlihat di diff. -->

## Kenapa perlu

<!-- Masalah apa yang dipecahkan? Kalau memperbaiki bug, bagaimana cara memicunya? -->

## Cara mengujinya

<!-- Langkah konkret supaya reviewer bisa membuktikan sendiri -->
1.
2.

## Ceklis

- [ ] `npm run ci` lulus (lint, typecheck, tes, cakupan, simulasi, smoke test)
- [ ] Tidak ada `<script>` inline / `onclick=""` baru di HTML (CSP melarangnya)
- [ ] Teks dari server/pengguna yang masuk `innerHTML` lewat `esc()`
- [ ] Angka dari klien yang menentukan memori/CPU (ukuran, jumlah) dijepit di server
- [ ] Perubahan logika disertai tes
- [ ] Tidak ada rahasia / berkas `data/` ikut ter-commit
- [ ] Kalau menyentuh strip: ukuran cetak tetap **51 x 152 mm** di atas A4
- [ ] Kalau menyentuh penggambar strip: hanya diubah di
      `public/shared/strip-renderer.js` (tidak membuat salinan kedua)

## Dampak ke pembeli

<!-- Apakah ini bisa membuat kode yang sudah dijual gagal dipakai?
     Apakah pembeli perlu melakukan sesuatu? Tulis "tidak ada" kalau aman. -->
