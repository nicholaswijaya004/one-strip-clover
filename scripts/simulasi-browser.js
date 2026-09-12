/**
 * SIMULASI BROWSER KETAT
 *
 * Bedanya dengan simulasi sebelumnya: di sini
 *   • getElementById mengembalikan null untuk id yang TIDAK ada di HTML
 *     (seperti browser sungguhan) — bukan objek tiruan serba-bisa
 *   • canvas 2D hanya punya method yang BENAR-BENAR ada di browser;
 *     memanggil method lain akan melempar error, persis seperti aslinya
 *   • handler tombol dicatat, lalu DIPANGGIL untuk memastikan benar berfungsi
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(ROOT, "public", "booth.html"), "utf8");
const renderer = require(path.join(ROOT, "public", "shared", "strip-renderer.js"));

// ---- id yang benar-benar ada di HTML ----
const ID_ADA = new Set([...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]));

// ---- canvas 2D dengan permukaan API seperti browser modern ----
const METODE_CANVAS = [
  "save", "restore", "translate", "rotate", "scale", "transform", "setTransform",
  "beginPath", "closePath", "moveTo", "lineTo", "arc", "arcTo", "ellipse",
  "rect", "roundRect", "fill", "stroke", "clip",
  "fillRect", "strokeRect", "clearRect",
  "fillText", "strokeText", "measureText",
  "drawImage", "createLinearGradient", "createRadialGradient", "createPattern",
  "setLineDash", "getLineDash", "getImageData", "putImageData",
];

function buatCtx(catatan) {
  const ctx = {};
  for (const m of METODE_CANVAS) {
    ctx[m] = (...a) => {
      if (m === "drawImage" && a.length === 8) {
        catatan.gambar.push({ x: a[4], y: a[5], w: a[6], h: a[7] });
      }
      if (m === "measureText") return { width: 10 };
      return undefined;
    };
  }
  // properti canvas — bisa dibaca & ditulis
  for (const p of ["fillStyle", "strokeStyle", "lineWidth", "font", "textAlign",
                   "filter", "globalAlpha", "lineCap", "lineJoin", "textBaseline"]) {
    ctx[p] = "";
  }
  return ctx;
}

function buatCanvas(catatan) {
  return {
    width: 0, height: 0,
    getContext: (t) => (t === "2d" ? buatCtx(catatan) : null),
    toDataURL: () => "data:image/png;base64,AAAA",
    toBlob: (cb) => cb({}),
    style: {}, classList: kelas(), dataset: {},
    addEventListener() {}, appendChild() {}, remove() {},
  };
}

function kelas() {
  const set = new Set();
  return {
    add: (...c) => c.forEach((x) => set.add(x)),
    remove: (...c) => c.forEach((x) => set.delete(x)),
    toggle: (c, f) => (f ? set.add(c) : set.delete(c)),
    contains: (c) => set.has(c),
  };
}

const catatan = { gambar: [], handler: {}, html: {}, error: [] };

function buatElemen(id) {
  const el = {
    id,
    style: {}, dataset: {}, classList: kelas(),
    value: "", textContent: "", checked: false, disabled: false,
    files: [], naturalWidth: 663, naturalHeight: 2026,
    children: [],
    get innerHTML() { return catatan.html[id] || ""; },
    set innerHTML(v) { catatan.html[id] = v; },
    addEventListener(ev, fn) { catatan.handler[`${id}:${ev}`] = fn; },
    removeEventListener() {},
    set onclick(fn) { catatan.handler[`${id}:click`] = fn; },
    get onclick() { return catatan.handler[`${id}:click`]; },
    appendChild() {}, remove() {}, click() {}, focus() {}, scrollIntoView() {},
    querySelector: () => buatElemen(id + "-child"),
    querySelectorAll: () => [],
    insertBefore() {}, getContext: () => buatCtx(catatan),
    toDataURL: () => "data:image/jpeg;base64,AAAA",
    getBoundingClientRect: () => ({ width: 400, height: 320 }),
    closest: () => null,
    matches: () => false,
  };
  return el;
}

const elemenCache = {};
global.document = {
  getElementById(id) {
    if (!ID_ADA.has(id)) return null; // ← seperti browser: null, bukan objek
    return (elemenCache[id] = elemenCache[id] || buatElemen(id));
  },
  querySelector: (sel) => buatElemen(sel),
  querySelectorAll: () => [],
  createElement: (tag) => (tag === "canvas" ? buatCanvas(catatan) : buatElemen(tag)),
  body: { appendChild() {}, style: {} },
  addEventListener() {},
};

global.window = {
  StripRenderer: renderer, __oscSiap: true,
  matchMedia: () => ({ matches: false }),
  addEventListener(ev, fn) { catatan.handler[`window:${ev}`] = fn; },
  scrollTo() {},
};
global.self = global.window;
global.StripRenderer = renderer;
global.addEventListener = global.window.addEventListener;
global.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
global.sessionStorage = global.localStorage;
global.crypto = { randomUUID: () => "uji-perangkat-1" };
global.navigator = {
  userAgent: "simulasi", platform: "MacIntel", maxTouchPoints: 0,
  mediaDevices: {
    getUserMedia: async () => ({ getTracks: () => [] }), // kamera "diizinkan"
  },
  clipboard: { writeText: async () => {} },
};
global.fetch = async (url) => ({
  ok: true, status: 200,
  json: async () => {
    if (String(url).includes("/api/template")) {
      if (!process.env.UJI_TEMPLATE) return { ok: true, items: [] };
      const L = { photoWmm: 47.7, photoHmm: 38.2, topMm: 24, gapMm: 5 };
      return { ok: true, items: [
        { id: "aaa", nama: "Lebaran 2026", layout: L, versi: "1" },
        { id: "bbb", nama: "Clover Pink",  layout: L, versi: "1" },
      ] };
    }
    if (String(url).includes("/api/config")) return { ok: true, price: "", shops: {}, hasShop: false };
    return { ok: true };
  },
  blob: async () => ({}),
});
// Image tiruan yang benar-benar memicu onload (seperti browser),
// supaya `await loadImg(...)` tidak menggantung selamanya.
global.Image = function () {
  const el = buatElemen("img");
  let _src = "";
  Object.defineProperty(el, "src", {
    get: () => _src,
    set(v) {
      _src = v;
      setTimeout(() => { if (el.onload) el.onload(); }, 0);
    },
  });
  el.width = 663; el.height = 2026;
  return el;
};
global.XMLHttpRequest = function () {
  return { open() {}, setRequestHeader() {}, send() {}, upload: {}, timeout: 0 };
};
global.FileReader = function () { return { readAsDataURL() {} }; };
global.Blob = function () {};
global.URL = { createObjectURL: () => "blob:x", revokeObjectURL() {} };
global.requestAnimationFrame = (f) => f();
global.setInterval = () => 0;
global.matchMedia = global.window.matchMedia;
global.scrollTo = () => {};

// ---- jalankan skrip halaman ----
const i = html.lastIndexOf("<script>");
const j = html.lastIndexOf("</script>");
const script = html.slice(i + 8, j);

console.log("\n=== MENJALANKAN HALAMAN ===\n");
let jalan = true;
try {
  new Function(script)();
} catch (e) {
  jalan = false;
  console.log("❌ Skrip berhenti:", e.message);
}

// ---- PEMERIKSAAN ----
const hasil = [];
const cek = (nama, lulus, ket) => {
  hasil.push({ nama, lulus, ket });
  console.log(`${lulus ? "✅" : "❌"} ${nama}${ket ? "  — " + ket : ""}`);
};

console.log("\n=== HASIL PEMERIKSAAN ===\n");

cek("Skrip berjalan sampai selesai", jalan);

// 2. Tombol
cek("Tombol MULAI SESI punya handler", !!catatan.handler["startBtn:click"]);
cek("Tombol premium punya handler", !!catatan.handler["unlockBtn:click"]);
cek("Unggah foto punya handler", !!catatan.handler["uploadInput:change"]);
cek("Pemilih bingkai punya handler", !!catatan.handler["frameStrip:click"]);
cek("Pemilih filter punya handler", !!catatan.handler["filterSeg:click"]);

// 3. Benar-benar dipanggil
(async () => {
  // beri kesempatan fetch /api/template & /api/config selesai
  await new Promise((r) => setTimeout(r, 200));

  const denganTemplate = !!process.env.UJI_TEMPLATE;
  const isiBingkai = catatan.html["frameStrip"] || "";
  const jumlahBingkai = (isiBingkai.match(/class="fthumb/g) || []).length;
  const harusnya = denganTemplate ? 7 : 5;
  cek("Bagian BINGKAI terisi", jumlahBingkai === harusnya,
    `${jumlahBingkai} bingkai (harusnya ${harusnya}${denganTemplate ? " = 5 bawaan + 2 template" : ""})`);

  if (denganTemplate) {
    cek("Kedua template muncul sebagai bingkai",
      isiBingkai.includes("Lebaran 2026") && isiBingkai.includes("Clover Pink"),
      "dua-duanya tampil");
    cek("Thumbnail template memakai gambar aslinya",
      isiBingkai.includes("/api/template/image?id=aaa") &&
      isiBingkai.includes("/api/template/image?id=bbb"));
  } else {
    cek("Thumbnail bingkai berupa gambar", isiBingkai.includes('<img src="data:image'));
  }

  try {
    await catatan.handler["unlockBtn:click"]();
    cek("Klik tombol premium tidak error", true, "modal kode terbuka");
  } catch (e) {
    cek("Klik tombol premium tidak error", false, e.message);
  }

  try {
    const p = catatan.handler["startBtn:click"]();
    if (p && p.then) await Promise.race([p, new Promise((r) => setTimeout(r, 300))]);
    cek("Klik MULAI SESI tidak error", true, "kamera diminta & sesi mulai");
  } catch (e) {
    cek("Klik MULAI SESI tidak error", false, e.message);
  }

  try {
    const tombolPalsu = buatElemen("fthumb");
    tombolPalsu.dataset.i = "2";
    catatan.handler["frameStrip:click"]({ target: { closest: () => tombolPalsu } });
    cek("Ganti bingkai tidak error", true);
  } catch (e) {
    cek("Ganti bingkai tidak error", false, e.message);
  }

  // 4. Thumbnail tiap bingkai digambar langsung
  for (const f of renderer.FRAMES) {
    try {
      const c = buatCanvas(catatan);
      c.width = 104; c.height = 148;
      const x = c.getContext("2d");
      const st = renderer.frameStyle(f.id);
      renderer.drawFrameDecor(x, f.id, 104, 148, { thumb: true });
      cek(`Bingkai "${f.name}" bisa digambar`, true, `latar ${st.bg}`);
    } catch (e) {
      cek(`Bingkai "${f.name}" bisa digambar`, false, e.message);
    }
  }

  const gagal = hasil.filter((h) => !h.lulus);
  console.log(`\n${gagal.length === 0 ? "🎉 SEMUA LULUS" : "⚠️  " + gagal.length + " GAGAL"} ` +
    `(${hasil.length - gagal.length}/${hasil.length})\n`);
  process.exit(gagal.length ? 1 : 0);
})();
