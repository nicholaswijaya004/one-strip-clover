/**
 * PUSTAKA TEMPLATE STRIP
 *
 * Sebelumnya hanya boleh ada SATU template — mengunggah yang baru diam-diam
 * menimpa yang lama. Membingungkan kalau kamu punya beberapa desain
 * (Lebaran, Natal, pesanan klien).
 *
 * Sekarang: banyak template disimpan sekaligus. Semuanya muncul sebagai
 * pilihan bingkai di halaman utama, dan bisa dihapus satu per satu dari
 * galeri di /admin.
 *
 * Tiap template punya tata letak kotak fotonya SENDIRI — desain berbeda
 * boleh menaruh foto di posisi berbeda.
 *
 * Gambar disimpan di data/template/ (ikut volume), daftarnya di meta.json.
 * Tidak butuh database: ini puluhan berkas, bukan jutaan baris.
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { createJsonStore } = require("./store");

const { TEMPLATE_DIR: DIR } = require("./paths");
const META = path.join(DIR, "meta.json");
const store = createJsonStore(META);

const STRIP_W_MM = 56.1;
const STRIP_H_MM = 171.5;

const LAYOUT_BAWAAN = { photoWmm: 47.7, photoHmm: 38.2, topMm: 24.0, gapMm: 5.0 };

const BATAS = {
  photoWmm: [10, STRIP_W_MM],
  photoHmm: [10, 80],
  topMm: [0, 120],
  gapMm: [0, 40],
};

const MAKS_TEMPLATE = 20; // cegah disk penuh tanpa sadar

function pastikanFolder() {
  if (!fs.existsSync(DIR)) fs.mkdirSync(DIR, { recursive: true });
}

function batasi(kunci, nilai) {
  const b = BATAS[kunci];
  const n = Number(nilai);
  if (!b || !Number.isFinite(n)) return LAYOUT_BAWAAN[kunci];
  return Math.min(Math.max(n, b[0]), b[1]);
}

function bersihkanNama(v) {
  return String(v == null ? "" : v)
    .replace(/[<>\r\n\t]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
}

function periksaMuat(layout) {
  const L = { ...LAYOUT_BAWAAN, ...(layout || {}) };
  const total = L.topMm + L.photoHmm * 3 + L.gapMm * 2;
  return {
    muat: total <= STRIP_H_MM && L.photoWmm <= STRIP_W_MM,
    sisaBawahMm: Number((STRIP_H_MM - total).toFixed(2)),
    marginSampingMm: Number(((STRIP_W_MM - L.photoWmm) / 2).toFixed(2)),
  };
}

function normalkanLayout(l) {
  const out = {};
  for (const k of Object.keys(LAYOUT_BAWAAN)) {
    out[k] = l && l[k] != null ? batasi(k, l[k]) : LAYOUT_BAWAAN[k];
  }
  return out;
}

function bacaMentah() {
  try {
    return store.read() || {};
  } catch {
    return {};
  }
}

/** Semua template. Termasuk migrasi dari format lama (satu template). */
function daftar() {
  const m = bacaMentah();

  if (!Array.isArray(m.templates) && m.file) {
    return [
      {
        id: "lama",
        nama: m.nama || "Template",
        file: m.file,
        mime: m.mime || "image/png",
        lebarPx: m.lebarPx || null,
        tinggiPx: m.tinggiPx || null,
        diunggahPada: m.diunggahPada || null,
        layout: normalkanLayout(m.layout),
        ...periksaMuat(normalkanLayout(m.layout)),
      },
    ].filter((t) => fs.existsSync(path.join(DIR, t.file)));
  }

  return (m.templates || [])
    .filter((t) => t && t.file && fs.existsSync(path.join(DIR, t.file)))
    .map((t) => ({
      id: t.id,
      nama: t.nama || "Template",
      file: t.file,
      mime: t.mime || "image/png",
      lebarPx: t.lebarPx || null,
      tinggiPx: t.tinggiPx || null,
      diunggahPada: t.diunggahPada || null,
      layout: normalkanLayout(t.layout),
      ...periksaMuat(normalkanLayout(t.layout)),
    }));
}

/** Info lengkap untuk /admin */
function meta() {
  const list = daftar().map((t) => ({ ...t, ...periksaMuat(t.layout) }));
  return {
    jumlah: list.length,
    maks: MAKS_TEMPLATE,
    templates: list,
    ukuran: { stripWmm: STRIP_W_MM, stripHmm: STRIP_H_MM },
    layoutBawaan: LAYOUT_BAWAAN,
  };
}

/** Info ringkas untuk halaman utama */
function publik() {
  return daftar().map((t) => ({
    id: t.id,
    nama: t.nama,
    layout: t.layout,
    versi: t.diunggahPada || t.id,
  }));
}

function cari(id) {
  return daftar().find((t) => t.id === String(id)) || null;
}

function berkas(id) {
  const t = cari(id);
  if (!t) return null;
  try {
    return { buffer: fs.readFileSync(path.join(DIR, t.file)), mime: t.mime };
  } catch {
    return null;
  }
}

/** Tambah template baru — TIDAK menimpa yang sudah ada */
async function tambah(buffer, mime, ukuranPx = {}, nama = "") {
  pastikanFolder();
  const sebelumnya = daftar();
  if (sebelumnya.length >= MAKS_TEMPLATE) {
    throw new Error(`maksimal ${MAKS_TEMPLATE} template — hapus yang lama dulu`);
  }

  const id = "t" + Date.now().toString(36) + crypto.randomBytes(3).toString("hex");
  const ext = mime === "image/jpeg" ? "jpg" : "png";
  const namaBerkas = `${id}.${ext}`;

  // tulis berkas dulu, baru catat — meta tidak pernah menunjuk berkas hantu
  fs.writeFileSync(path.join(DIR, namaBerkas), buffer);

  await store.update((d) => {
    d.templates = [
      ...sebelumnya.map((t) => ({ ...t })),
      {
        id,
        nama: bersihkanNama(nama) || "Template " + (sebelumnya.length + 1),
        file: namaBerkas,
        mime,
        lebarPx: ukuranPx.lebarPx || null,
        tinggiPx: ukuranPx.tinggiPx || null,
        diunggahPada: new Date().toISOString(),
        layout: { ...LAYOUT_BAWAAN },
      },
    ];
    delete d.file; delete d.nama; delete d.mime; delete d.layout;
  });
  return cari(id);
}

/** Hapus satu template berdasarkan id */
async function hapus(id) {
  const t = cari(id);
  const sisa = daftar().filter((x) => x.id !== String(id));

  await store.update((d) => {
    d.templates = sisa.map((x) => ({ ...x }));
    delete d.file; delete d.nama; delete d.mime; delete d.layout;
  });

  if (t) {
    try {
      fs.unlinkSync(path.join(DIR, t.file));
    } catch {
      /* berkas sudah hilang — tidak masalah */
    }
  }
  return meta();
}

async function aturLayout(id, perubahan) {
  const list = daftar();
  await store.update((d) => {
    d.templates = list.map((t) =>
      t.id === String(id)
        ? { ...t, layout: normalkanLayout({ ...t.layout, ...(perubahan || {}) }) }
        : { ...t }
    );
  });
  return meta();
}

/** Ubah nama dan/atau layout satu template sekaligus (dipakai /admin) */
async function ubah(id, perubahan = {}) {
  if (perubahan.nama != null) await ubahNama(id, perubahan.nama);
  if (perubahan.layout) await aturLayout(id, perubahan.layout);
  return cari(id);
}

async function ubahNama(id, nama) {
  const list = daftar();
  await store.update((d) => {
    d.templates = list.map((t) =>
      t.id === String(id) ? { ...t, nama: bersihkanNama(nama) || t.nama } : { ...t }
    );
  });
  return meta();
}

module.exports = {
  meta, publik, daftar, cari, berkas,
  tambah, hapus, aturLayout, ubahNama, ubah,
  periksaMuat, batasi, bersihkanNama, normalkanLayout,
  LAYOUT_BAWAAN, STRIP_W_MM, STRIP_H_MM, MAKS_TEMPLATE, DIR,
};
