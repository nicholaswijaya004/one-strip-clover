/**
 * PEMBUAT LEMBAR CETAK A4 (PDF) — TANPA DEPENDENCY
 *
 * Kenapa PDF, bukan JPEG:
 *   1. Ukuran FISIK pasti. PDF menyimpan ukuran dalam milimeter, jadi strip
 *      tercetak tepat 51 x 152 mm apa pun setelan printer. Kalau JPEG, hasilnya
 *      tergantung tafsiran DPI oleh printer — bisa meleset beberapa milimeter
 *      dan potongannya jadi tidak presisi.
 *   2. Tidak butuh pustaka gambar. PDF bisa MENEMPELKAN berkas JPEG apa adanya
 *      (filter DCTDecode) lalu memutar & menempatkannya lewat matriks.
 *      Jadi tidak perlu @napi-rs/canvas — mustahil gagal karena dependency.
 *   3. Printer menangani PDF secara native.
 *
 * Yang dibutuhkan cuma satu: berkas JPEG strip (yang sudah pasti dikirim
 * browser). Server tinggal menempelkannya di kertas A4.
 *
 * Satuan PDF: 1 pt = 1/72 inci. 1 mm = 72/25.4 pt ≈ 2.8346 pt.
 */

const MM = 72 / 25.4;

const A4_W_MM = 210;
const A4_H_MM = 297;

// Ukuran strip photobox klasik (2 x 6 inci)
const STRIP_W_MM = 51;
const STRIP_H_MM = 152;

/** Baca lebar & tinggi JPEG dari penanda SOF-nya */
function jpegSize(buf) {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) {
    throw new Error("bukan berkas JPEG");
  }
  let i = 2;
  while (i < buf.length - 9) {
    if (buf[i] !== 0xff) {
      i++;
      continue;
    }
    const marker = buf[i + 1];
    // SOF0..SOF15, kecuali penanda non-gambar (C4 = DHT, C8, CC)
    if (
      marker >= 0xc0 &&
      marker <= 0xcf &&
      marker !== 0xc4 &&
      marker !== 0xc8 &&
      marker !== 0xcc
    ) {
      return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
    }
    const len = buf.readUInt16BE(i + 2);
    if (len < 2) break;
    i += 2 + len;
  }
  throw new Error("ukuran JPEG tidak terbaca");
}

/**
 * Susun PDF A4 berisi strip yang diputar 90° di bagian atas halaman.
 *
 * @param {Buffer} jpeg  gambar strip (potret, rasio ±1:3)
 * @param {object} opts
 *   copies     berapa strip per halaman (1-4)
 *   marginMm   jarak dari tepi kertas
 *   gapMm      jarak antar strip
 * @returns {Buffer} berkas PDF
 */
function buildA4Pdf(jpeg, opts = {}) {
  const { width: imgW, height: imgH } = jpegSize(jpeg);
  const copies = Math.min(Math.max(Number(opts.copies) || 1, 1), 4);
  // 0 = strip menempel persis di tepi atas kertas.
  // Catatan: hampir semua printer punya area tak-tercetak ±3-5 mm di tepi.
  // Kalau hasil cetakmu terpotong, naikkan A4_MARGIN_MM jadi 3-5.
  const marginMm = opts.marginMm == null ? 0 : opts.marginMm;
  const gapMm = opts.gapMm == null ? 6 : opts.gapMm;

  const pageW = A4_W_MM * MM;
  const pageH = A4_H_MM * MM;

  // Muat strip ke dalam kotak 51 x 152 mm TANPA mengubah proporsinya.
  // Kalau dipaksa pas, wajah orang akan terlihat gepeng.
  const rasioGambar = imgH / imgW;
  const rasioTarget = STRIP_H_MM / STRIP_W_MM;
  let stripWmm = STRIP_W_MM;
  let stripHmm = STRIP_H_MM;
  if (rasioGambar > rasioTarget) stripWmm = STRIP_H_MM / rasioGambar; // lebih jangkung
  else stripHmm = STRIP_W_MM * rasioGambar; // lebih gemuk

  // Setelah diputar 90°: sisi panjang strip terbentang MENDATAR
  const lebarDiKertas = stripHmm * MM; // mendatar
  const tinggiDiKertas = stripWmm * MM; // tegak

  const kiri = (pageW - lebarDiKertas) / 2; // ditengahkan mendatar
  const margin = marginMm * MM;
  const gap = gapMm * MM;

  let isi = "";
  for (let c = 0; c < copies; c++) {
    // PDF berhitung dari KIRI-BAWAH, jadi strip pertama ada di atas
    const atas = pageH - margin - c * (tinggiDiKertas + gap);
    const bawah = atas - tinggiDiKertas;
    if (bawah < 0) break; // jangan keluar kertas

    /* Matriks cm [a b c d e f] memetakan (x,y) → (a·x + c·y + e, b·x + d·y + f)
       Untuk memutar 90° sekaligus menskala kotak satuan gambar:
         a=0, b=tinggiDiKertas, c=-lebarDiKertas, d=0
       Titik (0..1, 0..1) lalu jatuh di:
         x: e-lebarDiKertas .. e     y: f .. f+tinggiDiKertas       */
    isi +=
      `q\n0 ${f(tinggiDiKertas)} ${f(-lebarDiKertas)} 0 ` +
      `${f(kiri + lebarDiKertas)} ${f(bawah)} cm\n/Im0 Do\nQ\n`;
  }

  return rakitPdf(jpeg, imgW, imgH, isi, pageW, pageH);
}

function f(n) {
  return (Math.round(n * 1000) / 1000).toString();
}

function rakitPdf(jpeg, imgW, imgH, isi, pageW, pageH) {
  const objek = [];
  const enc = (s) => Buffer.from(s, "latin1");

  objek[1] = enc("<< /Type /Catalog /Pages 2 0 R >>");
  objek[2] = enc("<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
  objek[3] = enc(
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${f(pageW)} ${f(pageH)}] ` +
      `/Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`
  );
  objek[4] = Buffer.concat([
    enc(
      `<< /Type /XObject /Subtype /Image /Width ${imgW} /Height ${imgH} ` +
        `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode ` +
        `/Length ${jpeg.length} >>\nstream\n`
    ),
    jpeg, // JPEG ditempel apa adanya — tidak di-encode ulang, tidak turun kualitas
    enc("\nendstream"),
  ]);
  objek[5] = enc(`<< /Length ${isi.length} >>\nstream\n${isi}endstream`);

  const bagian = [enc("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n")];
  let posisi = bagian[0].length;
  const offset = [];

  for (let i = 1; i < objek.length; i++) {
    offset[i] = posisi;
    const b = Buffer.concat([enc(`${i} 0 obj\n`), objek[i], enc("\nendobj\n")]);
    bagian.push(b);
    posisi += b.length;
  }

  let xref = `xref\n0 ${objek.length}\n0000000000 65535 f \n`;
  for (let i = 1; i < objek.length; i++) {
    xref += String(offset[i]).padStart(10, "0") + " 00000 n \n";
  }
  xref +=
    `trailer\n<< /Size ${objek.length} /Root 1 0 R >>\n` +
    `startxref\n${posisi}\n%%EOF\n`;
  bagian.push(enc(xref));

  return Buffer.concat(bagian);
}

module.exports = {
  buildA4Pdf,
  jpegSize,
  MM,
  A4_W_MM,
  A4_H_MM,
  STRIP_W_MM,
  STRIP_H_MM,
};
