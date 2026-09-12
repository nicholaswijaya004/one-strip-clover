/**
 * HURUF SAMBUNG (SKRIP) — untuk template strip
 *
 * Huruf geometris di vector-font.js terasa kaku untuk brand seperti
 * One Strip Clover. Modul ini menggambar huruf sambung yang mengalir,
 * mendekati gaya tulisan tangan pada contoh desain.
 *
 * Tiga hal yang membuatnya terlihat seperti tulisan tangan:
 *   1. KURVA — tiap huruf disusun dari kurva bezier, bukan garis lurus
 *   2. MIRING — seluruh huruf dicondongkan ±12°, seperti tulisan tangan
 *   3. TEBAL-TIPIS — goresan menurun dibuat tebal, goresan naik tipis,
 *      meniru pena kaligrafi. Inilah yang paling membedakannya dari font biasa.
 *
 * Sistem koordinat: x 0..1 (kiri→kanan), y 0 = garis dasar, 0.5 = tinggi
 * huruf kecil, 1.0 = tinggi huruf besar, negatif = ekor ke bawah (p, g, y).
 */

// Lucida Handwriting hampir tegak (±6°), bulat, dan tebalnya cukup rata.
// Font aslinya berlisensi & tidak tersedia di sini, jadi bentuk di bawah
// disetel agar KARAKTERNYA mendekati: sedikit miring, bulat, bobot merata.
const MIRING = 0.11;

/** Sampel kurva bezier kuadratik jadi titik-titik */
function q(x0, y0, cx, cy, x1, y1, n = 26) {
  const t = [];
  for (let i = 0; i <= n; i++) {
    const s = i / n, u = 1 - s;
    t.push([
      u * u * x0 + 2 * u * s * cx + s * s * x1,
      u * u * y0 + 2 * u * s * cy + s * s * y1,
    ]);
  }
  return t;
}

/** Gabung beberapa kurva jadi satu goresan menyambung */
function rangkai(...bagian) {
  const out = [];
  for (const b of bagian) for (const p of b) out.push(p);
  return out;
}

// Tiap huruf: { s: [goresan...], w: lebar }
// Goresan pertama biasanya menyambung dari huruf sebelumnya.
const SKRIP = {
  a: { w: 0.62, s: [
    rangkai(
      q(0.58, 0.40, 0.46, 0.54, 0.30, 0.50),
      q(0.10, 0.46, 0.10, 0.24, 0.14, 0.12),
      q(0.20, 0.00, 0.44, 0.00, 0.56, 0.14)
    ),
    rangkai(q(0.56, 0.48, 0.54, 0.20, 0.56, 0.08), q(0.58, 0.00, 0.72, 0.04, 0.80, 0.12)),
  ]},
  b: { w: 0.60, s: [
    rangkai(q(0.18, 0.00, 0.10, 0.55, 0.26, 0.96), q(0.34, 1.10, 0.30, 0.55, 0.24, 0.30),
      q(0.30, 0.48, 0.48, 0.50, 0.56, 0.36), q(0.64, 0.18, 0.46, 0.00, 0.28, 0.06)),
    rangkai(q(0.50, 0.10, 0.66, 0.02, 0.80, 0.12)),
  ]},
  c: { w: 0.58, s: [
    rangkai(q(0.60, 0.40, 0.48, 0.54, 0.32, 0.50),
      q(0.10, 0.46, 0.10, 0.20, 0.20, 0.08),
      q(0.32, -0.02, 0.56, 0.02, 0.66, 0.14)),
  ]},
  d: { w: 0.62, s: [
    rangkai(q(0.56, 0.40, 0.44, 0.54, 0.28, 0.50),
      q(0.08, 0.46, 0.08, 0.20, 0.18, 0.08),
      q(0.30, -0.02, 0.50, 0.02, 0.58, 0.14)),
    rangkai(q(0.58, 0.96, 0.54, 0.40, 0.56, 0.10), q(0.58, 0.00, 0.72, 0.04, 0.80, 0.12)),
  ]},
  e: { w: 0.56, s: [
    rangkai(q(0.14, 0.22, 0.38, 0.30, 0.58, 0.34),
      q(0.62, 0.52, 0.38, 0.52, 0.26, 0.44),
      q(0.08, 0.32, 0.12, 0.06, 0.32, 0.03),
      q(0.52, 0.00, 0.62, 0.08, 0.68, 0.16)),
  ]},
  f: { w: 0.54, s: [
    rangkai(q(0.10, -0.26, 0.28, 0.30, 0.34, 0.90),
      q(0.36, 1.10, 0.22, 1.02, 0.24, 0.70),
      q(0.26, 0.30, 0.30, 0.10, 0.40, 0.04),
      q(0.52, 0.00, 0.62, 0.08, 0.70, 0.14)),
    rangkai(q(0.08, 0.44, 0.30, 0.50, 0.52, 0.46)),
  ]},
  g: { w: 0.62, s: [
    rangkai(q(0.58, 0.40, 0.46, 0.54, 0.30, 0.50),
      q(0.10, 0.46, 0.10, 0.22, 0.16, 0.10),
      q(0.24, 0.00, 0.46, 0.02, 0.56, 0.16)),
    rangkai(q(0.56, 0.48, 0.54, 0.10, 0.52, -0.14),
      q(0.48, -0.34, 0.26, -0.30, 0.18, -0.20)),
  ]},
  h: { w: 0.62, s: [
    rangkai(q(0.16, 0.00, 0.10, 0.55, 0.26, 0.96), q(0.34, 1.10, 0.28, 0.50, 0.22, 0.06)),
    rangkai(q(0.20, 0.26, 0.36, 0.54, 0.52, 0.42), q(0.62, 0.32, 0.60, 0.14, 0.58, 0.06),
      q(0.60, -0.02, 0.74, 0.04, 0.82, 0.12)),
  ]},
  i: { w: 0.40, s: [
    rangkai(q(0.14, 0.10, 0.20, 0.36, 0.26, 0.48), q(0.24, 0.20, 0.24, 0.10, 0.28, 0.04),
      q(0.36, -0.02, 0.48, 0.04, 0.56, 0.12)),
    q(0.30, 0.66, 0.33, 0.70, 0.36, 0.66, 4),
  ]},
  j: { w: 0.42, s: [
    rangkai(q(0.22, 0.48, 0.28, 0.20, 0.26, -0.12),
      q(0.24, -0.34, 0.08, -0.30, 0.02, -0.20)),
    q(0.32, 0.66, 0.35, 0.70, 0.38, 0.66, 4),
  ]},
  k: { w: 0.62, s: [
    rangkai(q(0.16, 0.00, 0.10, 0.55, 0.26, 0.96), q(0.34, 1.10, 0.28, 0.50, 0.22, 0.06)),
    rangkai(q(0.58, 0.46, 0.32, 0.30, 0.20, 0.20)),
    rangkai(q(0.30, 0.26, 0.44, 0.20, 0.60, 0.04), q(0.66, 0.00, 0.76, 0.06, 0.82, 0.12)),
  ]},
  l: { w: 0.46, s: [
    rangkai(q(0.18, 0.00, 0.10, 0.55, 0.28, 0.96),
      q(0.38, 1.10, 0.30, 0.46, 0.26, 0.10),
      q(0.30, 0.00, 0.44, 0.04, 0.54, 0.12)),
  ]},
  m: { w: 0.84, s: [
    rangkai(q(0.10, 0.00, 0.12, 0.30, 0.14, 0.48)),
    rangkai(q(0.12, 0.26, 0.24, 0.54, 0.36, 0.44), q(0.44, 0.34, 0.42, 0.16, 0.40, 0.02)),
    rangkai(q(0.40, 0.26, 0.52, 0.54, 0.64, 0.44), q(0.74, 0.34, 0.72, 0.14, 0.70, 0.04),
      q(0.74, -0.02, 0.86, 0.04, 0.94, 0.12)),
  ]},
  n: { w: 0.62, s: [
    rangkai(q(0.12, 0.00, 0.14, 0.30, 0.16, 0.48)),
    rangkai(q(0.14, 0.26, 0.30, 0.54, 0.46, 0.44), q(0.58, 0.34, 0.56, 0.14, 0.54, 0.04),
      q(0.58, -0.02, 0.70, 0.04, 0.78, 0.12)),
  ]},
  o: { w: 0.60, s: [
    rangkai(q(0.56, 0.34, 0.52, 0.54, 0.32, 0.50),
      q(0.10, 0.46, 0.10, 0.20, 0.22, 0.08),
      q(0.36, -0.02, 0.58, 0.06, 0.56, 0.26),
      q(0.55, 0.36, 0.66, 0.36, 0.78, 0.26)),
  ]},
  p: { w: 0.62, s: [
    rangkai(q(0.14, 0.48, 0.10, 0.10, 0.06, -0.28)),
    rangkai(q(0.12, 0.40, 0.34, 0.56, 0.50, 0.42), q(0.64, 0.28, 0.52, 0.02, 0.30, 0.06),
      q(0.20, 0.08, 0.16, 0.14, 0.14, 0.20)),
    rangkai(q(0.50, 0.10, 0.66, 0.02, 0.80, 0.12)),
  ]},
  q: { w: 0.62, s: [
    rangkai(q(0.58, 0.40, 0.46, 0.54, 0.30, 0.50),
      q(0.10, 0.46, 0.10, 0.22, 0.16, 0.10),
      q(0.24, 0.00, 0.46, 0.02, 0.56, 0.16)),
    rangkai(q(0.56, 0.48, 0.52, 0.10, 0.54, -0.20), q(0.58, -0.30, 0.70, -0.22, 0.78, -0.14)),
  ]},
  r: { w: 0.52, s: [
    rangkai(q(0.14, 0.00, 0.16, 0.28, 0.18, 0.46)),
    rangkai(q(0.16, 0.30, 0.30, 0.52, 0.44, 0.44), q(0.52, 0.40, 0.56, 0.34, 0.62, 0.30)),
  ]},
  s: { w: 0.50, s: [
    rangkai(q(0.54, 0.40, 0.44, 0.52, 0.28, 0.48),
      q(0.14, 0.44, 0.16, 0.32, 0.30, 0.26),
      q(0.46, 0.18, 0.52, 0.12, 0.46, 0.04),
      q(0.36, -0.02, 0.20, 0.04, 0.14, 0.12)),
  ]},
  t: { w: 0.48, s: [
    rangkai(q(0.26, 0.78, 0.26, 0.34, 0.26, 0.10), q(0.28, 0.00, 0.42, 0.04, 0.52, 0.12)),
    rangkai(q(0.08, 0.48, 0.28, 0.52, 0.46, 0.48)),
  ]},
  u: { w: 0.62, s: [
    rangkai(q(0.14, 0.48, 0.10, 0.16, 0.20, 0.06), q(0.32, -0.02, 0.44, 0.16, 0.48, 0.30)),
    rangkai(q(0.50, 0.48, 0.50, 0.16, 0.52, 0.06), q(0.58, -0.02, 0.70, 0.04, 0.78, 0.12)),
  ]},
  v: { w: 0.58, s: [
    rangkai(q(0.12, 0.48, 0.16, 0.14, 0.32, 0.04), q(0.46, -0.02, 0.52, 0.24, 0.54, 0.46),
      q(0.60, 0.34, 0.68, 0.28, 0.78, 0.26)),
  ]},
  w: { w: 0.82, s: [
    rangkai(q(0.10, 0.48, 0.12, 0.12, 0.26, 0.04), q(0.38, -0.02, 0.42, 0.26, 0.44, 0.44),
      q(0.48, 0.10, 0.58, 0.02, 0.68, 0.06),
      q(0.78, 0.12, 0.76, 0.32, 0.74, 0.46),
      q(0.80, 0.34, 0.88, 0.28, 0.96, 0.26)),
  ]},
  x: { w: 0.56, s: [
    rangkai(q(0.12, 0.44, 0.34, 0.24, 0.58, 0.02)),
    rangkai(q(0.14, 0.04, 0.36, 0.24, 0.62, 0.44)),
  ]},
  y: { w: 0.62, s: [
    rangkai(q(0.14, 0.48, 0.10, 0.16, 0.22, 0.06), q(0.34, -0.02, 0.46, 0.18, 0.50, 0.34)),
    rangkai(q(0.52, 0.48, 0.48, 0.08, 0.44, -0.16), q(0.38, -0.34, 0.18, -0.30, 0.10, -0.20)),
  ]},
  z: { w: 0.56, s: [
    rangkai(q(0.12, 0.44, 0.34, 0.48, 0.56, 0.44), q(0.36, 0.26, 0.22, 0.12, 0.12, 0.04),
      q(0.34, 0.00, 0.52, 0.02, 0.66, 0.10)),
  ]},

  // ---- huruf besar (lebih besar & berhias) ----
  A: { w: 0.92, s: [
    rangkai(q(0.06, 0.00, 0.30, 0.56, 0.46, 0.98), q(0.56, 0.70, 0.66, 0.34, 0.78, 0.02)),
    rangkai(q(0.20, 0.30, 0.46, 0.38, 0.70, 0.30)),
  ]},
  C: { w: 0.88, s: [
    rangkai(q(0.84, 0.74, 0.70, 0.98, 0.44, 0.94),
      q(0.10, 0.88, 0.06, 0.36, 0.26, 0.12),
      q(0.44, -0.08, 0.72, 0.04, 0.82, 0.20)),
    rangkai(q(0.40, 0.86, 0.62, 0.92, 0.86, 0.88)),
  ]},
  E: { w: 0.80, s: [
    rangkai(q(0.78, 0.86, 0.52, 1.02, 0.30, 0.86),
      q(0.14, 0.72, 0.30, 0.54, 0.48, 0.52),
      q(0.24, 0.52, 0.10, 0.34, 0.24, 0.14),
      q(0.42, -0.06, 0.70, 0.06, 0.80, 0.18)),
  ]},
  H: { w: 0.92, s: [
    rangkai(q(0.10, 0.02, 0.16, 0.52, 0.24, 0.96), q(0.30, 0.60, 0.28, 0.26, 0.30, 0.04)),
    rangkai(q(0.62, 0.02, 0.66, 0.52, 0.74, 0.96), q(0.82, 0.56, 0.80, 0.24, 0.82, 0.04)),
    rangkai(q(0.28, 0.46, 0.52, 0.54, 0.78, 0.46)),
  ]},
  L: { w: 0.82, s: [
    rangkai(q(0.16, 0.06, 0.10, 0.60, 0.34, 0.96),
      q(0.46, 1.10, 0.36, 0.50, 0.28, 0.16),
      q(0.34, 0.00, 0.60, 0.02, 0.80, 0.12)),
  ]},
  M: { w: 1.02, s: [
    rangkai(q(0.06, 0.00, 0.10, 0.50, 0.16, 0.94),
      q(0.26, 0.60, 0.34, 0.30, 0.44, 0.06),
      q(0.52, 0.36, 0.58, 0.66, 0.66, 0.94),
      q(0.76, 0.60, 0.84, 0.28, 0.92, 0.04)),
  ]},
  N: { w: 0.94, s: [
    rangkai(q(0.08, 0.00, 0.12, 0.50, 0.18, 0.94),
      q(0.42, 0.58, 0.60, 0.28, 0.76, 0.04),
      q(0.80, 0.40, 0.84, 0.70, 0.88, 0.94)),
  ]},
  O: { w: 0.92, s: [
    rangkai(q(0.80, 0.66, 0.72, 0.98, 0.44, 0.94),
      q(0.10, 0.88, 0.06, 0.34, 0.28, 0.10),
      q(0.50, -0.10, 0.82, 0.10, 0.78, 0.44),
      q(0.76, 0.66, 0.60, 0.70, 0.48, 0.58)),
  ]},
  P: { w: 0.86, s: [
    rangkai(q(0.14, 0.00, 0.18, 0.50, 0.24, 0.94),
      q(0.52, 1.00, 0.76, 0.86, 0.72, 0.66),
      q(0.68, 0.46, 0.42, 0.42, 0.24, 0.48)),
  ]},
  R: { w: 0.88, s: [
    rangkai(q(0.14, 0.00, 0.18, 0.50, 0.24, 0.94),
      q(0.52, 1.00, 0.74, 0.86, 0.70, 0.68),
      q(0.66, 0.50, 0.42, 0.46, 0.26, 0.50)),
    rangkai(q(0.44, 0.48, 0.62, 0.26, 0.84, 0.04)),
  ]},
  S: { w: 0.78, s: [
    rangkai(q(0.76, 0.80, 0.58, 1.00, 0.34, 0.92),
      q(0.14, 0.84, 0.20, 0.62, 0.40, 0.50),
      q(0.62, 0.36, 0.68, 0.20, 0.54, 0.08),
      q(0.36, -0.04, 0.16, 0.06, 0.10, 0.18)),
  ]},
  T: { w: 0.84, s: [
    rangkai(q(0.06, 0.82, 0.36, 0.98, 0.78, 0.88)),
    rangkai(q(0.44, 0.92, 0.40, 0.44, 0.38, 0.12), q(0.42, 0.00, 0.60, 0.04, 0.72, 0.12)),
  ]},
  W: { w: 1.06, s: [
    rangkai(q(0.06, 0.94, 0.14, 0.40, 0.24, 0.04),
      q(0.36, 0.40, 0.42, 0.66, 0.50, 0.86),
      q(0.58, 0.62, 0.64, 0.34, 0.72, 0.04),
      q(0.84, 0.40, 0.92, 0.70, 0.98, 0.94)),
  ]},
  " ": { w: 0.34, s: [] },
  ",": { w: 0.28, s: [rangkai(q(0.16, 0.06, 0.20, 0.00, 0.10, -0.12))] },
  ".": { w: 0.26, s: [q(0.14, 0.03, 0.17, 0.06, 0.20, 0.03, 4)] },
  "'": { w: 0.24, s: [rangkai(q(0.18, 0.72, 0.22, 0.62, 0.12, 0.54))] },
  "&": { w: 0.80, s: [rangkai(q(0.76, 0.02, 0.24, 0.52, 0.28, 0.80),
    q(0.32, 0.98, 0.56, 0.94, 0.54, 0.74),
    q(0.52, 0.50, 0.10, 0.36, 0.14, 0.16),
    q(0.18, -0.02, 0.52, 0.00, 0.78, 0.22))] },
  "-": { w: 0.46, s: [rangkai(q(0.08, 0.28, 0.22, 0.32, 0.38, 0.28))] },
  "@": { w: 0.86, s: [
    rangkai(q(0.66, 0.20, 0.44, 0.12, 0.34, 0.28),
      q(0.26, 0.44, 0.42, 0.58, 0.56, 0.50),
      q(0.66, 0.44, 0.66, 0.24, 0.66, 0.14),
      q(0.72, 0.34, 0.86, 0.42, 0.88, 0.30)),
    rangkai(q(0.88, 0.42, 0.76, 0.82, 0.42, 0.86),
      q(0.08, 0.90, 0.02, 0.40, 0.20, 0.16),
      q(0.36, -0.06, 0.66, -0.02, 0.80, 0.10)),
  ]},
};

const lebar = (ch) => (SKRIP[ch] ? SKRIP[ch].w : 0.6);

function ukurSkrip(teks, tinggi, spasi = 0.02) {
  let w = 0;
  for (const ch of teks) w += (lebar(ch) + spasi) * tinggi;
  return w;
}

/**
 * Gambar teks skrip.
 * @param {object} kanvas { set(x,y,r,g,b,a) }
 * @param {string} teks
 * @param {object} o { x, y(baseline), tinggi, warna, tebal, spasi, align, alpha }
 */
function gambarSkrip(kanvas, teks, o) {
  const tinggi = o.tinggi;
  const spasi = o.spasi == null ? 0.02 : o.spasi;
  const tebal = o.tebal || tinggi * 0.085;
  const [r, g, b] = o.warna || [0, 0, 0];
  const alpha = o.alpha == null ? 255 : o.alpha;

  let x = o.x;
  if (o.align === "center") x = o.x - ukurSkrip(teks, tinggi, spasi) / 2;

  for (const ch of teks) {
    const gl = SKRIP[ch] || SKRIP[ch.toLowerCase()];
    const w = lebar(ch) * tinggi;
    if (gl) {
      for (const goresan of gl.s) {
        for (let i = 0; i < goresan.length - 1; i++) {
          const [ax, ay] = goresan[i];
          const [bx, by] = goresan[i + 1];
          // miringkan: makin tinggi, makin ke kanan
          const x0 = x + ax * w + ay * tinggi * MIRING;
          const y0 = o.y - ay * tinggi;
          const x1 = x + bx * w + by * tinggi * MIRING;
          const y1 = o.y - by * tinggi;
          goresKaligrafi(kanvas, x0, y0, x1, y1, tebal, r, g, b, alpha);
        }
      }
    }
    x += w + spasi * tinggi;
  }
}

/**
 * Goresan dengan tebal berubah-ubah: turun tebal, naik tipis.
 * Inilah yang membuatnya terlihat ditulis dengan pena, bukan digambar komputer.
 */
function goresKaligrafi(k, x0, y0, x1, y1, tebal, r, g, b, a) {
  const dx = x1 - x0, dy = y1 - y0;
  const panjang = Math.max(0.5, Math.hypot(dx, dy));
  const sudut = Math.atan2(dy, dx);
  // pena miring ±40°: goresan tegak lurus arah pena = paling tebal
  const bobot = 0.66 + 0.34 * Math.abs(Math.sin(sudut + 0.7)); // lebih rata, ala Lucida
  const t = tebal * bobot;
  const langkah = Math.ceil(panjang * 3.2);
  for (let i = 0; i <= langkah; i++) {
    const s = i / langkah;
    bulat(k, x0 + dx * s, y0 + dy * s, t, r, g, b, a);
  }
}

function bulat(k, cx, cy, tebal, r, g, b, a) {
  const rad = tebal / 2;
  const r2 = rad * rad;
  for (let y = Math.floor(cy - rad); y <= Math.ceil(cy + rad); y++) {
    for (let x = Math.floor(cx - rad); x <= Math.ceil(cx + rad); x++) {
      if ((x - cx) ** 2 + (y - cy) ** 2 <= r2) k.set(x, y, r, g, b, a);
    }
  }
}

module.exports = { gambarSkrip, ukurSkrip, SKRIP };
