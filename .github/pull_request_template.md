## Apa yang berubah

<!-- Jelaskan singkat: apa & kenapa. Bukan daftar berkas — itu sudah terlihat di diff. -->

## Kenapa perlu

<!-- Masalah apa yang dipecahkan? Kalau memperbaiki bug, bagaimana cara memicunya? -->

## Cara mengujinya

<!-- Langkah konkret supaya reviewer bisa membuktikan sendiri -->
1.
2.

## Ceklis

- [ ] `npm test` lulus
- [ ] `npm run test:coverage` lulus (cakupan tidak turun)
- [ ] `npm run sim` lulus (halaman photobox masih hidup)
- [ ] Perubahan logika disertai tes
- [ ] Tidak ada rahasia / berkas `data/` ikut ter-commit
- [ ] Kalau menyentuh strip: ukuran cetak tetap **51 x 152 mm** di atas A4
- [ ] Kalau menyentuh penggambar strip: hanya diubah di
      `public/shared/strip-renderer.js` (tidak membuat salinan kedua)

## Dampak ke pembeli

<!-- Apakah ini bisa membuat kode yang sudah dijual gagal dipakai?
     Apakah pembeli perlu melakukan sesuatu? Tulis "tidak ada" kalau aman. -->
