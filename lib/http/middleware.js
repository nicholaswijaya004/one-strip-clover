/**
 * MIDDLEWARE HTTP
 *
 * Dipisah dari server.js karena alasan tanggung jawab tunggal (SRP):
 * server.js seharusnya hanya MERANGKAI bagian-bagian, bukan juga berisi
 * aturan keamanan, pembatasan laju, dan pencatatan.
 *
 * Setiap fungsi di sini mengembalikan middleware Express, sehingga bisa
 * dipasang di rute mana pun tanpa mengubah isinya (Open/Closed) — dan bisa
 * diuji terpisah tanpa menyalakan server.
 */

const express = require("express");
const crypto = require("crypto");
const net = require("net");
const { createStore } = require("../ratelimit");
const { createLimiter } = require("../limiter");
const { HTTP, LIMIT, ROUTE_BESAR, ERR } = require("../../public/shared/contract.js");

const limitStore = createStore();

/* Bersihkan bucket lama berkala supaya memori tidak menumpuk */
setInterval(() => limitStore.sweep(), LIMIT.SWEEP_MS).unref();

/**
 * Identitas klien untuk rate limit.
 *
 * IPv4 → alamat utuh. IPv6 → prefiks /64. Satu pelanggan IPv6 biasanya
 * diberi SELURUH blok /64 (18 kuintiliun alamat); kalau dihitung per alamat,
 * penyerang cukup mengganti alamat tiap percobaan dan rate limit tidak
 * berarti apa-apa — termasuk batas tebak kode premium.
 */
function clientKey(ip) {
  const s = String(ip || "");
  const v4 = s.startsWith("::ffff:") ? s.slice(7) : s;
  if (net.isIPv4(v4)) return v4;
  if (!net.isIPv6(s)) return s || "unknown";

  // Lebarkan "::" lalu ambil 4 grup pertama (64 bit)
  const [kiri, kanan = ""] = s.split("::");
  const a = kiri ? kiri.split(":") : [];
  const b = kanan ? kanan.split(":") : [];
  const nol = new Array(Math.max(0, 8 - a.length - b.length)).fill("0");
  const grup = (s.includes("::") ? [...a, ...nol, ...b] : a).slice(0, 4);
  return grup.map((g) => (parseInt(g, 16) || 0).toString(16)).join(":") + "::/64";
}

/**
 * Beri setiap permintaan ID pendek + catat hasilnya.
 * ID dipakai untuk menelusuri satu permintaan di seluruh log.
 */
function requestLog(log) {
  return (req, res, next) => {
    req.rid = crypto.randomBytes(3).toString("hex");
    res.setHeader("X-Request-Id", req.rid);
    if (!req.path.startsWith("/api")) return next();

    const t0 = Date.now();
    res.on("finish", () => {
      const f = {
        rid: req.rid, method: req.method, path: req.path,
        status: res.statusCode, ms: Date.now() - t0, ip: req.ip,
      };
      if (res.statusCode >= HTTP.SERVER_ERROR) log.error("api.fail", f);
      else if (res.statusCode >= HTTP.BAD_REQUEST) log.warn("api.reject", f);
      else log.info("api.ok", f);
    });
    next();
  };
}

/** CSP yang dipakai semua halaman — tanpa 'unsafe-inline' untuk skrip */
const CSP = [
  "default-src 'self'",
  // Semua skrip ada di berkas terpisah (public/js, public/shared). Tanpa
  // 'unsafe-inline', satu celah XSS pun tidak bisa menjalankan skrip sisipan.
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "connect-src 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

/** Header keamanan browser (CSP, anti-clickjacking, HSTS, isolasi) */
function securityHeaders() {
  return (req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader(
      "Permissions-Policy",
      "camera=(self), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()"
    );
    res.setHeader("Content-Security-Policy", CSP);
    res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
    res.setHeader("X-DNS-Prefetch-Control", "off");
    if (req.secure) {
      res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    }
    // Respons API berisi token/kode — jangan pernah disimpan cache perantara
    if (req.path.startsWith("/api/")) res.setHeader("Cache-Control", "no-store");
    next();
  };
}

/**
 * Pembatas laju.
 * @param by fungsi penentu identitas. Default IP (IPv6 per /64) — TAPI ingat:
 *           IP ≠ perangkat. Operator seluler memakai CGNAT, ribuan pelanggan
 *           berbagi satu IP. Untuk rute yang punya token, batasi PER KODE.
 */
function rateLimit({ windowMs, max, key, by }, log) {
  return (req, res, next) => {
    const identitas = by ? by(req) : clientKey(req.ip);
    const r = limitStore.hit(`${key}:${identitas}`, windowMs, max);
    if (r.allowed) return next();

    log.warn("ratelimit.block", {
      rid: req.rid, key, id: identitas, ip: req.ip, retryAfter: r.retryAfter,
    });
    res.setHeader("Retry-After", r.retryAfter);
    return res.status(HTTP.TOO_MANY_REQUESTS).json({
      ok: false, error: ERR.TOO_MANY_REQUESTS, retryAfter: r.retryAfter,
    });
  };
}

/**
 * GERBANG RUTE BERBADAN BESAR — dijalankan SEBELUM body di-parse.
 *
 * Dulu body 25 MB di-parse dulu, baru token diperiksa di dalam handler.
 * Artinya siapa pun TANPA token bisa mengirim ratusan body 25 MB dan server
 * sibuk mem-parse JSON raksasa sampai kehabisan memori. Sekarang urutannya:
 *   1. rate limit per IP           (murah)
 *   2. otorisasi dari HEADER       (murah — token/kunci admin tidak di body)
 *   3. jatah paralel global        (RAM tidak bisa jebol walau semua sah)
 *   4. baru body besar di-parse
 *
 * @param {object} rules  { "/api/x": { authorize(req) → bool|object, rate:{windowMs,max,key} } }
 */
function largeBodyGate(rules, { log, maxConcurrent = LIMIT.UPLOAD_PARALEL } = {}) {
  const slots = createLimiter(maxConcurrent);
  const limiters = {};
  for (const [p, r] of Object.entries(rules)) {
    if (r.rate) limiters[p] = rateLimit(r.rate, log);
  }

  return (req, res, next) => {
    const rule = req.method === "POST" && rules[req.path];
    if (!rule) return next();

    const lanjut = () => {
      const auth = rule.authorize(req);
      if (!auth) {
        log.warn("gate.unauthorized", { rid: req.rid, path: req.path, ip: req.ip });
        // Tutup koneksi: jangan biarkan klien terus mengirim sisa 25 MB
        res.setHeader("Connection", "close");
        return res.status(rule.status || HTTP.FORBIDDEN)
          .json({ ok: false, error: rule.error || ERR.PREMIUM_REQUIRED });
      }
      req.auth = auth;

      if (!slots.tryAcquire()) {
        log.warn("gate.busy", { rid: req.rid, path: req.path, aktif: slots.active });
        res.setHeader("Retry-After", 5);
        res.setHeader("Connection", "close");
        return res.status(HTTP.UNAVAILABLE).json({ ok: false, error: ERR.BUSY });
      }
      let dilepas = false;
      const lepas = () => { if (!dilepas) { dilepas = true; slots.release(); } };
      res.on("finish", lepas);
      res.on("close", lepas);
      next();
    };

    const rl = limiters[req.path];
    return rl ? rl(req, res, lanjut) : lanjut();
  };
}

/**
 * Pembatas ukuran badan permintaan, dibedakan per rute.
 * Rute unggahan foto/template boleh besar; sisanya dibatasi ketat supaya
 * tidak bisa dipakai menghabiskan memori server.
 */
function bodyParsers() {
  const kecil = express.json({ limit: LIMIT.BODY_KECIL });
  const besar = express.json({ limit: LIMIT.BODY_BESAR });
  const besarSet = new Set(ROUTE_BESAR);

  return (req, res, next) =>
    besarSet.has(req.path) ? besar(req, res, next) : kecil(req, res, next);
}

/** Berkas statis: HTML & JS tidak di-cache supaya versi tidak tercampur */
function staticFiles(dir) {
  return express.static(dir, {
    index: false,        // "/" dilayani rute eksplisit, bukan tebakan direktori
    dotfiles: "ignore",
    redirect: false,
    setHeaders(res, filePath) {
      if (/\.(html|js)$/i.test(filePath)) {
        res.setHeader("Cache-Control", "no-store, must-revalidate");
      } else {
        res.setHeader("Cache-Control", "public, max-age=3600");
      }
    },
  });
}

module.exports = {
  requestLog, securityHeaders, rateLimit, bodyParsers, staticFiles, largeBodyGate,
  clientKey, limitStore, CSP,
};
