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
if (_major < 18) {
  console.error(
    `\n❌ Node.js kamu versi ${process.versions.node}, terlalu lama.\n` +
      `   Butuh Node 18 atau lebih baru (disarankan LTS 22).\n\n` +
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
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const log = require("./lib/logger");
const codeLib = require("./lib/codes");
const { createTokens } = require("./lib/tokens");
const fmt = require("./lib/format");
const { createStore } = require("./lib/ratelimit");
const { evaluateRedemption, STATUS: REDEEM } = require("./lib/redeem");
const { buildPublicConfig } = require("./lib/config");
const { createLocks } = require("./lib/locks");
const queue = require("./lib/queue");
const delivery = require("./lib/delivery");
const render = require("./lib/render");
const settings = require("./lib/settings");
const template = require("./lib/template");

// Satu kode = satu pesanan diproses pada satu waktu (lihat lib/locks.js)
const orderLocks = createLocks();

const app = express();
const PORT = process.env.PORT || 3000;
const CODES_FILE = path.join(__dirname, "data", "codes.json");

// Di belakang proxy (Railway/Render) supaya req.ip = IP asli pengunjung
app.set("trust proxy", 1);

/* ------------------ request id + log tiap panggilan API ------------------ */
app.use((req, res, next) => {
  req.rid = crypto.randomBytes(3).toString("hex"); // id pendek untuk korelasi
  if (!req.path.startsWith("/api")) return next();

  const t0 = Date.now();
  res.on("finish", () => {
    const f = {
      rid: req.rid,
      method: req.method,
      path: req.path,
      status: res.statusCode,
      ms: Date.now() - t0,
      ip: req.ip,
    };
    if (res.statusCode >= 500) log.error("api.fail", f);
    else if (res.statusCode >= 400) log.warn("api.reject", f);
    else log.info("api.ok", f);
  });
  next();
});

/* --------------------------- keamanan dasar --------------------------- */
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Referrer-Policy", "same-origin");
  res.setHeader("Permissions-Policy", "camera=(self), geolocation=(), microphone=()");
  // Batasi sumber skrip/gambar — mempersempit dampak kalau ada celah XSS
  res.setHeader(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'", // skrip inline masih dipakai di index.html
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      "img-src 'self' data: blob:",
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; ")
  );
  // Paksa HTTPS setelah kunjungan pertama (hanya berarti di produksi)
  if (req.secure || req.get("x-forwarded-proto") === "https") {
    res.setHeader("Strict-Transport-Security", "max-age=15552000; includeSubDomains");
  }
  next();
});

/**
 * Rate limiter sederhana (in-memory, tanpa dependency).
 * Cukup untuk skala ini; kalau nanti multi-server, ganti pakai Redis.
 */
const limitStore = createStore();
/**
 * @param {object} o
 *   key      nama endpoint
 *   by       fungsi penentu identitas. Default IP.
 *            PENTING: IP ≠ perangkat. Operator seluler Indonesia memakai
 *            CGNAT — ribuan pelanggan bisa berbagi satu IP. Jadi untuk
 *            endpoint yang sudah punya token, batasi PER KODE, bukan per IP,
 *            supaya pembeli lain di operator yang sama tidak ikut terblokir.
 */
function rateLimit({ windowMs, max, key, by }) {
  return (req, res, next) => {
    const identitas = by ? by(req) : req.ip;
    const r = limitStore.hit(`${key}:${identitas}`, windowMs, max);
    if (r.allowed) return next();
    log.warn("ratelimit.block", {
      rid: req.rid, key, id: identitas, ip: req.ip, retryAfter: r.retryAfter,
    });
    res.setHeader("Retry-After", r.retryAfter);
    return res
      .status(429)
      .json({ ok: false, error: "TOO_MANY_REQUESTS", retryAfter: r.retryAfter });
  };
}

// Bersihkan bucket lama tiap 10 menit supaya memori tidak menumpuk
setInterval(() => limitStore.sweep(), 10 * 60 * 1000).unref();


// Batas ukuran dibedakan per rute. Sebelumnya 25 MB berlaku untuk SEMUA
// endpoint, termasuk /api/redeem — penyerang bisa mengirim 25 MB berkali-kali
// hanya untuk menghabiskan memori server.
const jsonKecil = express.json({ limit: "16kb" });
const jsonBesar = express.json({ limit: "25mb" }); // unggah foto & template

const RUTE_BESAR = new Set([
  "/api/fallback-upload", // foto pesanan
  "/api/admin/template",  // unggah desain strip
  "/api/render-strip",    // foto untuk render HD di server
]);
app.use((req, res, next) => {
  // Rute yang memang menerima berkas besar (foto / template).
  // Sisanya dibatasi 16 KB supaya tidak bisa dipakai menghabiskan memori.
  // Daftar ini HARUS lengkap — rute besar yang lupa didaftarkan akan gagal
  // dengan galat "payload too large" yang membingungkan.
  return RUTE_BESAR.has(req.path)
    ? jsonBesar(req, res, next)
    : jsonKecil(req, res, next);
});
/* Cache dimatikan untuk HTML & JS.
 * Sebelumnya dipasang maxAge 1 jam — akibatnya setelah kamu memperbarui kode,
 * browser bisa memakai campuran: index.html BARU + strip-renderer.js LAMA.
 * Campuran itu membuat halaman rusak sebagian (bingkai hilang, tombol mati)
 * tanpa pesan error apa pun. Gambar/font boleh tetap di-cache. */
app.use(
  express.static(path.join(__dirname, "public"), {
    setHeaders(res, filePath) {
      if (/\.(html|js)$/i.test(filePath)) {
        res.setHeader("Cache-Control", "no-store, must-revalidate");
      } else {
        res.setHeader("Cache-Control", "public, max-age=3600");
      }
    },
  })
);

/* ------------------------------ halaman ------------------------------
 *   /        → halaman pembuka (penjelasan + tombol Masuk)
 *   /booth   → photobox-nya sendiri
 *   /admin   → panel admin (dilindungi ADMIN_KEY di halamannya)
 * Dipisah supaya pengunjung tahu dulu ini apa sebelum kameranya menyala —
 * meminta izin kamera di detik pertama membuat orang kabur.
 */
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
const updateCodes = (mutator) => codeLib.update(mutator);

/* ------------------------- premium sessions -------------------------
 * Token ditandatangani (HMAC), jadi tidak perlu disimpan di memori dan
 * tetap sah walau server restart — pembeli yang sudah bayar tidak
 * kehilangan akses saat kamu deploy ulang.
 */
const SESSION_HOURS = Number(process.env.SESSION_HOURS || 3);
const SESSION_SECRET =
  process.env.SESSION_SECRET ||
  process.env.ADMIN_KEY ||
  crypto.randomBytes(32).toString("hex"); // fallback: acak tiap restart

if (!process.env.SESSION_SECRET && !process.env.ADMIN_KEY) {
  console.warn(
    "⚠️  SESSION_SECRET belum diisi di .env — token premium akan hangus\n" +
      "   setiap server restart. Isi SESSION_SECRET dengan teks acak panjang.\n"
  );
}

// Masa tenggang: kode yang sudah ditukar masih bisa memulihkan sesi selama N jam.
// Mencegah pembeli terkunci karena refresh / ganti HP / cache terhapus.
const GRACE_HOURS = Number(process.env.REDEEM_GRACE_HOURS || 3);
const GRACE_MS = GRACE_HOURS * 3600 * 1000;

const tokens = createTokens({ secret: SESSION_SECRET, hours: SESSION_HOURS });
const makeToken = (code) => tokens.make(code);
const verifyToken = (t) => tokens.verify(t);

/* ---------------------------- /api/redeem ---------------------------- */

// Anti tebak-kode: HANYA percobaan yang GAGAL yang dihitung.
// Penukaran yang berhasil tidak memakan jatah, supaya pembeli sah di balik
// IP yang sama (WiFi kafe / CGNAT operator) tidak saling memblokir.
const REDEEM_WINDOW_MS = 15 * 60 * 1000;
const REDEEM_MAX_GAGAL = 15;

app.post("/api/redeem", (req, res) => {
  const limitKey = `redeem-fail:${req.ip}`;
  const izin = limitStore.check(limitKey, REDEEM_WINDOW_MS, REDEEM_MAX_GAGAL);
  if (!izin.allowed) {
    log.warn("redeem.ratelimit", { rid: req.rid, ip: req.ip, retryAfter: izin.retryAfter });
    res.setHeader("Retry-After", izin.retryAfter);
    return res
      .status(429)
      .json({ ok: false, error: "TOO_MANY_REQUESTS", retryAfter: izin.retryAfter });
  }
  const catatGagal = () => limitStore.penalize(limitKey, REDEEM_WINDOW_MS, REDEEM_MAX_GAGAL);
  {
  const raw = (req.body.code || "").trim().toUpperCase();
  if (!raw) {
    catatGagal();
    return res.status(400).json({ ok: false, error: "EMPTY" });
  }

  const codes = loadCodes();
  const entry = codes[raw];
  // ID perangkat dibuat & disimpan oleh browser pembeli (bukan data pribadi,
  // hanya angka acak). Dipakai untuk mengikat kode ke satu perangkat.
  let deviceId = String((req.body && req.body.deviceId) || "").slice(0, 64) || null;

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
    return res.status(404).json({ ok: false, error: "INVALID" });
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
      maxSubmissions: Number(process.env.MAX_STUDIO_SUBMISSIONS || 1),
    });
  }

  // Kode dipakai di perangkat lain → kemungkinan besar kodenya dibagikan
  if (verdict.status === REDEEM.OTHER_DEVICE) {
    catatGagal();
    log.warn("redeem.other_device", {
      rid: req.rid, code: raw, ip: req.ip,
      hint: "kode kemungkinan dibagikan ke orang lain",
    });
    return res.status(409).json({ ok: false, error: "OTHER_DEVICE" });
  }

  if (verdict.status === REDEEM.SPENT) {
    catatGagal();
    log.warn("redeem.spent", {
      rid: req.rid, code: raw, ip: req.ip, ref: verdict.ref,
    });
    return res.status(409).json({
      ok: false,
      error: "SPENT",
      ref: verdict.ref || null,
    });
  }

  if (verdict.status === REDEEM.USED) {
    catatGagal();
    log.warn("redeem.expired", {
      rid: req.rid, code: raw, ip: req.ip,
      usedAt: entry.usedAt, graceHours: GRACE_HOURS,
    });
    return res.status(409).json({ ok: false, error: "USED", graceHours: GRACE_HOURS });
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
  const data = verifyToken(req.body.token);
  if (!data) return res.json({ ok: false });
  const entry = loadCodes()[data.code];
  res.json({
    ok: true,
    code: data.code,
    submissions: (entry && entry.submissions) || 0,
    maxSubmissions: Number(process.env.MAX_STUDIO_SUBMISSIONS || 1),
  });
});

// Konfigurasi publik untuk frontend (link toko, harga, dll)
app.get("/api/config", (req, res) => {
  res.json(
    buildPublicConfig(process.env, {
      sessionHours: SESSION_HOURS,
      graceHours: GRACE_HOURS,
    })
  );
});

/* ---------------------------- admin API ---------------------------- */
/*
 * Dipakai oleh halaman /admin, atau oleh tool otomasi (n8n / Make / chatbot).
 * Semua butuh header  x-admin-key  yang cocok dengan ADMIN_KEY di .env.
 *
 * Contoh dari tool otomasi:
 *   POST /api/admin/next-code
 *   Header: x-admin-key: rahasia123
 *   → { ok:true, code:"FB-K3PQ7M", remaining:487 }
 */

function adminOk(req) {
  const key = process.env.ADMIN_KEY;
  const diberi = req.get("x-admin-key") || "";
  let ok = false;
  if (key) {
    // Perbandingan tahan timing-attack: `a === b` berhenti di karakter pertama
    // yang berbeda, sehingga lama waktunya membocorkan panjang kecocokan.
    const a = Buffer.from(String(diberi));
    const b = Buffer.from(String(key));
    ok = a.length === b.length && crypto.timingSafeEqual(a, b);
  }
  if (!ok) log.warn("admin.unauthorized", { rid: req.rid, path: req.path, ip: req.ip });
  return ok;
}

// Semua rute admin dibatasi percobaannya — dulu hanya /next-code yang dibatasi,
// sehingga ADMIN_KEY bisa ditebak tanpa batas lewat /api/admin/stats.
const adminGuard = rateLimit({ windowMs: 15 * 60 * 1000, max: 60, key: "admin" });

function codeStats(codes) {
  const list = Object.values(codes);
  const isChatbot = (c) => c.buyer === "(batch chatbot)";
  return {
    total: list.length,
    redeemed: list.filter((c) => c.used).length,
    // stok admin  = belum dibagikan sama sekali, siap dipakai tombol /admin
    available: list.filter((c) => !c.issued && !c.used).length,
    // stok chatbot = sudah diekspor ke pool chatbot, tapi belum ditukar pembeli
    chatbotStock: list.filter((c) => c.issued && isChatbot(c) && !c.used).length,
    // dibagikan manual lewat tombol /admin
    adminIssued: list.filter((c) => c.issued && !isChatbot(c)).length,
    issued: list.filter((c) => c.issued).length, // dipertahankan untuk kompatibilitas
  };
}

// Ambil 1 kode yang BELUM pernah dibagikan, lalu tandai "issued".
app.post(
  "/api/admin/next-code",
  rateLimit({ windowMs: 15 * 60 * 1000, max: 60, key: "admin" }),
  (req, res) => {
  if (!adminOk(req)) return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });

  const codes = loadCodes();
  const entry = Object.entries(codes).find(([, v]) => !v.issued && !v.used);

  if (!entry) {
    log.error("code.out_of_stock", { rid: req.rid });
    return res.status(409).json({
      ok: false,
      error: "OUT_OF_STOCK",
      hint: "Stok admin habis — buat kode baru lewat tombol Generate (pilihan Stok admin).",
      stats: codeStats(codes),
    });
  }

  const [code, data] = entry;
  data.issued = true;
  data.issuedAt = new Date().toISOString();
  if (req.body && req.body.buyer) data.buyer = String(req.body.buyer).slice(0, 80);
  saveCodes(codes);

  const stats = codeStats(codes);
  log.order("code.issued", { rid: req.rid, code, buyer: data.buyer, remaining: stats.available });
  if (stats.available < 20)
    log.warn("code.low_stock", { remaining: stats.available });
  res.json({ ok: true, code, remaining: stats.available, stats });
  }
);

// Ringkasan stok kode
app.post("/api/admin/stats", adminGuard, (req, res) => {
  if (!adminOk(req)) return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });
  const codes = loadCodes();
  const recent = Object.entries(codes)
    .filter(([, v]) => v.issued)
    .sort((a, b) => String(b[1].issuedAt).localeCompare(String(a[1].issuedAt)))
    .slice(0, 10)
    .map(([code, v]) => ({
      code,
      issuedAt: v.issuedAt,
      used: !!v.used,
      buyer: v.buyer || null,
    }));
  res.json({ ok: true, stats: codeStats(codes), recent, queue: queue.stats() });
});

// Buat kode baru langsung dari halaman /admin (pengganti buka terminal)
app.post(
  "/api/admin/generate",
  rateLimit({ windowMs: 60 * 60 * 1000, max: 20, key: "generate" }),
  (req, res) => {
    if (!adminOk(req)) return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });

    const n = Number(req.body.n);
    if (!Number.isFinite(n) || n < 1 || n > 2000)
      return res.status(400).json({ ok: false, error: "BAD_COUNT", hint: "1 - 2000" });

    const forChatbot = !!req.body.forChatbot;
    try {
      const r = codeLib.generate(n, { forChatbot });
      const stats = codeLib.stats();
      log.order("code.batch_generated", {
        rid: req.rid,
        count: r.codes.length,
        target: forChatbot ? "chatbot" : "admin",
        total: stats.total,
      });
      res.json({ ok: true, codes: r.codes, forChatbot, stats });
    } catch (e) {
      log.error("code.generate_failed", { rid: req.rid, msg: e.message });
      res.status(500).json({ ok: false, error: "GENERATE_FAILED", msg: e.message });
    }
  }
);

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
  if (!f) return res.status(404).json({ ok: false, error: "NO_TEMPLATE" });
  res.setHeader("Content-Type", f.mime);
  res.setHeader("Cache-Control", "public, max-age=300");
  res.send(f.buffer);
});

app.post("/api/admin/template", adminGuard, async (req, res) => {
  if (!adminOk(req)) return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });

  try {
    // 1) baca pustaka
    if (req.body.baca) {
      return res.json({ ok: true, items: template.daftar(), maks: template.MAKS_TEMPLATE });
    }

    // 2) hapus satu template
    if (req.body.hapus) {
      const t = template.cari(String(req.body.hapus));
      const items = await template.hapus(String(req.body.hapus));
      log.order("template.deleted", { rid: req.rid, id: req.body.hapus, nama: t && t.nama });
      return res.json({ ok: true, items, maks: template.MAKS_TEMPLATE });
    }

    // 3) ubah nama / tata letak satu template
    if (req.body.ubah && req.body.ubah.id) {
      const t = await template.ubah(String(req.body.ubah.id), req.body.ubah);
      if (!t) return res.status(404).json({ ok: false, error: "NOT_FOUND" });
      log.order("template.updated", { rid: req.rid, id: t.id, nama: t.nama });
      return res.json({ ok: true, items: template.daftar(), maks: template.MAKS_TEMPLATE });
    }

    // 4) unggah template baru
    const dataUrl = String(req.body.image || "");
    const cocok = dataUrl.match(/^data:(image\/(png|jpeg));base64,(.+)$/);
    if (!cocok) {
      return res.status(400).json({ ok: false, error: "BAD_IMAGE", hint: "PNG atau JPG saja" });
    }
    const buf = Buffer.from(cocok[3], "base64");
    if (buf.length > 8 * 1024 * 1024) {
      return res.status(413).json({ ok: false, error: "TOO_BIG", hint: "maksimal 8 MB" });
    }

    const t = await template.tambah(
      buf, cocok[1],
      { lebarPx: Number(req.body.lebarPx) || null, tinggiPx: Number(req.body.tinggiPx) || null },
      req.body.nama
    );
    log.order("template.uploaded", {
      rid: req.rid, id: t.id, nama: t.nama, kb: Math.round(buf.length / 1024),
    });
    res.json({ ok: true, items: template.daftar(), baru: t.id, maks: template.MAKS_TEMPLATE });
  } catch (e) {
    log.error("template.failed", { rid: req.rid, msg: e.message });
    res.status(500).json({ ok: false, error: "SERVER_ERROR", hint: e.message });
  }
});

app.post("/api/admin/settings", adminGuard, async (req, res) => {
  if (!adminOk(req)) return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });

  if (req.body && req.body.update) {
    const sebelum = settings.all();
    const sesudah = await settings.update(req.body.update);
    log.order("settings.changed", { rid: req.rid, sebelum, sesudah });
    return res.json({ ok: true, settings: sesudah, skema: settings.SKEMA });
  }
  res.json({ ok: true, settings: settings.all(), skema: settings.SKEMA });
});

// Lepas ikatan perangkat sebuah kode.
// Dipakai kalau pembeli sah terkunci — mis. dia menukar kode di browser dalam
// aplikasi TikTok, lalu membuka situsnya lagi di Safari (penyimpanannya beda).
app.post(
  "/api/admin/unbind",
  adminGuard,
  (req, res) => {
    if (!adminOk(req)) return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });

    const kode = String((req.body && req.body.code) || "").trim().toUpperCase();
    const codes = loadCodes();
    const entry = codes[kode];
    if (!entry) return res.status(404).json({ ok: false, error: "INVALID" });

    if (entry.submissions > 0) {
      // Kode yang sudah dipakai memesan memang sudah selesai tugasnya
      return res.status(409).json({ ok: false, error: "SPENT", ref: entry.lastRef || null });
    }

    const sebelum = (entry.devices || []).length;
    entry.devices = [];
    entry.unbindCount = (entry.unbindCount || 0) + 1;
    entry.lastUnbindAt = new Date().toISOString();
    saveCodes(codes);

    log.order("code.unbind", {
      rid: req.rid, code: kode, perangkatSebelumnya: sebelum,
      totalPelepasan: entry.unbindCount,
    });
    res.json({ ok: true, code: kode, unbindCount: entry.unbindCount });
  }
);

// Lihat log lewat browser (berguna saat sudah live, tanpa buka shell)
app.post("/api/admin/logs", adminGuard, (req, res) => {
  if (!adminOk(req)) return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });
  const which = req.body.which === "app" ? "app" : "orders";
  const n = Math.min(Number(req.body.n || 60), 300);
  res.json({ ok: true, which, lines: log.tail(which, n) });
});

/* ---------------------- /api/render-strip (premium) ----------------------
 * Menyusun strip HD BERSIH di server. Hanya bisa dipanggil dengan token
 * premium yang sah — inilah yang menutup celah "paksa premium lewat DevTools".
 */
app.post(
  "/api/render-strip",
  // Lapis 1: cegah orang tanpa token menghabiskan CPU. Longgar, karena
  // satu IP bisa mewakili banyak pembeli (CGNAT operator seluler).
  rateLimit({ windowMs: 60 * 60 * 1000, max: 300, key: "render-ip" }),
  async (req, res) => {
    const session = verifyToken(req.body && req.body.token);
    if (!session) {
      log.warn("render.unauthorized", { rid: req.rid, ip: req.ip });
      return res.status(403).json({ ok: false, error: "PREMIUM_REQUIRED" });
    }

    // Lapis 2: batas sesungguhnya = PER KODE. Adil untuk tiap pembeli,
    // dan tidak terpengaruh berapa banyak orang berbagi IP.
    const kuota = limitStore.hit(
      `render-code:${session.code}`, 60 * 60 * 1000, 30
    );
    if (!kuota.allowed) {
      log.warn("render.quota", { rid: req.rid, code: session.code });
      res.setHeader("Retry-After", kuota.retryAfter);
      return res.status(429).json({ ok: false, error: "TOO_MANY_REQUESTS" });
    }

    if (!render.tersedia()) {
      // Server tidak bisa merender → beri tahu browser supaya memakai
      // render lokal (berwatermark). Lebih baik degradasi daripada rusak.
      return res.status(501).json({ ok: false, error: "RENDER_UNAVAILABLE" });
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
      log.error("render.failed", { rid: req.rid, msg: e.message });
      res.status(500).json({ ok: false, error: "RENDER_FAILED" });
    }
  }
);

/* ------------------------ /api/fallback-upload ------------------------ */

app.post(
  "/api/fallback-upload",
  // Longgar di sisi IP karena jatah sesungguhnya dijaga per kode
  // (MAX_STUDIO_SUBMISSIONS). Batas ketat per IP justru memblokir pembeli
  // lain yang kebetulan satu operator seluler.
  rateLimit({ windowMs: 60 * 60 * 1000, max: 120, key: "upload" }),
  async (req, res) => {
  let { photos, contact, note, consent, reason, name, email, wa, takenAt, address } =
    req.body || {};

  // ===== WAJIB PREMIUM =====
  // Dicek di server, bukan cuma di browser — tombol yang disembunyikan
  // masih bisa diakali lewat DevTools, tanda tangan token tidak.
  const session = verifyToken(req.body.token);
  if (!session)
    return res.status(403).json({ ok: false, error: "PREMIUM_REQUIRED" });
  const code = session.code; // kode diambil dari token, bukan dari input user

  /* --- batas jumlah pesanan per kode ---
     Tanpa ini, 1 kode berbayar bisa dipakai kirim 50 pesanan, dan tiap
     pesanan = kerja manual + cetak + ongkir yang kamu tanggung. */
  const MAX_SUBMISSIONS = settings.get("maxStudioSubmissions");
  const allCodes = loadCodes();
  const codeEntry = allCodes[code];
  if (!codeEntry)
    return res.status(403).json({ ok: false, error: "PREMIUM_REQUIRED" });
  if ((codeEntry.submissions || 0) >= MAX_SUBMISSIONS) {
    log.warn("studio.limit_hit", {
      rid: req.rid, code, submissions: codeEntry.submissions, max: MAX_SUBMISSIONS,
    });
    return res.status(429).json({
      ok: false,
      error: "SUBMISSION_LIMIT",
      max: MAX_SUBMISSIONS,
    });
  }

  // Potong input panjang sebelum dipakai. Tanpa ini, nama/catatan/alamat
  // sepanjang megabyte akan masuk ke email, orders.log, dan nama folder Drive.
  const potong = (v, n) => (v == null ? v : String(v).slice(0, n));
  req.body.name = potong(req.body.name, 80);
  req.body.note = potong(req.body.note, 500);
  req.body.address = potong(req.body.address, 400);
  req.body.email = potong(req.body.email, 120);
  req.body.wa = potong(req.body.wa, 25);

  ({ name, note, address, email, wa } = req.body);
  const invalid = fmt.validateOrder({ ...req.body, consent, photos, name, email, wa, contact, address });
  if (invalid) return res.status(400).json({ ok: false, error: invalid });

  // Kunci per kode: cegah dua pesanan berbarengan menembus jatah yang sama
  // (mis. tombol ditekan dua kali, atau dibuka di dua tab).
  if (!orderLocks.acquire(code)) {
    log.warn("studio.concurrent_blocked", { rid: req.rid, code });
    return res.status(409).json({ ok: false, error: "ALREADY_PROCESSING" });
  }

  try {

  /* --- label bersama untuk nama folder Drive & subject email ---
     Format: Nama - kontak - tanggal foto - kode premium
     contoh: Daniel W - 08121234567 - 2026-07-28 18.07 - OSC-K3PQ7M   */
  const takenLabel = fmt.takenLabel(takenAt);
  const LABEL = fmt.buildLabel({ name, email, wa, contact, takenAt, code });
  const REF = fmt.buildRef(req.rid);

  // Objek pesanan — bentuk yang sama dipakai jalur langsung & antrean
  const orderPayload = {
    ref: REF, code, name, email, wa, address, note,
    style: req.body.style, takenAt, reason,
    photos, strip: req.body.strip || null, a4: req.body.a4 || null,
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
    return res.status(500).json({ ok: false, error: "NOT_CONFIGURED" });
  }

  // ---- GAGAL TOTAL → parkir ke antrean, jangan buang foto pembeli ----
  let queued = false;
  if (!anyOk) {
    log.error("studio.delivery_failed", { rid: req.rid, code, errors: errors.join(" | ") });
    try {
      queue.park(REF, {
        ref: REF, code, name, email, wa, address, note,
        style: req.body.style, takenAt,
        photos, strip: req.body.strip || null, a4: req.body.a4 || null,
        frameId: req.body.frameId || null,
        filter: req.body.filter || null,
        aspect: Number(req.body.aspect) || 1,
        dateText: req.body.dateText || "",
        consent: true,
      });
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
    if (fresh[code]) {
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
      "Gaya": req.body.style,
      "Foto diambil": takenLabel + " WIB",
      "Terkirim ke": `${results.email ? "email " : ""}${results.drive ? "drive" : ""}`.trim(),
      "Request ID": req.rid,
      "No. Pesanan": REF,
    });
  }

  // Antrean berarti pesanan DITERIMA, jadi pembeli tetap melihat konfirmasi
  const diterima = anyOk || queued;
  res.status(diterima ? 200 : 500).json({
    ok: diterima, ref: REF, queued: queued && !anyOk, results, errors,
  });
  } finally {
    orderLocks.release(code); // apa pun hasilnya, kunci harus dilepas
  }
  }
);

/* ------------------ penangkap error yang tidak tertangani ------------------ */
app.use((err, req, res, next) => {
  // Body kelewat besar punya pesan sendiri — dulu muncul sebagai 500 misterius
  if (err && (err.type === "entity.too.large" || err.status === 413)) {
    log.warn("body.too_large", {
      rid: req && req.rid, path: req && req.path, limit: err.limit,
    });
    return res.status(413).json({
      ok: false,
      error: "TOO_BIG",
      hint: `Berkas terlalu besar untuk ${req && req.path}. ` +
            `Kalau ini rute unggahan, tambahkan path-nya ke RUTE_BESAR di server.js.`,
    });
  }

  log.error("unhandled.route_error", {
    rid: req && req.rid, path: req && req.path, msg: err.message, stack: (err.stack || "").split("\n")[1],
  });
  res.status(500).json({ ok: false, error: "SERVER_ERROR", rid: req && req.rid });
});

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

/* --------- health check untuk monitoring & platform hosting --------- */
app.get("/healthz", (req, res) => {
  try {
    const st = codeStats(loadCodes());
    res.json({
      ok: true,
      uptime: Math.round(process.uptime()),
      email: !!process.env.SMTP_HOST,
      drive: !!(process.env.GOOGLE_REFRESH_TOKEN && process.env.DRIVE_FOLDER_ID),
      chatbotStock: st.chatbotStock,
      pendingOrders: queue.stats().menunggu,
    });
  } catch (e) {
    // codes.json rusak = masalah serius, monitoring harus tahu
    res.status(503).json({ ok: false, error: e.message });
  }
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
const server = app.listen(PORT, () => {
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

/* ---------------------- mati dengan rapi (deploy) ----------------------
 * Railway/Render mengirim SIGTERM saat deploy baru. Tanpa penanganan ini,
 * proses langsung dibunuh dan pesanan yang sedang diproses (email/Drive
 * belum selesai) hilang tanpa jejak — pembeli merasa sudah kirim, kamu
 * tidak pernah menerimanya.
 */
let sedangMati = false;
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
  }, 25000).unref();
}
process.on("SIGTERM", () => matikanDenganRapi("SIGTERM"));
process.on("SIGINT", () => matikanDenganRapi("SIGINT"));
