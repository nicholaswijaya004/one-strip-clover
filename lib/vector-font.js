/**
 * HURUF VEKTOR SEDERHANA
 *
 * Kenapa ada: pembuat template menulis piksel PNG langsung (tanpa canvas
 * maupun pustaka gambar), jadi tidak ada cara menggambar teks. Modul ini
 * mendefinisikan bentuk tiap huruf sebagai garis-garis, lalu menggambarnya
 * titik demi titik.
 *
 * Gayanya geometris/teknis — cocok untuk label huruf besar berjarak lebar,
 * seperti "ONE STRIP CLOVER" pada strip. Untuk tulisan tangan/skrip khas
 * brand, desain sebaiknya dibuat di Canva/Figma lalu diunggah.
 *
 * Koordinat tiap huruf: x 0..1 (kiri→kanan), y 0..1 (0 = dasar, 1 = puncak).
 */

// Tiap huruf = kumpulan garis-patah (polyline)
const GLYPHS = {
  A: [[[0, 0], [0.5, 1], [1, 0]], [[0.2, 0.38], [0.8, 0.38]]],
  B: [
    [[0, 0], [0, 1], [0.68, 1], [0.86, 0.86], [0.86, 0.68], [0.68, 0.55], [0, 0.55]],
    [[0, 0.55], [0.74, 0.55], [0.92, 0.4], [0.92, 0.16], [0.74, 0], [0, 0]],
  ],
  C: [[[0.95, 0.82], [0.72, 1], [0.3, 1], [0.05, 0.74], [0.05, 0.26], [0.3, 0], [0.72, 0], [0.95, 0.18]]],
  D: [[[0, 0], [0, 1], [0.58, 1], [0.9, 0.72], [0.9, 0.28], [0.58, 0], [0, 0]]],
  E: [[[0.9, 1], [0, 1], [0, 0], [0.9, 0]], [[0, 0.5], [0.68, 0.5]]],
  F: [[[0.9, 1], [0, 1], [0, 0]], [[0, 0.52], [0.68, 0.52]]],
  G: [
    [[0.95, 0.82], [0.72, 1], [0.3, 1], [0.05, 0.74], [0.05, 0.26], [0.3, 0], [0.72, 0], [0.95, 0.18], [0.95, 0.44]],
    [[0.95, 0.44], [0.55, 0.44]],
  ],
  H: [[[0, 0], [0, 1]], [[1, 0], [1, 1]], [[0, 0.5], [1, 0.5]]],
  I: [[[0.5, 0], [0.5, 1]]],
  J: [[[0.85, 1], [0.85, 0.26], [0.62, 0], [0.26, 0], [0.05, 0.22]]],
  K: [[[0, 0], [0, 1]], [[0.92, 1], [0.05, 0.44]], [[0.3, 0.6], [0.95, 0]]],
  L: [[[0, 1], [0, 0], [0.85, 0]]],
  M: [[[0, 0], [0, 1], [0.5, 0.32], [1, 1], [1, 0]]],
  N: [[[0, 0], [0, 1], [1, 0], [1, 1]]],
  O: [[[0.5, 1], [0.84, 0.84], [0.95, 0.5], [0.84, 0.16], [0.5, 0], [0.16, 0.16], [0.05, 0.5], [0.16, 0.84], [0.5, 1]]],
  P: [[[0, 0], [0, 1], [0.7, 1], [0.9, 0.85], [0.9, 0.66], [0.7, 0.52], [0, 0.52]]],
  Q: [
    [[0.5, 1], [0.84, 0.84], [0.95, 0.5], [0.84, 0.16], [0.5, 0], [0.16, 0.16], [0.05, 0.5], [0.16, 0.84], [0.5, 1]],
    [[0.62, 0.24], [1, -0.08]],
  ],
  R: [
    [[0, 0], [0, 1], [0.7, 1], [0.9, 0.85], [0.9, 0.66], [0.7, 0.52], [0, 0.52]],
    [[0.45, 0.52], [0.95, 0]],
  ],
  S: [[[0.92, 0.84], [0.7, 1], [0.28, 1], [0.06, 0.84], [0.06, 0.62], [0.28, 0.52], [0.7, 0.5], [0.92, 0.38], [0.92, 0.16], [0.7, 0], [0.28, 0], [0.06, 0.16]]],
  T: [[[0, 1], [1, 1]], [[0.5, 1], [0.5, 0]]],
  U: [[[0, 1], [0, 0.26], [0.22, 0], [0.78, 0], [1, 0.26], [1, 1]]],
  V: [[[0, 1], [0.5, 0], [1, 1]]],
  W: [[[0, 1], [0.24, 0], [0.5, 0.62], [0.76, 0], [1, 1]]],
  X: [[[0, 0], [1, 1]], [[0, 1], [1, 0]]],
  Y: [[[0, 1], [0.5, 0.52], [1, 1]], [[0.5, 0.52], [0.5, 0]]],
  Z: [[[0, 1], [1, 1], [0, 0], [1, 0]]],

  "@": [
    [[0.72, 0.28], [0.5, 0.2], [0.34, 0.34], [0.36, 0.6], [0.56, 0.72], [0.7, 0.62], [0.72, 0.28], [0.86, 0.3], [0.92, 0.55]],
    [[0.92, 0.55], [0.8, 0.9], [0.42, 1], [0.12, 0.82], [0.05, 0.5], [0.16, 0.16], [0.5, 0.02], [0.78, 0.08]],
  ],
  "·": [[[0.5, 0.46], [0.52, 0.46]]],
  ".": [[[0.5, 0.03], [0.52, 0.03]]],
  ",": [[[0.5, 0.06], [0.4, -0.08]]],
  "'": [[[0.5, 1], [0.44, 0.78]]],
  "-": [[[0.15, 0.48], [0.85, 0.48]]],
  "&": [[[0.9, 0], [0.25, 0.62], [0.3, 0.92], [0.6, 0.96], [0.66, 0.72], [0.1, 0.3], [0.2, 0.05], [0.55, 0.06], [0.9, 0.42]]],
  "!": [[[0.5, 1], [0.5, 0.28]], [[0.5, 0.06], [0.52, 0.06]]],
  " ": [],
};

// Lebar tiap huruf (relatif tinggi). Huruf sempit tidak boleh makan tempat.
const LEBAR = { I: 0.28, ".": 0.34, ",": 0.34, "·": 0.42, "'": 0.3, " ": 0.42, M: 1.12, W: 1.12 };
const lebarGlyph = (ch) => LEBAR[ch] != null ? LEBAR[ch] : 0.95;

/**
 * Hitung lebar total sebuah teks.
 * @param {string} teks
 * @param {number} tinggi tinggi huruf dalam piksel
 * @param {number} spasi jarak antar huruf (relatif tinggi)
 */
function ukurTeks(teks, tinggi, spasi = 0.18) {
  const s = teks.toUpperCase();
  let w = 0;
  for (let i = 0; i < s.length; i++) {
    w += lebarGlyph(s[i]) * tinggi;
    if (i < s.length - 1) w += spasi * tinggi;
  }
  return w;
}

/**
 * Gambar teks ke buffer piksel.
 * @param {object} kanvas { set(x,y,r,g,b,a), W, H }
 * @param {string} teks
 * @param {object} o { x, y, tinggi, warna:[r,g,b], tebal, spasi, align:"left"|"center" }
 *                 y = garis DASAR huruf (baseline)
 */
function gambarTeks(kanvas, teks, o) {
  const s = teks.toUpperCase();
  const tinggi = o.tinggi;
  const spasi = o.spasi == null ? 0.18 : o.spasi;
  const tebal = o.tebal || Math.max(1, tinggi * 0.09);
  const [r, g, b] = o.warna || [0, 0, 0];
  const alpha = o.alpha == null ? 255 : o.alpha;

  let x = o.x;
  if (o.align === "center") x = o.x - ukurTeks(teks, tinggi, spasi) / 2;

  for (const ch of s) {
    const garis = GLYPHS[ch];
    const w = lebarGlyph(ch) * tinggi;
    if (garis) {
      for (const poly of garis) {
        for (let i = 0; i < poly.length - 1; i++) {
          garisTebal(
            kanvas,
            x + poly[i][0] * w, o.y - poly[i][1] * tinggi,
            x + poly[i + 1][0] * w, o.y - poly[i + 1][1] * tinggi,
            tebal, r, g, b, alpha
          );
        }
        // titik tunggal (mis. titik pada "·") tetap tergambar
        if (poly.length === 1) {
          titik(kanvas, x + poly[0][0] * w, o.y - poly[0][1] * tinggi, tebal, r, g, b, alpha);
        }
      }
    }
    x += w + spasi * tinggi;
  }
}

function titik(k, cx, cy, tebal, r, g, b, a) {
  const rad = tebal / 2;
  for (let y = Math.floor(cy - rad); y <= Math.ceil(cy + rad); y++) {
    for (let x = Math.floor(cx - rad); x <= Math.ceil(cx + rad); x++) {
      if ((x - cx) ** 2 + (y - cy) ** 2 <= rad * rad) k.set(x, y, r, g, b, a);
    }
  }
}

function garisTebal(k, x0, y0, x1, y1, tebal, r, g, b, a) {
  const dx = x1 - x0, dy = y1 - y0;
  const panjang = Math.max(1, Math.hypot(dx, dy));
  const langkah = Math.ceil(panjang * 2);
  for (let i = 0; i <= langkah; i++) {
    const t = i / langkah;
    titik(k, x0 + dx * t, y0 + dy * t, tebal, r, g, b, a);
  }
}

module.exports = { gambarTeks, ukurTeks, GLYPHS };
