/**
 * TEKSTUR LATAR
 *
 * Warna polos terlihat "dicetak komputer". Kertas sungguhan punya serat,
 * bercak tinta, dan tepi yang sedikit lebih gelap. Modul ini menirunya
 * dengan perhitungan piksel — tanpa pustaka gambar apa pun.
 *
 * Lapisan yang ditumpuk (urutannya penting):
 *   1. GRADASI   — warna tidak rata sempurna, ada sisi lebih terang
 *   2. BERCAK    — noda lembut seperti cat air / serat kertas daur ulang
 *   3. SERAT     — anyaman halus seperti kain linen atau kertas art paper
 *   4. BUTIRAN   — bintik acak sangat halus, memberi kesan "tercetak"
 *   5. VIGNETTE  — tepi sedikit lebih gelap, membuat strip terasa berdimensi
 *
 * Semua memakai acak BER-BENIH: template yang sama akan selalu menghasilkan
 * tekstur yang sama persis, jadi hasil cetakmu bisa diulang.
 */

/** Acak sederhana ber-benih (mulberry32) — cepat & konsisten */
function acak(benih) {
  let a = benih >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Noise nilai 2D — dasar untuk bercak organik */
function buatNoise(benih, kisi) {
  const r = acak(benih);
  const titik = [];
  for (let y = 0; y <= kisi; y++) {
    titik[y] = [];
    for (let x = 0; x <= kisi; x++) titik[y][x] = r();
  }
  const halus = (t) => t * t * (3 - 2 * t); // smoothstep

  return function (u, v) {
    const x = u * kisi, y = v * kisi;
    const x0 = Math.min(kisi, Math.floor(x)), y0 = Math.min(kisi, Math.floor(y));
    const x1 = Math.min(kisi, x0 + 1), y1 = Math.min(kisi, y0 + 1);
    const fx = halus(x - x0), fy = halus(y - y0);
    const a = titik[y0][x0], b = titik[y0][x1];
    const c = titik[y1][x0], d = titik[y1][x1];
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
  };
}

const jepit = (v) => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v));

/**
 * Isi seluruh kanvas dengan latar bertekstur.
 *
 * @param {object} kanvas { set(x,y,r,g,b,a) }
 * @param {number} W lebar
 * @param {number} H tinggi
 * @param {object} o
 *   warna    [r,g,b] warna dasar
 *   aksen    [r,g,b] warna bercak (opsional; default versi lebih gelap)
 *   jenis    "kertas" | "linen" | "catair" | "polos"
 *   kuat     0..1 seberapa kuat teksturnya (default 1)
 *   benih    angka, agar hasilnya bisa diulang
 */
function latarBertekstur(kanvas, W, H, o) {
  const jenis = o.jenis || "kertas";
  const kuat = o.kuat == null ? 1 : o.kuat;
  const benih = o.benih || 12345;
  const [br, bg, bb] = o.warna;
  const aksen = o.aksen || [br * 0.86, bg * 0.86, bb * 0.86];

  const r = acak(benih);
  // Kisi rapat = serat halus. Kisi renggang menghasilkan bercak besar yang
  // justru terlihat seperti noda, bukan kertas.
  const bercakBesar = buatNoise(benih + 1, 14);
  const bercakKecil = buatNoise(benih + 2, 70);

  const gelapTepi = jenis === "polos" ? 0 : 0.11 * kuat; // vignette

  for (let y = 0; y < H; y++) {
    const v = y / H;
    for (let x = 0; x < W; x++) {
      const u = x / W;

      // 1) gradasi lembut diagonal
      let f = 1 + (0.06 * kuat) * (0.5 - (u * 0.35 + v * 0.65));

      let R = br * f, G = bg * f, B = bb * f;

      if (jenis !== "polos") {
        // 2) bercak organik — campur sedikit warna aksen
        const n = bercakBesar(u, v) * 0.4 + bercakKecil(u, v) * 0.6;
        const campur = (n - 0.5) * 0.13 * kuat;
        if (campur > 0) {
          R += (aksen[0] - R) * campur;
          G += (aksen[1] - G) * campur;
          B += (aksen[2] - B) * campur;
        } else {
          R -= (R - 255) * campur * 0.5;
          G -= (G - 255) * campur * 0.5;
          B -= (B - 255) * campur * 0.5;
        }
      }

      // 3) serat/anyaman
      if (jenis === "linen") {
        const anyam =
          Math.sin(x * 0.9) * 0.5 + Math.sin(y * 0.9) * 0.5 +
          Math.sin((x + y) * 0.45) * 0.3;
        const t = anyam * 4.5 * kuat;
        R += t; G += t; B += t;
      } else if (jenis === "kertas") {
        const serat = Math.sin(y * 0.55 + Math.sin(x * 0.12) * 2) * 3.2 * kuat;
        R += serat; G += serat; B += serat;
      } else if (jenis === "catair") {
        // gradasi lembut seperti cat air yang meresap — tanpa tepi keras
        const n = bercakBesar(u * 0.8, v * 0.8);
        const t = (n - 0.5) * 9 * kuat;
        R += t; G += t; B += t;
      }

      // 4) butiran halus
      const butir = (r() - 0.5) * 8 * kuat;
      R += butir; G += butir; B += butir;

      // 5) vignette
      if (gelapTepi > 0) {
        const dx = Math.abs(u - 0.5) * 2, dy = Math.abs(v - 0.5) * 2;
        const jarak = Math.max(dx, dy * 0.55);
        const gelap = 1 - gelapTepi * Math.pow(jarak, 3);
        R *= gelap; G *= gelap; B *= gelap;
      }

      kanvas.set(x, y, jepit(R), jepit(G), jepit(B), 255);
    }
  }
}

module.exports = { latarBertekstur, acak, buatNoise };
