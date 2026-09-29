require("./_setup").pakaiDataSementara();
/**
 * Perlindungan bingkai premium & watermark.
 *
 *   • Desain bingkai premium TIDAK boleh ada di kode yang dikirim ke browser
 *     (kalau ada, DevTools cukup untuk membuat strip premium bersih gratis).
 *   • Pratinjau tanpa kode dibuat server: kecil + watermark.
 *   • Watermark menutupi foto & polanya acak per strip.
 *   • Strip cetak pesanan dibuat server dari foto asli.
 */
process.env.ADMIN_KEY = require("crypto").randomBytes(24).toString("hex");
process.env.SESSION_SECRET = require("crypto").randomBytes(32).toString("hex");

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const http = require("http");
const { createCanvas, loadImage } = require("@napi-rs/canvas");

const { app } = require("../server");
const render = require("../lib/render");
const delivery = require("../lib/delivery");
const codeLib = require("../lib/codes");
const renderer = require("../lib/premium-frames");
const { ERR, ROUTE } = require("../public/shared/contract.js");

const PREMIUM = renderer.FRAMES.filter((f) => f.premium).map((f) => f.id);
const root = path.join(__dirname, "..");

render.init({ info() {}, warn() {} });

let base, srv, ipKe = 0;
const ipBaru = () => `10.9.${Math.floor(++ipKe / 250)}.${ipKe % 250}`;
test.before(async () => {
  srv = http.createServer(app);
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${srv.address().port}`;
});
test.after(() => srv.close());

async function kirim(p, { method = "POST", body, headers = {}, raw } = {}) {
  const res = await fetch(base + p, {
    method,
    headers: { "x-forwarded-for": ipBaru(), "content-type": "application/json", ...headers },
    body: raw !== undefined ? raw : body !== undefined ? JSON.stringify(body) : undefined,
  });
  const buf = Buffer.from(await res.arrayBuffer());
  let data = buf;
  if ((res.headers.get("content-type") || "").includes("json")) data = JSON.parse(buf.toString());
  return { status: res.status, headers: res.headers, data };
}

/** Foto JPEG sungguhan berwarna polos */
function foto(w, h, warna = "#808080") {
  const c = createCanvas(w, h);
  const x = c.getContext("2d");
  x.fillStyle = warna;
  x.fillRect(0, 0, w, h);
  return `data:image/jpeg;base64,${c.toBuffer("image/jpeg", { quality: 0.9 }).toString("base64")}`;
}
const tigaFoto = (w = 400, h = 320) => [foto(w, h), foto(w, h), foto(w, h)];

/** Persentase piksel di kotak foto pertama yang berbeda dari warna dominannya */
async function cacatDiFoto(jpegBuf) {
  const img = await loadImage(jpegBuf);
  const c = createCanvas(img.width, img.height);
  const x = c.getContext("2d");
  x.drawImage(img, 0, 0);
  const skala = img.width / renderer.STRIP_W_MM;
  const L = renderer.LAYOUT_BAWAAN;
  const pw = L.photoWmm * skala, ph = L.photoHmm * skala;
  const x0 = Math.round((img.width - pw) / 2 + 4), y0 = Math.round(L.topMm * skala + 4);
  const d = x.getImageData(x0, y0, Math.round(pw - 8), Math.round(ph - 8)).data;
  const hitung = new Map();
  for (let i = 0; i < d.length; i += 4) {
    const k = `${d[i] >> 3},${d[i + 1] >> 3},${d[i + 2] >> 3}`;
    hitung.set(k, (hitung.get(k) || 0) + 1);
  }
  const dominan = Math.max(...hitung.values());
  return 1 - dominan / (d.length / 4);
}

/* ------------------------- kode browser bersih ------------------------- */

test("premium: desain bingkai premium TIDAK ada di kode yang dikirim ke browser", () => {
  // muat berkas persis seperti browser memuatnya (tanpa lib/premium-frames)
  const kode = fs.readFileSync(path.join(root, "public", "shared", "strip-renderer.js"), "utf8");
  const ctx = { self: {} };
  vm.runInNewContext(kode, ctx);
  const R = ctx.self.StripRenderer;
  assert.ok(R.hasFrame("clover") && R.hasFrame("linen"), "bingkai gratis tetap digambar browser");
  for (const id of PREMIUM) assert.equal(R.hasFrame(id), false, `desain ${id} bocor ke browser`);

  // ciri khas desain premium (warna kelopak Blush, gelombang Mint) tidak ada di public/
  const semua = [];
  const jelajah = (d) => {
    for (const f of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, f.name);
      if (f.isDirectory()) jelajah(p);
      else if (/\.(js|html)$/.test(f.name)) semua.push(fs.readFileSync(p, "utf8"));
    }
  };
  jelajah(path.join(root, "public"));
  const isi = semua.join("\n");
  assert.ok(!isi.includes("rgba(216,140,165"), "desain Blush ada di public/");
  assert.ok(!/registerFrame\(\s*["'](blush|mint|plum)/.test(isi), "desain premium didaftarkan di public/");
});

test("premium: server punya desain SEMUA bingkai di daftar", () => {
  for (const f of renderer.FRAMES) assert.ok(renderer.hasFrame(f.id), f.id);
  // registry tidak bisa dipakai untuk membaca properti bawaan objek
  assert.equal(renderer.hasFrame("__proto__"), false);
  assert.equal(renderer.hasFrame("constructor"), false);
});

/* ------------------------------ watermark ------------------------------ */

test("watermark: menutupi foto (bukan cuma pinggiran) & polanya acak per strip", async () => {
  const img = await loadImage(Buffer.from(foto(400, 320).split(",")[1], "base64"));
  const gambar = (seed, watermark = true) => {
    const W = 360;
    const c = createCanvas(W, Math.ceil(renderer.stripHeight(W)));
    renderer.drawStrip(c.getContext("2d"), [img, img, img], {
      width: W, frameId: "clover", filter: "warna", watermark, watermarkSeed: seed, dateText: "",
    });
    return c.toBuffer("image/png");
  };
  assert.ok(gambar(1).equals(gambar(1)), "benih sama → pola sama");
  assert.ok(!gambar(1).equals(gambar(2)), "benih beda → pola beda (tidak ada pola tetap)");
  assert.ok(await cacatDiFoto(gambar(7)) > 0.12, "watermark harus menutupi area foto");
  assert.ok(await cacatDiFoto(gambar(7, false)) < 0.02, "versi bersih tidak tercoret");
});

/* ------------------------------ pratinjau ------------------------------ */

test("pratinjau: tanpa kode → 360 px, berwatermark; desain premium tetap di server", async () => {
  for (const id of PREMIUM) {
    const r = await kirim(ROUTE.PREVIEW, { body: { photos: tigaFoto(), frameId: id, filter: "warna" } });
    assert.equal(r.status, 200, id);
    assert.equal(r.headers.get("content-type"), "image/jpeg");
    assert.equal(r.headers.get("cache-control"), "no-store");
    const img = await loadImage(r.data);
    assert.equal(img.width, 360, "pratinjau gratis harus kecil (tidak layak cetak)");
    assert.ok(await cacatDiFoto(r.data) > 0.12, `pratinjau ${id} tanpa watermark`);
  }
});

test("pratinjau: dengan kode premium sah → 720 px bersih", async () => {
  const [kode] = codeLib.generate(1, { writeFile: false }).codes;
  const r = await kirim("/api/redeem", { body: { code: kode, deviceId: "hp-pratinjau" } });
  assert.ok(r.data.token);
  const p = await kirim(ROUTE.PREVIEW, {
    headers: { authorization: `Bearer ${r.data.token}` },
    body: { photos: tigaFoto(), frameId: "plum", filter: "warna" },
  });
  assert.equal(p.status, 200);
  assert.equal((await loadImage(p.data)).width, 720);
  assert.ok(await cacatDiFoto(p.data) < 0.02, "pembeli premium melihat versi bersih");
});

test("pratinjau: input aneh ditolak tanpa 500", async () => {
  const bingkai = await kirim(ROUTE.PREVIEW, { body: { photos: tigaFoto(), frameId: "__proto__" } });
  assert.equal(bingkai.status, 400);
  assert.equal(bingkai.data.error, ERR.BAD_FRAME);

  const kurang = await kirim(ROUTE.PREVIEW, { body: { photos: [foto(100, 80)], frameId: "blush" } });
  assert.equal(kurang.status, 400);

  // foto besar tidak boleh lewat jalur tanpa login (decode mahal)
  const besar = await kirim(ROUTE.PREVIEW, { body: { photos: tigaFoto(1200, 900), frameId: "blush" } });
  assert.equal(besar.status, 400);
  assert.equal(besar.data.error, ERR.BAD_PHOTO);

  const palsu = await kirim(ROUTE.PREVIEW, {
    body: { photos: ["data:image/jpeg;base64,PGh0bWw+", foto(10, 10), foto(10, 10)], frameId: "blush" },
  });
  assert.equal(palsu.status, 400);

  // badan kiriman dibatasi (bukan 25 MB seperti unggahan pesanan)
  const raksasa = await kirim(ROUTE.PREVIEW, { raw: JSON.stringify({ x: "a".repeat(700 * 1024) }) });
  assert.equal(raksasa.status, 413);
});

test("thumbnail bingkai premium: gambar dari server, id asing → 404", async () => {
  for (const id of PREMIUM) {
    const r = await kirim(`${ROUTE.FRAME_THUMB}?id=${id}`, { method: "GET", headers: {} });
    assert.equal(r.status, 200);
    assert.equal(r.headers.get("content-type"), "image/png");
    assert.equal((await loadImage(r.data)).width, 104);
  }
  for (const id of ["tidak-ada", "__proto__", ""]) {
    const r = await kirim(`${ROUTE.FRAME_THUMB}?id=${encodeURIComponent(id)}`, { method: "GET", headers: {} });
    assert.equal(r.status, 404, id);
  }
});

/* ------------------------------ pesanan ------------------------------ */

test("pesanan bingkai premium: strip cetak dibuat SERVER dari foto asli", async () => {
  const asliDeliver = delivery.deliver, asliEmail = delivery.emailConfigured;
  let diterima = null;
  delivery.deliver = async (o) => { diterima = o; return { ok: true, results: {}, errors: [] }; };
  delivery.emailConfigured = () => true;
  try {
    const [kode] = codeLib.generate(1, { writeFile: false }).codes;
    const r = await kirim("/api/redeem", { body: { code: kode, deviceId: "hp-pesan" } });
    const res = await kirim(ROUTE.ORDER, {
      headers: { authorization: `Bearer ${r.data.token}` },
      body: {
        consent: true, name: "Uji", email: "uji@contoh.id", address: "Jl. Pengujian No. 1, Jakarta",
        photos: tigaFoto(1280, 1024), frameId: "blush", filter: "warna", dateText: "29 SEP 2026",
        strip: null, // browser tidak bisa menggambar bingkai premium
      },
    });
    assert.equal(res.status, 200, JSON.stringify(res.data));
    assert.ok(diterima, "pesanan tidak diteruskan ke pengiriman");
    assert.match(diterima.strip, /^data:image\/jpeg;base64,/);
    const img = await loadImage(Buffer.from(diterima.strip.split(",")[1], "base64"));
    assert.equal(img.width, 1200, "strip cetak HD dari server");
  } finally {
    delivery.deliver = asliDeliver;
    delivery.emailConfigured = asliEmail;
  }
});
