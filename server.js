/**
 * ONE STRIP CLOVER — backend
 * - Serves the photobooth frontend (public/)
 * - POST /api/redeem          : validates & burns a single-use access code (data/codes.json)
 * - POST /api/fallback-upload : receives user photos, emails them to the studio
 *                               and (optionally) uploads them to Google Drive
 *
 * No database server needed: codes live in data/codes.json.
 * If you outgrow this (thousands of codes/day), swap the file store for SQLite
 * or Supabase — the functions loadCodes()/saveCodes() are the only place to change.
 */

// --- cek versi Node ---
const _major = Number(process.versions.node.split(".")[0]);
// Node 18 & 20 sudah end-of-life (tidak dapat patch keamanan lagi).
// googleapis (unggah Drive) juga mensyaratkan Node 22+.
if (_major < 22) {
  console.error(
    `\n❌ Node.js kamu versi ${process.versions.node}, terlalu lama.\n` +
      `   Butuh Node 22 atau lebih baru (LTS).\n\n` +
      `   Cara update di Mac:\n` +
      `     1. Download installer LTS dari https://nodejs.org  (paling gampang), ATAU\n` +
      `     2. brew install node   (kalau pakai Homebrew), ATAU\n` +
      `     3. nvm install 22 && nvm use 22   (kalau pakai nvm)\n\n` +
      `   Setelah update, jalankan ulang:\n` +
      `     rm -rf node_modules package-lock.json\n` +
      `     npm install\n`
  );
  process.exit(1);
}

require("dotenv").config();
const express = require("express");
const path = require("path");
const crypto = require("crypto");
const log = require("./lib/logger");
const codeLib = require("./lib/codes");
const { createTokens } = require("./lib/tokens");
const fmt = require("./lib/format");
const { evaluateRedemption, STATUS: REDEEM } = require("./lib/redeem");
const { buildPublicConfig } = require("./lib/config");
const { ERR, HTTP, LIMIT, ROUTE } = require("./public/shared/contract.js");
const { createLocks } = require("./lib/locks");
const { createLimiter } = require("./lib/limiter");
const { parseImageDataUrl, MIME } = require("./lib/images");
const envCheck = require("./lib/env");
const { registerAdminRoutes } = require("./lib/http/admin-routes");
const queue = require("./lib/queue");
const delivery = require("./lib/delivery");
const render = require("./lib/render");
const settings = require("./lib/settings");
const template = require("./lib/template");

/* ------------------------- periksa konfigurasi -------------------------
 * Produksi (NODE_ENV=production) MENOLAK hidup dengan rahasia kosong/lemah.
 * Lihat lib/env.js untuk alasannya.
 */
const cekEnv = envCheck.checkConfig(process.env);
for (const w of cekEnv.warnings) console.warn(`⚠️  ${w}`);
if (cekEnv.errors.length) {
  console.error("\n❌ Konfigurasi produksi tidak aman — server TIDAK dinyalakan:");
  for (const e of cekEnv.errors) console.error(`   • ${e}`);
  console.error("   Perbaiki environment variable di atas lalu deploy ulang.\n");
  process.exit(1);
}

// Satu kode = satu pesanan diproses pada satu waktu (lihat lib/locks.js)
const orderLocks = createLocks();
// Render kanvas HD itu berat: batasi yang jalan BERSAMAAN (lihat lib/limiter.js)
const renderSlots = createLimiter(LIMIT.RENDER_PARALEL);

const app = express();
const PORT = process.env.PORT || 3000;

// Jangan umumkan "X-Powered-By: Express" — memudahkan penyerang memilih eksploit
app.disable("x-powered-by");

// Di belakang proxy (Railway/Render) supaya req.ip = IP asli pengunjung.
// TRUST_PROXY=false kalau server langsung menghadap internet — lihat lib/env.js
app.set("trust proxy", envCheck.parseTrustProxy(process.env.TRUST_PROXY));

/* ----------------------------- middleware -----------------------------
 * Isinya ada di lib/http/middleware.js. server.js hanya MERANGKAI —
 * aturan keamanan & pembatasan laju bukan tanggung jawab berkas ini.
 */
const mw = require("./lib/http/middleware");

const limitStore = mw.limitStore;
const rateLimit = (opsi) => mw.rateLimit(opsi, log);

app.use(mw.requestLog(log));
app.use(mw.securityHeaders());
app.use(mw.staticFiles(path.join(__dirname, "public")));

// Rute berbadan besar: rate limit + otorisasi (dari HEADER) + jatah paralel
// diperiksa SEBELUM body 25 MB di-parse. Lihat largeBodyGate().
// Fungsi otorisasi dideklarasikan di bawah (hoisting function declaration).
app.use(
  mw.largeBodyGate(
    {
      [ROUTE.ORDER]: {
        authorize: (req) => verifyToken(bearerToken(req)),
        rate: { windowMs: LIMIT.UPLOAD_WINDOW_MS, max: LIMIT.UPLOAD_MAKS, key: "upload" },
      },
      [ROUTE.RENDER]: {
        authorize: (req) => verifyToken(bearerToken(req)),
        rate: { windowMs: LIMIT.UPLOAD_WINDOW_MS, max: LIMIT.RENDER_IP_MAKS, key: "render-ip" },
      },
      [ROUTE.ADMIN_TEMPLATE]: {
        authorize: (req) => adminOk(req),
        rate: { windowMs: LIMIT.ADMIN_WINDOW_MS, max: LIMIT.ADMIN_MAKS, key: "admin-gate" },
        status: HTTP.UNAUTHORIZED,
        error: ERR.UNAUTHORIZED,
      },
    },
    { log }
  )
);
app.use(mw.bodyParsers());

/* ------------------------------ halaman ------------------------------
 *   /        → halaman pembuka (penjelasan + tombol Masuk)
 *   /booth   → photobox-nya sendiri
 *   /admin   → panel admin (dilindungi ADMIN_KEY di halamannya)
 * Dipisah supaya pengunjung tahu dulu ini apa sebelum kameranya menyala —
 * meminta izin kamera di detik pertama membuat orang kabur.
 */
app.get("/", (req, res) =>
  res.sendFile(path.join(__dirname, "public", "index.html"))
);

app.get("/booth", (req, res) =>
  res.sendFile(path.join(__dirname, "public", "booth.html"))
);

app.get("/admin", (req, res) =>
  res.sendFile(path.join(__dirname, "public", "admin.html"))
);

/* ---------------------------- code store ---------------------------- */

// Baca/tulis lewat lib/codes.js yang memakai penyimpanan atomik & terantre.
// Jangan menulis codes.json langsung dengan fs — itu penyebab data hilang
// saat dua permintaan datang bersamaan.
const loadCodes = () => codeLib.load();
const saveCodes = (codes) => codeLib.save(codes);

// Kunci diambil dari input pengguna → jangan sampai "__proto__"/"constructor"
// menyentuh prototipe objek. Hanya properti MILIK objek yang dihitung.
const cariKode = (codes, kode) =>
  Object.prototype.hasOwnProperty.call(codes, kode) ? codes[kode] : undefined;

/* ------------------------- premium sessions -------------------------
 * Token ditandatangani (HMAC), jadi tidak perlu disimpan di memori dan
 * tetap sah walau server restart — pembeli yang sudah bayar tidak
 * kehilangan akses saat kamu deploy ulang.
 */
const SESSION_HOURS = Number(process.env.SESSION_HOURS || 3);
// TIDAK lagi jatuh ke ADMIN_KEY: satu rahasia untuk dua tugas berarti satu
// kebocoran membuka keduanya. Di luar produksi: acak tiap start (lib/env.js).
const SESSION_SECRET = cekEnv.sessionSecret;

const tokens = createTokens({ secret: SESSION_SECRET, hours: SESSION_HOURS });
const makeToken = (code) => tokens.make(code);
const verifyToken = (t) => tokens.verify(t);

/**
 * Token premium untuk rute berbadan besar dikirim lewat HEADER
 * (Authorization: Bearer …), supaya bisa diperiksa sebelum body di-parse.
 */
function bearerToken(req) {
  const h = String(req.get("authorization") || "");
  return h.toLowerCase().startsWith("bearer ") ? h.slice(7).trim() : "";
}

/** Jatah pesanan efektif — SELALU dari setelan (bisa diubah di /admin) */
const maxSubmissions = () => settings.get("maxStudioSubmissions");

/* ---------------------------- /api/redeem ---------------------------- */

// Anti tebak-kode: HANYA percobaan yang GAGAL yang dihitung.
// Penukaran yang berhasil tidak memakan jatah, supaya pembeli sah di balik
// IP yang sama (WiFi kafe / CGNAT operator) tidak saling memblokir.
const REDEEM_WINDOW_MS = LIMIT.REDEEM_WINDOW_MS;
const REDEEM_MAX_GAGAL = LIMIT.REDEEM_MAKS_GAGAL;

app.post("/api/redeem", (req, res) => {
  const limitKey = `redeem-fail:${mw.clientKey(req.ip)}`;
  const izin = limitStore.check(limitKey, REDEEM_WINDOW_MS, REDEEM_MAX_GAGAL);
  if (!izin.allowed) {
    log.warn("redeem.ratelimit", { rid: req.rid, ip: req.ip, retryAfter: izin.retryAfter });
    res.setHeader("Retry-After", izin.retryAfter);
    return res
      .status(HTTP.TOO_MANY_REQUESTS)
      .json({ ok: false, error: ERR.TOO_MANY_REQUESTS, retryAfter: izin.retryAfter });
  }
  const catatGagal = () => limitStore.penalize(limitKey, REDEEM_WINDOW_MS, REDEEM_MAX_GAGAL);
  {
  // Tipe dicek: body {code:{}} dulu melempar TypeError → 500
  const masukan = req.body && req.body.code;
  const raw = typeof masukan === "string" ? masukan.trim().toUpperCase() : "";
  if (!raw || raw.length > LIMIT.KODE_INPUT) {
    catatGagal();
    return res.status(HTTP.BAD_REQUEST).json({ ok: false, error: ERR.EMPTY });
  }

  const codes = loadCodes();
  const entry = cariKode(codes, raw);
  // ID perangkat dibuat & disimpan oleh browser pembeli (bukan data pribadi,
  // hanya angka acak). Dipakai untuk mengikat kode ke satu perangkat.
  const idMasuk = req.body && req.body.deviceId;
  let deviceId = typeof idMasuk === "string" ? idMasuk.slice(0, LIMIT.DEVICE_ID) || null : null;

  // Kalau browser tidak mengirim ID (penyimpanan diblokir / permintaan dipalsukan),
  // server membuatkan ID dari sidik jaringan+peramban. Kualitasnya lebih rendah,
  // TAPI jangan sampai kodenya jadi tidak terikat sama sekali — itu justru
  // membuat kode bisa dipakai siapa pun. Lebih baik terikat kasar daripada bebas.
  if (!deviceId) {
    deviceId =
      "auto-" +
      crypto
        .createHash("sha256")
        .update(`${req.ip}|${req.get("user-agent") || ""}|${SESSION_SECRET}`)
        .digest("hex")
        .slice(0, 24);
    log.info("redeem.device_auto", { rid: req.rid, hint: "browser tidak mengirim deviceId" });
  }

  // Setelan dibaca saat permintaan datang, bukan saat server start —
  // supaya perubahan dari /admin langsung berlaku tanpa restart.
  const setelan = settings.all();
  const verdict = evaluateRedemption(entry, {
    graceMs: setelan.redeemGraceHours * 3600 * 1000,
    maxSubmissions: setelan.maxStudioSubmissions,
    deviceId,
    maxDevices: setelan.maxDevicesPerCode,
  });

  if (verdict.status === REDEEM.INVALID) {
    catatGagal(); // kode ngawur = indikasi penebakan
    log.warn("redeem.invalid", { rid: req.rid, code: raw, ip: req.ip });
    return res.status(HTTP.NOT_FOUND).json({ ok: false, error: ERR.INVALID });
  }

  // Sudah pernah ditukar, tapi masih dalam masa tenggang → pulihkan sesinya.
  // Ini BUKAN akses baru: jatah pesanan studio tetap dihitung per kode.
  if (verdict.status === REDEEM.REENTRY) {
    entry.reentries = (entry.reentries || 0) + 1;
    entry.lastReentryAt = new Date().toISOString();
    if (deviceId) {
      entry.devices = Array.isArray(entry.devices) ? entry.devices : [];
      if (!entry.devices.includes(deviceId)) entry.devices.push(deviceId);
    }
    saveCodes(codes);
    log.info("redeem.reentry", {
      rid: req.rid, code: raw, ip: req.ip,
      ke: entry.reentries,
      submissions: entry.submissions || 0,
    });
    return res.json({
      ok: true,
      token: makeToken(raw),
      hours: SESSION_HOURS,
      reentry: true,
      submissions: entry.submissions || 0,
      maxSubmissions: setelan.maxStudioSubmissions,
    });
  }

  // Kode dipakai di perangkat lain → kemungkinan besar kodenya dibagikan
  if (verdict.status === REDEEM.OTHER_DEVICE) {
    catatGagal();
    log.warn("redeem.other_device", {
      rid: req.rid, code: raw, ip: req.ip,
      hint: "kode kemungkinan dibagikan ke orang lain",
    });
    return res.status(HTTP.CONFLICT).json({ ok: false, error: ERR.OTHER_DEVICE });
  }

  if (verdict.status === REDEEM.SPENT) {
    catatGagal();
    log.warn("redeem.spent", {
      rid: req.rid, code: raw, ip: req.ip, ref: verdict.ref,
    });
    return res.status(HTTP.CONFLICT).json({
      ok: false,
      error: ERR.SPENT,
      ref: verdict.ref || null,
    });
  }

  if (verdict.status === REDEEM.USED) {
    catatGagal();
    log.warn("redeem.expired", {
      rid: req.rid, code: raw, ip: req.ip,
      usedAt: entry.usedAt, graceHours: setelan.redeemGraceHours,
    });
    return res.status(HTTP.CONFLICT)
      .json({ ok: false, error: ERR.USED, graceHours: setelan.redeemGraceHours });
  }

  entry.used = true;
  entry.usedAt = new Date().toISOString();
  // Penukaran pertama = perangkat ini mengklaim kode
  entry.devices = [deviceId]; // selalu terisi — lihat catatan di atas
  saveCodes(codes);

  limitStore.reset(limitKey); // berhasil = jelas bukan penebak
  log.order("redeem.ok", { rid: req.rid, code: raw, ip: req.ip });
  res.json({ ok: true, token: makeToken(raw), hours: SESSION_HOURS });
  }
});

// Cek apakah token premium masih sah (mis. setelah halaman di-reload)
app.post("/api/session", (req, res) => {
  const data = verifyToken(req.body && req.body.token);
  if (!data) return res.json({ ok: false });
  const entry = cariKode(loadCodes(), data.code);
  res.json({
    ok: true,
    code: data.code,
    submissions: (entry && entry.submissions) || 0,
    maxSubmissions: maxSubmissions(),
  });
});

// Konfigurasi publik untuk frontend (link toko, harga, dll)
app.get("/api/config", (req, res) => {
  res.json(
    buildPublicConfig(process.env, {
      sessionHours: SESSION_HOURS,
      graceHours: settings.get("redeemGraceHours"),
    })
  );
});

/* ---------------------------- admin API ----------------------------
 * Semua rute /api/admin/* ada di lib/http/admin-routes.js.
 * Semua butuh header  x-admin-key  yang cocok dengan ADMIN_KEY di .env.
 */
const { adminOk, codeStats } = registerAdminRoutes(app, {
  log, rateLimit, codeLib, loadCodes, saveCodes, cariKode, queue, template, settings,
});

/* ---------------------------- TEMPLATE STRIP ----------------------------
 * Admin bisa mengganti desain strip dengan mengunggah gambar, tanpa deploy.
 */

// Dibaca browser pengunjung — hanya info tata letak, bukan berkasnya
app.get("/api/template", (req, res) => {
  // Semua template tampil sebagai pilihan bingkai di halaman utama
  res.json({
    ok: true,
    items: template.daftar().map((t) => ({
      id: t.id,
      nama: t.nama,
      layout: t.layout,
      versi: t.diunggahPada,
    })),
    ukuran: { stripWmm: template.STRIP_W_MM, stripHmm: template.STRIP_H_MM },
  });
});

app.get("/api/template/image", (req, res) => {
  const f = template.berkas(String(req.query.id || ""));
  if (!f) return res.status(HTTP.NOT_FOUND).json({ ok: false, error: ERR.NO_TEMPLATE });
  res.setHeader("Content-Type", f.mime);
  res.setHeader("Cache-Control", "public, max-age=300");
  res.send(f.buffer);
});

/* ---------------------- /api/render-strip (premium) ----------------------
 * Menyusun strip HD BERSIH di server. Hanya bisa dipanggil dengan token
 * premium yang sah — inilah yang menutup celah "paksa premium lewat DevTools".
 */
app.post(
  "/api/render-strip",
  // Lapis 1 (rate limit per IP + token dari header) sudah dijalankan
  // largeBodyGate SEBELUM body di-parse — lihat bagian middleware di atas.
  async (req, res) => {
    const session = req.auth;
    if (!session) {
      log.warn("render.unauthorized", { rid: req.rid, ip: req.ip });
      return res.status(HTTP.FORBIDDEN).json({ ok: false, error: ERR.PREMIUM_REQUIRED });
    }

    // Lapis 2: batas sesungguhnya = PER KODE. Adil untuk tiap pembeli,
    // dan tidak terpengaruh berapa banyak orang berbagi IP.
    const kuota = limitStore.hit(
      `render-code:${session.code}`, LIMIT.UPLOAD_WINDOW_MS, LIMIT.RENDER_KODE_MAKS
    );
    if (!kuota.allowed) {
      log.warn("render.quota", { rid: req.rid, code: session.code });
      res.setHeader("Retry-After", kuota.retryAfter);
      return res.status(HTTP.TOO_MANY_REQUESTS).json({ ok: false, error: ERR.TOO_MANY_REQUESTS });
    }

    if (!render.tersedia()) {
      // Server tidak bisa merender → beri tahu browser supaya memakai
      // render lokal (berwatermark). Lebih baik degradasi daripada rusak.
      return res.status(HTTP.NOT_IMPLEMENTED).json({ ok: false, error: ERR.RENDER_UNAVAILABLE });
    }

    // Lapis 3: jumlah render yang jalan BERSAMAAN (CPU & RAM)
    if (!renderSlots.tryAcquire()) {
      res.setHeader("Retry-After", 3);
      return res.status(HTTP.UNAVAILABLE).json({ ok: false, error: ERR.BUSY });
    }

    try {
      const t0 = Date.now();
      const buf = await render.renderStrip({
        photos: req.body.photos,
        frameId: req.body.frameId,
        filter: req.body.filter,
        aspect: req.body.aspect,
        width: req.body.width,
        format: req.body.format,   // "a4" = lembar siap cetak
        copies: req.body.copies,
        dateText: req.body.dateText,
      });
      log.info("render.ok", {
        rid: req.rid, code: session.code,
        kb: Math.round(buf.length / 1024), ms: Date.now() - t0,
      });
      res.setHeader("Content-Type", "image/jpeg");
      res.setHeader("Content-Disposition",
        'attachment; filename="one-strip-clover.jpg"');
      res.setHeader("Cache-Control", "no-store");
      res.send(buf);
    } catch (e) {
      if (e.code === "BAD_PHOTO") {
        log.warn("render.bad_photo", { rid: req.rid, code: session.code, msg: e.message });
        return res.status(HTTP.BAD_REQUEST).json({ ok: false, error: ERR.BAD_PHOTO });
      }
      log.error("render.failed", { rid: req.rid, msg: e.message });
      res.status(HTTP.SERVER_ERROR).json({ ok: false, error: ERR.RENDER_FAILED });
    } finally {
      renderSlots.release();
    }
  }
);

/* ------------------------ /api/fallback-upload ------------------------ */

app.post(
  "/api/fallback-upload",
  // Rate limit per IP dibuat longgar (jatah sesungguhnya dijaga per kode)
  // dan dijalankan largeBodyGate SEBELUM body di-parse.
  async (req, res) => {
  const { photos, consent } = req.body || {};

  // ===== WAJIB PREMIUM =====
  // Dicek di server, bukan cuma di browser — tombol yang disembunyikan
  // masih bisa diakali lewat DevTools, tanda tangan token tidak.
  // Token dibaca dari header oleh largeBodyGate (sebelum body di-parse).
  const session = req.auth;
  if (!session)
    return res.status(HTTP.FORBIDDEN).json({ ok: false, error: ERR.PREMIUM_REQUIRED });
  const code = session.code; // kode diambil dari token, bukan dari input user

  /* --- batas jumlah pesanan per kode ---
     Tanpa ini, 1 kode berbayar bisa dipakai kirim 50 pesanan, dan tiap
     pesanan = kerja manual + cetak + ongkir yang kamu tanggung. */
  const MAX_SUBMISSIONS = maxSubmissions();
  const allCodes = loadCodes();
  const codeEntry = cariKode(allCodes, code);
  if (!codeEntry)
    return res.status(HTTP.FORBIDDEN).json({ ok: false, error: ERR.PREMIUM_REQUIRED });
  if ((codeEntry.submissions || 0) >= MAX_SUBMISSIONS) {
    log.warn("studio.limit_hit", {
      rid: req.rid, code, submissions: codeEntry.submissions, max: MAX_SUBMISSIONS,
    });
    return res.status(HTTP.TOO_MANY_REQUESTS).json({
      ok: false,
      error: ERR.SUBMISSION_LIMIT,
      max: MAX_SUBMISSIONS,
    });
  }

  // Potong input panjang sebelum dipakai. Tanpa ini, nama/catatan/alamat
  // sepanjang megabyte akan masuk ke email, orders.log, dan nama folder Drive.
  const potong = (v, n) => (v == null ? v : String(v).slice(0, n));
  req.body.name = potong(req.body.name, LIMIT.NAMA);
  req.body.note = potong(req.body.note, LIMIT.CATATAN);
  req.body.address = potong(req.body.address, LIMIT.ALAMAT);
  req.body.email = potong(req.body.email, LIMIT.EMAIL);
  req.body.wa = potong(req.body.wa, LIMIT.WA);
  req.body.contact = potong(req.body.contact, LIMIT.EMAIL);
  // Kolom "kecil" lain juga masuk email/log/Drive — dulu tidak dipotong
  for (const k of ["style", "reason", "frameId", "filter", "dateText", "takenAt"]) {
    req.body[k] = potong(req.body[k], LIMIT.TEKS_PENDEK);
  }

  const { name, note, address, email, wa, contact, style, reason, takenAt } = req.body;
  const invalid = fmt.validateOrder({ ...req.body, consent, photos, name, email, wa, contact, address });
  if (invalid) return res.status(HTTP.BAD_REQUEST).json({ ok: false, error: invalid });

  // Isi foto & strip diperiksa (magic bytes + dimensi). Tanpa ini pemegang
  // token bisa melampirkan berkas apa pun (HTML/EXE bernama .jpg) ke email
  // studio, atau bom dekompresi yang membuat server kehabisan memori.
  try {
    for (const p of photos) parseImageDataUrl(p);
    if (req.body.strip != null && req.body.strip !== "") {
      parseImageDataUrl(req.body.strip, { allowed: [MIME.JPEG], maxSide: 8000, maxPixels: 30e6 });
    }
  } catch (e) {
    log.warn("studio.bad_photo", { rid: req.rid, code, msg: e.message });
    return res.status(HTTP.BAD_REQUEST).json({ ok: false, error: ERR.BAD_PHOTO });
  }

  // Kunci per kode: cegah dua pesanan berbarengan menembus jatah yang sama
  // (mis. tombol ditekan dua kali, atau dibuka di dua tab).
  if (!orderLocks.acquire(code)) {
    log.warn("studio.concurrent_blocked", { rid: req.rid, code });
    return res.status(HTTP.CONFLICT).json({ ok: false, error: ERR.ALREADY_PROCESSING });
  }

  try {

  // Label folder Drive & subject email dibentuk di lib/delivery.js
  const takenLabel = fmt.takenLabel(takenAt);
  const REF = fmt.buildRef(req.rid);

  // Objek pesanan — bentuk yang sama dipakai jalur langsung & antrean
  const orderPayload = {
    ref: REF, code, name, email, wa, address, note,
    style, takenAt, reason,
    // `a4` dari browser tidak dipakai lagi (PDF dibuat server) — tidak
    // disimpan supaya antrean di disk tidak membengkak.
    photos, strip: req.body.strip || null,
    // dipakai server untuk membuat ulang lembar A4 versi 300 dpi
    frameId: req.body.frameId || null,
    filter: req.body.filter || null,
    aspect: Number(req.body.aspect) || 1,
    dateText: req.body.dateText || "",
    createdAt: new Date().toISOString(),
  };

  const { ok: anyOk, results, errors } = await delivery.deliver(orderPayload, { log });

  const emailConfigured = !!process.env.SMTP_HOST;
  const driveConfigured = !!(
    process.env.GOOGLE_CLIENT_ID &&
    process.env.GOOGLE_REFRESH_TOKEN &&
    process.env.DRIVE_FOLDER_ID
  );
  if (!emailConfigured && !driveConfigured) {
    log.error("delivery.not_configured", {
      rid: req.rid, hint: "isi SMTP_* di .env lalu restart server",
    });
    return res.status(HTTP.SERVER_ERROR).json({ ok: false, error: ERR.NOT_CONFIGURED });
  }

  // ---- GAGAL TOTAL → parkir ke antrean, jangan buang foto pembeli ----
  let queued = false;
  if (!anyOk) {
    log.error("studio.delivery_failed", { rid: req.rid, code, errors: errors.join(" | ") });
    try {
      queue.park(REF, { ...orderPayload, consent: true });
      queued = true;
      log.warn("studio.queued", {
        rid: req.rid, ref: REF, code,
        hint: "akan dicoba ulang otomatis tiap 5 menit",
      });
    } catch (e) {
      log.error("studio.queue_failed", { rid: req.rid, ref: REF, msg: e.message });
    }
  }

  // Jatah dipotong kalau terkirim ATAU sudah aman tersimpan di antrean —
  // pesanannya nyata dan pasti kami proses, jadi kode memang sudah terpakai.
  if (anyOk || queued) {
    const fresh = loadCodes();
    let n = 1;
    if (cariKode(fresh, code)) {
      fresh[code].submissions = (fresh[code].submissions || 0) + 1;
      fresh[code].lastSubmissionAt = new Date().toISOString();
      fresh[code].lastRef = REF;
      n = fresh[code].submissions;
      saveCodes(fresh);
    }
    log.order("studio.order", {
      rid: req.rid, code, name, contact: email || wa,
      via: `${results.email ? "email" : ""}${results.drive ? "+drive" : ""}`,
      quota: `${n}/${MAX_SUBMISSIONS}`,
    });
    log.orderBlock("PESANAN STUDIO", {
      "Nama": name,
      "Email": email,
      "WhatsApp": wa,
      "Alamat": String(address).replace(/\s*\n\s*/g, ", "),
      "Kode": code,
      "Pemakaian": `${n}/${MAX_SUBMISSIONS}`,
      "Catatan": note,
      "Gaya": style,
      "Foto diambil": takenLabel + " WIB",
      "Terkirim ke": `${results.email ? "email " : ""}${results.drive ? "drive" : ""}`.trim(),
      "Request ID": req.rid,
      "No. Pesanan": REF,
    });
  }

  // Antrean berarti pesanan DITERIMA, jadi pembeli tetap melihat konfirmasi.
  // Pesan error SMTP/Drive TIDAK dikirim ke browser (bisa berisi nama host,
  // alamat email studio, dsb.) — detailnya ada di log dengan rid yang sama.
  const diterima = anyOk || queued;
  res.status(diterima ? HTTP.OK : HTTP.SERVER_ERROR).json({
    ok: diterima, ref: REF, queued: queued && !anyOk,
    ...(diterima ? {} : { error: ERR.DELIVERY_FAILED }),
  });
  } finally {
    orderLocks.release(code); // apa pun hasilnya, kunci harus dilepas
  }
  }
);

/* --------- health check untuk monitoring & platform hosting --------- */
// Publik: hanya "hidup/tidak". Detail (stok kode, konfigurasi email/Drive,
// pesanan tertunda) adalah informasi bisnis — hanya dengan header x-admin-key.
app.get(
  "/healthz",
  rateLimit({ windowMs: 60 * 1000, max: 120, key: "health" }),
  (req, res) => {
    try {
      // Saat server sedang dimatikan (deploy), laporkan tidak sehat supaya
      // load balancer berhenti mengirim pembeli baru ke proses ini.
      if (sedangMati) return res.status(HTTP.UNAVAILABLE).json({ ok: false });
      const codes = loadCodes(); // codes.json rusak → melempar → 503
      const dasar = { ok: true, uptime: Math.round(process.uptime()) };
      if (!req.get("x-admin-key")) return res.json(dasar);
      if (!adminOk(req)) return res.status(HTTP.UNAUTHORIZED).json({ ok: false, error: ERR.UNAUTHORIZED });
      const st = codeStats(codes);
      res.json({
        ...dasar,
        email: !!process.env.SMTP_HOST,
        drive: !!(process.env.GOOGLE_REFRESH_TOKEN && process.env.DRIVE_FOLDER_ID),
        render: render.tersedia(),
        chatbotStock: st.chatbotStock,
        pendingOrders: queue.stats().menunggu,
        failedOrders: queue.stats().gagalPermanen,
      });
    } catch (e) {
      // codes.json rusak = masalah serius, monitoring harus tahu
      log.error("health.failed", { msg: e.message });
      res.status(HTTP.UNAVAILABLE).json({ ok: false });
    }
  }
);

// Rute API yang tidak ada → JSON 404 (bukan halaman HTML bawaan Express)
app.use("/api", (req, res) => res.status(HTTP.NOT_FOUND).json({ ok: false, error: ERR.NOT_FOUND }));

/* ------------------ penangkap error yang tidak tertangani ------------------ */
app.use((err, req, res, next) => {
  // Body kelewat besar punya pesan sendiri — dulu muncul sebagai 500 misterius
  if (err && (err.type === "entity.too.large" || err.status === HTTP.PAYLOAD_TOO_LARGE)) {
    log.warn("body.too_large", {
      rid: req && req.rid, path: req && req.path, limit: err.limit,
    });
    return res.status(HTTP.PAYLOAD_TOO_LARGE).json({
      ok: false,
      error: ERR.TOO_BIG,
      hint: `Berkas terlalu besar untuk ${req && req.path}. ` +
            `Kalau ini rute unggahan, tambahkan path-nya ke ROUTE_BESAR di public/shared/contract.js.`,
    });
  }

  // JSON rusak dari klien = kesalahan klien, bukan 500
  if (err && err.type === "entity.parse.failed") {
    return res.status(HTTP.BAD_REQUEST).json({ ok: false, error: ERR.BAD_REQUEST });
  }

  log.error("unhandled.route_error", {
    rid: req && req.rid, path: req && req.path, msg: err.message, stack: (err.stack || "").split("\n")[1],
  });
  res.status(HTTP.SERVER_ERROR).json({ ok: false, error: ERR.SERVER_ERROR, rid: req && req.rid });
});

/* ------------------------------ startup ------------------------------
 * Semua efek samping (listen, timer, sinyal proses) ada di start(), supaya
 * `require("./server")` di tes mendapat `app` tanpa menyalakan apa pun.
 */
let server = null;
let sedangMati = false;

function start() {
  process.on("unhandledRejection", (e) =>
    log.error("unhandled.rejection", { msg: e && e.message })
  );
  process.on("uncaughtException", (e) => {
    // Node menyarankan KELUAR setelah exception tak tertangani: kondisi memori
    // sudah tidak bisa dipercaya. Railway/Render akan menyalakan ulang otomatis.
    log.error("unhandled.exception", {
      msg: e && e.message,
      stack: (e.stack || "").split("\n").slice(0, 3).join(" | "),
    });
    setTimeout(() => process.exit(1), 250).unref();
  });


  /* ---------------- proses coba-ulang pesanan yang tertunda ----------------
   * Memakai ulang jalur pengiriman yang sama dengan permintaan biasa.
   */
  queue.mulaiRetryLoop(
    (payload) => delivery.deliver(payload, { log }),
    {
      maxUsiaJam: Number(process.env.RETRY_MAX_HOURS || 24),
      jedaMenit: Number(process.env.RETRY_INTERVAL_MINUTES || 5),
      log,
    }
  );

  /* ------------------------------ startup ------------------------------ */
  server = app.listen(PORT, () => {
    const codes = loadCodes();
    const st = codeStats(codes);

    console.log(`\n🍀 ONE STRIP CLOVER → http://localhost:${PORT}`);
    console.log(`   admin          → http://localhost:${PORT}/admin\n`);

    // Ringkasan konfigurasi: paling cepat untuk tahu kenapa sesuatu tidak jalan
    render.init(log);
    const rs = render.status();

    const rendererShared = require("./public/shared/strip-renderer.js");
    const L = rendererShared.LAYOUT_BAWAAN;

    const cfg = {
      node: process.versions.node,
      tataLetak:
        `strip ${rendererShared.STRIP_W_MM}x${rendererShared.STRIP_H_MM}mm · ` +
        `foto ${L.photoWmm}x${L.photoHmm}mm (${(L.photoWmm / L.photoHmm).toFixed(2)}:1) · ` +
        `${rendererShared.PHOTO_COUNT} foto`,
      renderServer: rs.siap
        ? `ON (font: ${rs.fonts.join(",") || "bawaan sistem"})`
        : "OFF — unduhan premium memakai render browser",
      email: process.env.SMTP_HOST ? `ON (${process.env.SMTP_HOST} → ${process.env.STUDIO_EMAIL})` : "OFF",
      drive:
        process.env.GOOGLE_REFRESH_TOKEN && process.env.DRIVE_FOLDER_ID
          ? "ON"
          : "OFF",
      admin: process.env.ADMIN_KEY ? "ON" : "OFF (halaman /admin tidak bisa dipakai)",
      sessionSecret: process.env.SESSION_SECRET ? "ON" : "OFF (token hangus tiap restart)",
      trustProxy: String(app.get("trust proxy")),
      maxStudioPerCode: settings.get("maxStudioSubmissions"),
      perangkatPerKode: settings.get("maxDevicesPerCode"),
      masaTenggangKode: settings.get("redeemGraceHours") + " jam",
      stokChatbot: st.chatbotStock,
      stokAdmin: st.available,
      kodeDipakai: st.redeemed,
    };
    console.log("   KONFIGURASI:");
    for (const [k, v] of Object.entries(cfg)) console.log(`     ${k.padEnd(17)}: ${v}`);
    console.log(`\n   log → data/app.log  &  data/orders.log\n`);

    log.info("server.start", { port: PORT, ...cfg });

    if (!process.env.SMTP_HOST)
      log.warn("config.no_email", { hint: "isi SMTP_* di .env, fitur Kirim ke Studio akan gagal" });
    if ((st.chatbotStock || 0) === 0)
      log.warn("config.no_chatbot_codes", {
        hint: "buat batch 'Untuk chatbot' di /admin — pembeli baru tidak akan dapat kode",
      });
  });

  // Anti slowloris: klien yang mengirim header/body super pelan tidak boleh
  // menahan koneksi selamanya. requestTimeout tetap longgar untuk unggahan
  // foto dari HP di jaringan lambat.
  server.headersTimeout = LIMIT.HTTP_HEADERS_TIMEOUT_MS;
  server.requestTimeout = LIMIT.HTTP_REQUEST_TIMEOUT_MS;
  server.keepAliveTimeout = 65 * 1000; // > idle timeout load balancer umum (60 dtk)

  /* ---------------------- mati dengan rapi (deploy) ----------------------
   * Railway/Render mengirim SIGTERM saat deploy baru. Tanpa penanganan ini,
   * proses langsung dibunuh dan pesanan yang sedang diproses (email/Drive
   * belum selesai) hilang tanpa jejak — pembeli merasa sudah kirim, kamu
   * tidak pernah menerimanya.
   */
  function matikanDenganRapi(sinyal) {
    if (sedangMati) return;
    sedangMati = true;
    log.info("server.shutdown", { sinyal, pesananBerjalan: orderLocks.size() });

    server.close(() => {
      log.info("server.closed", {});
      process.exit(0);
    });

    // Jangan menggantung selamanya kalau ada koneksi yang tidak menutup
    setTimeout(() => {
      log.warn("server.force_exit", { pesananBerjalan: orderLocks.size() });
      process.exit(0);
    }, LIMIT.SHUTDOWN_MS).unref();
  }
  process.on("SIGTERM", () => matikanDenganRapi("SIGTERM"));
  process.on("SIGINT", () => matikanDenganRapi("SIGINT"));

  return server;
}

if (require.main === module) start();

module.exports = { app, start };
