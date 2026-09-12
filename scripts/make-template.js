/**
 * BUAT CONTOH TEMPLATE STRIP
 *
 *   node scripts/make-template.js               → contoh-template-strip.png
 *   node scripts/make-template.js --warna=blush → varian warna lain
 *
 * Menghasilkan berkas PNG 662 x 2024 px (56,1 x 171,5 mm @ 300 dpi) yang
 * langsung bisa diunggah di /admin untuk menguji fitur template.
 *
 * Kotak fotonya dibuat TRANSPARAN, karena template digambar DI ATAS foto —
 * jadi bagian yang transparan itulah tempat wajah pembeli muncul.
 *
 * PNG ditulis manual dengan zlib bawaan Node (tanpa pustaka gambar), supaya
 * skrip ini jalan di mana saja tanpa dependency tambahan.
 */

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const { gambarTeks, ukurTeks } = require("../lib/vector-font");
const { gambarSkrip, ukurSkrip } = require("../lib/script-font");
const { latarBertekstur } = require("../lib/texture");

// ---- ukuran resmi strip ----
const STRIP_W_MM = 56.1;
const STRIP_H_MM = 171.5;
const DPI = 300;
const W = Math.round((STRIP_W_MM / 25.4) * DPI); // 662
const H = Math.round((STRIP_H_MM / 25.4) * DPI); // 2025

// ---- tata letak kotak foto (mm) — sama dengan bawaan di /admin ----
const L = { photoWmm: 47.7, photoHmm: 38.2, topMm: 24.0, gapMm: 5.0 };
const PX = (mm) => (mm / 25.4) * DPI;

const WARNA = {
  clover: { bg: [246, 242, 228], aksen: [174, 175, 78], garis: [142, 143, 58], teks: [108, 72, 98], mat: [255, 253, 246], tekstur: [174, 175, 78] },
  blush:  { bg: [250, 232, 236], aksen: [206, 130, 156], garis: [108, 72, 98], teks: [108, 72, 98], mat: [255, 252, 250], tekstur: [206, 130, 156] },
  mint:   { bg: [226, 245, 241], aksen: [104, 192, 186], garis: [108, 72, 98], teks: [70, 96, 96], mat: [252, 255, 254], tekstur: [104, 192, 186] },
  plum:   { bg: [96, 64, 88],    aksen: [201, 168, 190], garis: [249, 228, 235], teks: [249, 228, 235], mat: [244, 236, 240], tekstur: [56, 36, 52] },
  langit: { bg: [171, 203, 223], aksen: [255, 255, 255], garis: [255, 255, 255], teks: [255, 255, 255], mat: [253, 251, 244], tekstur: [126, 166, 196] },
};

function ambilArg(nama, bawaan) {
  const a = process.argv.find((x) => x.startsWith(`--${nama}=`));
  return a ? a.split("=").slice(1).join("=") : bawaan;
}

const JUDUL = ambilArg("judul", "One Strip Clover");
const QUOTE = ambilArg("quote", "Collect moments, not things");
const IG = ambilArg("ig", "@onestripclover");
const TEKSTUR = ambilArg("tekstur", "kertas");   // kertas | linen | catair | polos

const arg = process.argv.find((a) => a.startsWith("--warna="));
const namaWarna = (arg ? arg.split("=")[1] : "langit").toLowerCase();
const C = WARNA[namaWarna] || WARNA.langit;

// ---------------------------------------------------------------- kanvas

// RGBA, 4 byte per piksel
const buf = Buffer.alloc(W * H * 4);

function set(x, y, r, g, b, a) {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (y * W + x) * 4;
  buf[i] = r;
  buf[i + 1] = g;
  buf[i + 2] = b;
  buf[i + 3] = a;
}

function kotak(x0, y0, w, h, [r, g, b], a = 255) {
  for (let y = Math.round(y0); y < Math.round(y0 + h); y++) {
    for (let x = Math.round(x0); x < Math.round(x0 + w); x++) set(x, y, r, g, b, a);
  }
}

function bingkai(x0, y0, w, h, tebal, warna, a = 255) {
  kotak(x0, y0, w, tebal, warna, a);
  kotak(x0, y0 + h - tebal, w, tebal, warna, a);
  kotak(x0, y0, tebal, h, warna, a);
  kotak(x0 + w - tebal, y0, tebal, h, warna, a);
}

// 1) latar bertekstur (bukan warna polos — lihat lib/texture.js)
latarBertekstur({ set }, W, H, {
  warna: C.bg,
  aksen: C.tekstur || C.aksen,
  jenis: TEKSTUR,
  kuat: 1,
  benih: 20260901,
});

// 2) kotak foto dibuat TRANSPARAN + diberi bingkai tipis
const pw = PX(L.photoWmm);
const ph = PX(L.photoHmm);
const top = PX(L.topMm);
const gap = PX(L.gapMm);
const x = (W - pw) / 2;
const tebalBingkai = Math.round(PX(1.0)); // 1 mm

// Bingkai foto: mat krem lebar + garis rambut aksen di luarnya.
// Mat memberi jeda visual antara foto dan latar — kesan cetakan studio.
const mat = Math.round(PX(2.0));      // lebar mat krem
const rambut = Math.max(1, Math.round(PX(0.35))); // garis tipis di tepi mat
const KREM = C.mat || [255, 252, 244];

for (let i = 0; i < 3; i++) {
  const y = top + i * (ph + gap);

  // mat krem
  kotak(x - mat, y - mat, pw + mat * 2, ph + mat * 2, KREM);

  // garis rambut aksen mengelilingi mat
  bingkai(x - mat, y - mat, pw + mat * 2, ph + mat * 2, rambut, C.aksen, 200);

  // bayangan tipis di bawah mat → terasa berdimensi
  kotak(x - mat, y + ph + mat, pw + mat * 2, Math.max(1, Math.round(PX(0.5))),
    [0, 0, 0], 26);

  // lubang tembus pandang — di sinilah foto pembeli muncul
  kotak(x, y, pw, ph, [0, 0, 0], 0);
}

// 3) TEKS: judul di atas, quote + akun IG di bawah
const kanvas = { set, W, H };
const bawah = top + ph * 3 + gap * 2;   // awal area teks bawah
const tinggiBawah = H - bawah;

// --- judul (atas) ---
// ukuran huruf dikecilkan otomatis kalau teksnya panjang, supaya tidak terpotong
const lebarMaks = W - PX(9);
// JUDUL pakai huruf sambung — inilah yang memberi kesan tulisan tangan
let hJudul = PX(8.4);
while (ukurSkrip(JUDUL, hJudul, 0.02) > lebarMaks && hJudul > PX(3)) hJudul -= 1;

gambarSkrip(kanvas, JUDUL, {
  x: W / 2, y: top * 0.60 + hJudul * 0.18, tinggi: hJudul,
  warna: C.teks, tebal: Math.max(2.4, hJudul * 0.085), align: "center",
});

// garis tipis di bawah judul
const garisY = Math.round(top * 0.72);
const garisW = Math.min(lebarMaks, ukurTeks(JUDUL, hJudul, 0.26) + PX(6));
kotak((W - garisW) / 2, garisY, garisW, Math.max(1, Math.round(PX(0.35))), C.teks, 150);

// --- quote (bawah) ---
// Strip cuma selebar 56 mm, jadi kalimat panjang DIPECAH jadi beberapa baris
// daripada dikecilkan sampai tidak terbaca saat dicetak.
function pecahBaris(teks, tinggi, spasi, lebarMax) {
  const kata = teks.split(/\s+/);
  const baris = [];
  let kini = "";
  for (const k of kata) {
    const coba = kini ? kini + " " + k : k;
    if (ukurSkrip(coba, tinggi, spasi) <= lebarMax || !kini) kini = coba;
    else { baris.push(kini); kini = k; }
  }
  if (kini) baris.push(kini);
  return baris;
}

// QUOTE juga huruf sambung, ukurannya lebih kecil
const hQuote = PX(4.6);
const barisQuote = pecahBaris(QUOTE, hQuote, 0.02, lebarMaks).slice(0, 2);
const jarakBaris = hQuote * 1.15;
const tinggiBlok = (barisQuote.length - 1) * jarakBaris;
const mulaiQuote = bawah + tinggiBawah * 0.38 - tinggiBlok / 2;

barisQuote.forEach((baris, i) => {
  gambarSkrip(kanvas, baris, {
    x: W / 2, y: mulaiQuote + i * jarakBaris, tinggi: hQuote,
    warna: C.teks, tebal: Math.max(1.8, hQuote * 0.075), align: "center", alpha: 235,
  });
});

// --- akun instagram ---
let hIg = PX(2.9);
while (ukurTeks(IG, hIg, 0.22) > lebarMaks && hIg > PX(1.2)) hIg -= 1;
gambarTeks(kanvas, IG, {
  x: W / 2, y: bawah + tinggiBawah * 0.80, tinggi: hIg,
  warna: C.aksen, tebal: Math.max(1.8, hIg * 0.12), spasi: 0.22, align: "center",
});

// ------------------------------------------------------------------ PNG

function crc32(b) {
  let c, tabel = crc32.tabel;
  if (!tabel) {
    tabel = crc32.tabel = [];
    for (let n = 0; n < 256; n++) {
      c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      tabel[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < b.length; i++) crc = tabel[(crc ^ b[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(tipe, data) {
  const panjang = Buffer.alloc(4);
  panjang.writeUInt32BE(data.length);
  const isi = Buffer.concat([Buffer.from(tipe, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(isi));
  return Buffer.concat([panjang, isi, crc]);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // RGBA
ihdr[10] = 0;
ihdr[11] = 0;
ihdr[12] = 0;

// tiap baris diawali 1 byte penanda filter (0 = tanpa filter)
const baris = Buffer.alloc(H * (W * 4 + 1));
for (let y = 0; y < H; y++) {
  baris[y * (W * 4 + 1)] = 0;
  buf.copy(baris, y * (W * 4 + 1) + 1, y * W * 4, (y + 1) * W * 4);
}

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr),
  chunk("IDAT", zlib.deflateSync(baris, { level: 9 })),
  chunk("IEND", Buffer.alloc(0)),
]);

const keluaran = path.join(
  __dirname, "..", `contoh-template-${namaWarna}-${TEKSTUR}.png`
);
fs.writeFileSync(keluaran, png);

console.log(`\n✅ Template contoh dibuat: ${keluaran}`);
console.log(`   Ukuran : ${W} x ${H} px  (${STRIP_W_MM} x ${STRIP_H_MM} mm @ ${DPI} dpi)`);
console.log(`   Rasio  : 1 : ${(H / W).toFixed(2)}`);
console.log(`   Kotak foto : ${Math.round(pw)} x ${Math.round(ph)} px (transparan)`);
console.log(`   Foto pertama mulai di y = ${Math.round(top)} px\n`);
console.log(`Cara pakai:`);
console.log(`  1. Buka /admin → Template strip → isi nama → Unggah desain`);
console.log(`  2. Muat ulang halaman utama, ambil foto — foto muncul di kotak transparan\n`);
console.log(`Teks yang dipakai:`);
console.log(`  judul : ${JUDUL}`);
console.log(`  quote : ${QUOTE}`);
console.log(`  ig    : ${IG}\n`);
console.log(`Ubah teksnya:`);
console.log(`  npm run template -- --judul="..." --quote="..." --ig="@akunmu"\n`);
console.log(`Mau huruf skrip khas brand? Buka berkas ini di Canva/Figma,`);
console.log(`ganti teksnya, JANGAN menutupi kotak foto, ekspor PNG ${W} x ${H} px.\n`);
console.log(`Varian warna  : --warna=clover | blush | mint | plum | langit`);
console.log(`Varian tekstur: --tekstur=kertas | linen | catair | polos\n`);
