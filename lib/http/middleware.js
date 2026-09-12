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
const { createStore } = require("../ratelimit");
const { HTTP, LIMIT, ROUTE_BESAR } = require("../../public/shared/contract.js");

const limitStore = createStore();

/* Bersihkan bucket lama berkala supaya memori tidak menumpuk */
setInterval(() => limitStore.sweep(), LIMIT.SWEEP_MS).unref();

/**
 * Beri setiap permintaan ID pendek + catat hasilnya.
 * ID dipakai untuk menelusuri satu permintaan di seluruh log.
 */
function requestLog(log) {
  return (req, res, next) => {
    req.rid = crypto.randomBytes(3).toString("hex");
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

/** Header keamanan browser (CSP, anti-clickjacking, HSTS) */
function securityHeaders() {
  const csp = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: blob:",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ");

  return (req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "SAMEORIGIN");
    res.setHeader("Referrer-Policy", "same-origin");
    res.setHeader("Permissions-Policy", "camera=(self), geolocation=(), microphone=()");
    res.setHeader("Content-Security-Policy", csp);
    if (req.secure || req.get("x-forwarded-proto") === "https") {
      res.setHeader("Strict-Transport-Security", "max-age=15552000; includeSubDomains");
    }
    next();
  };
}

/**
 * Pembatas laju.
 * @param by fungsi penentu identitas. Default IP — TAPI ingat: IP ≠ perangkat.
 *           Operator seluler memakai CGNAT, ribuan pelanggan berbagi satu IP.
 *           Untuk rute yang punya token, batasi PER KODE lewat `by`.
 */
function rateLimit({ windowMs, max, key, by }, log) {
  return (req, res, next) => {
    const identitas = by ? by(req) : req.ip;
    const r = limitStore.hit(`${key}:${identitas}`, windowMs, max);
    if (r.allowed) return next();

    log.warn("ratelimit.block", {
      rid: req.rid, key, id: identitas, ip: req.ip, retryAfter: r.retryAfter,
    });
    res.setHeader("Retry-After", r.retryAfter);
    return res.status(HTTP.TOO_MANY_REQUESTS).json({
      ok: false, error: "TOO_MANY_REQUESTS", retryAfter: r.retryAfter,
    });
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
  requestLog, securityHeaders, rateLimit, bodyParsers, staticFiles, limitStore,
};
