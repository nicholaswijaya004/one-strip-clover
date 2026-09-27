# Font untuk render strip di server

Font brand **sudah ikut di repo**, jadi hasil unduhan premium sama persis
dengan pratinjau di browser — di laptop, CI, maupun Railway.

| Berkas | Dipakai untuk | Sumber |
|---|---|---|
| `Parisienne-Regular.ttf`  | judul "One Strip Clover" | [google/fonts](https://github.com/google/fonts/tree/main/ofl/parisienne) |
| `Montserrat-SemiBold.ttf` | label & slogan (600)     | [JulietaUla/Montserrat](https://github.com/JulietaUla/Montserrat) (TTF statis) |
| `Montserrat-Bold.ttf`     | watermark (700)          | [JulietaUla/Montserrat](https://github.com/JulietaUla/Montserrat) (TTF statis) |
| `IBMPlexMono-Regular.ttf` | tanggal (400)            | [google/fonts](https://github.com/google/fonts/tree/main/ofl/ibmplexmono) |

Semua berlisensi **SIL Open Font License 1.1** — bebas dipakai komersial.
OFL mewajibkan teks lisensinya ikut disebarkan bersama font, jadi ada di
[`licenses/`](licenses/). Jangan hapus folder itu.

Saat server menyala, ringkasan startup menampilkan:

    renderServer     : ON (font: Parisienne,Montserrat,IBM Plex Mono)

Kalau satu berkas hilang, log menampilkan `render.font_missing` beserta
namanya; kalau semuanya hilang, `render.no_fonts`. `npm test` juga gagal.
