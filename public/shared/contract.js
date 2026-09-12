/**
 * KONTRAK ERROR & BATASAN — DIPAKAI SERVER *DAN* BROWSER
 *
 * Kenapa satu berkas:
 *   Kode error seperti "SPENT" dulu ditulis sebagai teks mentah di dua
 *   tempat — server.js mengirimnya, booth.html memeriksanya. Salah ketik di
 *   salah satu sisi tidak akan ketahuan sampai ada pembeli yang melihat
 *   pesan kosong. Sekarang keduanya mengimpor konstanta yang sama, jadi
 *   salah ketik langsung terlihat (undefined), bukan diam-diam gagal.
 *
 * Prinsip: satu sumber kebenaran (DRY) + tergantung pada abstraksi, bukan
 * pada teks literal yang tersebar (Dependency Inversion).
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.OSC = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /** Kode error yang dikirim server → dibaca browser */
  var ERR = {
    // --- penukaran kode ---
    EMPTY: "EMPTY",                       // kolom kode kosong
    INVALID: "INVALID",                   // kode tidak terdaftar
    USED: "USED",                         // lewat batas waktu, belum memesan
    SPENT: "SPENT",                       // sudah dipakai memesan → mati
    OTHER_DEVICE: "OTHER_DEVICE",         // dipakai di perangkat lain

    // --- akses ---
    PREMIUM_REQUIRED: "PREMIUM_REQUIRED",
    UNAUTHORIZED: "UNAUTHORIZED",

    // --- pesanan studio ---
    CONSENT_REQUIRED: "CONSENT_REQUIRED",
    NAME_REQUIRED: "NAME_REQUIRED",
    CONTACT_REQUIRED: "CONTACT_REQUIRED",
    ADDRESS_REQUIRED: "ADDRESS_REQUIRED",
    BAD_EMAIL: "BAD_EMAIL",
    BAD_WA: "BAD_WA",
    NO_PHOTOS: "NO_PHOTOS",
    TOO_MANY: "TOO_MANY",
    SUBMISSION_LIMIT: "SUBMISSION_LIMIT",
    ALREADY_PROCESSING: "ALREADY_PROCESSING",
    DELIVERY_FAILED: "DELIVERY_FAILED",
    NOT_CONFIGURED: "NOT_CONFIGURED",

    // --- template & render ---
    NO_TEMPLATE: "NO_TEMPLATE",
    BAD_IMAGE: "BAD_IMAGE",
    BAD_PHOTO: "BAD_PHOTO",
    RENDER_UNAVAILABLE: "RENDER_UNAVAILABLE",
    RENDER_FAILED: "RENDER_FAILED",

    // --- stok kode ---
    OUT_OF_STOCK: "OUT_OF_STOCK",
    BAD_COUNT: "BAD_COUNT",
    GENERATE_FAILED: "GENERATE_FAILED",

    // --- umum ---
    BAD_REQUEST: "BAD_REQUEST",
    NOT_FOUND: "NOT_FOUND",
    TOO_BIG: "TOO_BIG",
    TOO_MANY_REQUESTS: "TOO_MANY_REQUESTS",
    SERVER_ERROR: "SERVER_ERROR",

    // --- hanya dibuat di sisi browser ---
    NETWORK: "NETWORK",
    TIMEOUT: "TIMEOUT",
  };

  /** Status hasil penukaran (dipakai lib/redeem.js) */
  var REDEEM = {
    OK: "ok",
    REENTRY: "reentry",
    SPENT: "spent",
    USED: "used",
    OTHER_DEVICE: "other_device",
    INVALID: "invalid",
  };

  /** Kode status HTTP — supaya angka 409/413 tidak tersebar sebagai angka ajaib */
  var HTTP = {
    OK: 200,
    BAD_REQUEST: 400,
    UNAUTHORIZED: 401,
    FORBIDDEN: 403,
    NOT_FOUND: 404,
    CONFLICT: 409,
    PAYLOAD_TOO_LARGE: 413,
    TOO_MANY_REQUESTS: 429,
    SERVER_ERROR: 500,
    NOT_IMPLEMENTED: 501,
    BAD_GATEWAY: 502,
    UNAVAILABLE: 503,
  };

  /** Batas & ukuran — semua angka ajaib dikumpulkan di sini */
  var LIMIT = {
    // ukuran badan permintaan
    BODY_KECIL: "16kb",
    BODY_BESAR: "25mb",

    // panjang input (mencegah log & email membengkak)
    NAMA: 80,
    CATATAN: 500,
    ALAMAT: 400,
    EMAIL: 120,
    WA: 25,
    ALAMAT_MIN: 12,
    DEVICE_ID: 64,
    LABEL: 180,

    // foto
    FOTO_MAKS: 8,

    // rate limit: [jendela ms, maksimal]
    REDEEM_WINDOW_MS: 15 * 60 * 1000,
    REDEEM_MAKS_GAGAL: 15,
    UPLOAD_WINDOW_MS: 60 * 60 * 1000,
    UPLOAD_MAKS: 120,
    RENDER_IP_MAKS: 300,
    RENDER_KODE_MAKS: 30,
    ADMIN_WINDOW_MS: 15 * 60 * 1000,
    ADMIN_MAKS: 60,
    GENERATE_MAKS: 20,

    // lain-lain
    KODE_MAKS_SEKALI: 2000,
    TEMPLATE_MAKS_BYTE: 8 * 1024 * 1024,
    KUNCI_BASI_MS: 2 * 60 * 1000,
    SWEEP_MS: 10 * 60 * 1000,
    SHUTDOWN_MS: 25 * 1000,
  };

  /** Nama rute — dipakai server & browser, tidak ada teks "/api/..." tersebar */
  var ROUTE = {
    CONFIG: "/api/config",
    REDEEM: "/api/redeem",
    SESSION: "/api/session",
    ORDER: "/api/fallback-upload",
    RENDER: "/api/render-strip",
    TEMPLATE: "/api/template",
    TEMPLATE_IMAGE: "/api/template/image",
    HEALTH: "/healthz",
    ADMIN_STATS: "/api/admin/stats",
    ADMIN_NEXT: "/api/admin/next-code",
    ADMIN_GENERATE: "/api/admin/generate",
    ADMIN_LOGS: "/api/admin/logs",
    ADMIN_UNBIND: "/api/admin/unbind",
    ADMIN_SETTINGS: "/api/admin/settings",
    ADMIN_TEMPLATE: "/api/admin/template",
  };

  /** Rute yang boleh menerima badan besar (foto / template) */
  var ROUTE_BESAR = [ROUTE.ORDER, ROUTE.RENDER, ROUTE.ADMIN_TEMPLATE];

  return { ERR: ERR, REDEEM: REDEEM, HTTP: HTTP, LIMIT: LIMIT, ROUTE: ROUTE, ROUTE_BESAR: ROUTE_BESAR };
});
