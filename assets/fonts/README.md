# Font untuk render strip di server

Taruh 4 berkas ini di folder ini supaya hasil unduhan premium **sama persis**
dengan pratinjau di browser. Kalau tidak ada, server tetap bisa merender
tetapi teks footer memakai font bawaan sistem (bentuknya berbeda).

| Berkas yang dibutuhkan | Ambil dari |
|---|---|
| `Parisienne-Regular.ttf`   | https://fonts.google.com/specimen/Parisienne |
| `Montserrat-SemiBold.ttf`  | https://fonts.google.com/specimen/Montserrat |
| `Montserrat-Bold.ttf`      | https://fonts.google.com/specimen/Montserrat |
| `IBMPlexMono-Regular.ttf`  | https://fonts.google.com/specimen/IBM+Plex+Mono |

Cara: buka tautannya → **Get font** → **Download all** → ekstrak →
salin berkas `.ttf` yang namanya cocok ke folder ini.

Semua font di atas berlisensi SIL Open Font License — bebas dipakai komersial.

Setelah menaruh font, restart server. Ringkasan startup akan menampilkan:

    renderServer     : ON (font: Parisienne,Montserrat,IBM Plex Mono)
