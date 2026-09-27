require("./_setup").pakaiDataSementara();
/**
 * TES HTTP SUNGGUHAN — menyalakan app Express lalu menyerangnya lewat jaringan.
 *
 * Tes lain banyak memeriksa isi berkas (grep). Itu murah tapi rapuh: kode
 * bisa ada tapi tidak terpasang di urutan yang benar. Di sini yang diuji
 * adalah PERILAKU yang dilihat penyerang: status, header, dan isi respons.
 */
process.env.ADMIN_KEY = "kunci-admin-uji-yang-panjang-sekali";
process.env.SESSION_SECRET = "rahasia-sesi-uji-yang-panjangnya-lebih-dari-32";
delete process.env.SMTP_HOST;

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("http");

const { app } = require("../server");
const codeLib = require("../lib/codes");
const { createTokens } = require("../lib/tokens");
const { ERR } = require("../public/shared/contract.js");

let base;
let srv;
let ipKe = 0;
// Tiap tes memakai "IP" berbeda (lewat X-Forwarded-For, dipercaya 1 hop)
// supaya rate limit satu tes tidak memengaruhi tes lain.
const ipBaru = () => `10.0.${Math.floor(++ipKe / 250)}.${ipKe % 250}`;

test.before(async () => {
  srv = http.createServer(app);
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${srv.address().port}`;
});
test.after(() => srv.close());

async function kirim(pathname, { method = "POST", body, headers = {}, ip = ipBaru(), raw } = {}) {
  const res = await fetch(base + pathname, {
    method,
    headers: {
      "x-forwarded-for": ip,
      ...(body !== undefined || raw !== undefined ? { "content-type": "application/json" } : {}),
      ...headers,
    },
    body: raw !== undefined ? raw : body !== undefined ? JSON.stringify(body) : undefined,
  });
  let data;
  const teks = await res.text();
  try { data = JSON.parse(teks); } catch { data = teks; }
  return { status: res.status, headers: res.headers, data };
}

/** JPEG minimal yang valid di tingkat header (cukup untuk validasi server) */
function jpeg(w, h) {
  const app0 = Buffer.from([0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 1, 1, 0, 0, 1, 0, 1, 0, 0]);
  const sof = Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08, h >> 8, h & 255, w >> 8, w & 255, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, sof, Buffer.from([0xff, 0xd9])]);
}
const dataUrl = (buf, mime = "image/jpeg") => `data:${mime};base64,${buf.toString("base64")}`;

/* ------------------------------ header ------------------------------ */

test("http: halaman depan hidup dengan header keamanan lengkap", async () => {
  const r = await kirim("/", { method: "GET" });
  assert.equal(r.status, 200);
  const csp = r.headers.get("content-security-policy");
  assert.match(csp, /script-src 'self'(;|$)/, "script-src tidak boleh mengizinkan skrip inline");
  assert.ok(!/script-src[^;]*unsafe-inline/.test(csp));
  assert.match(csp, /frame-ancestors 'none'/);
  assert.match(csp, /object-src 'none'/);
  assert.equal(r.headers.get("x-frame-options"), "DENY");
  assert.equal(r.headers.get("x-content-type-options"), "nosniff");
  assert.equal(r.headers.get("x-powered-by"), null, "jangan umumkan Express");
  assert.ok(r.headers.get("x-request-id"));
});

test("http: /booth dan /admin hidup", async () => {
  for (const p of ["/booth", "/admin"]) {
    assert.equal((await kirim(p, { method: "GET" })).status, 200, p);
  }
});

test("http: halaman tidak memuat skrip inline (CSP akan memblokirnya)", async () => {
  for (const p of ["/", "/booth", "/admin"]) {
    const { data } = await kirim(p, { method: "GET" });
    assert.ok(!/<script>(?!<\/script>)/.test(data), `${p} masih punya <script> inline`);
    assert.ok(!/\son[a-z]+="/i.test(data), `${p} punya handler inline (onclick=…)`);
  }
});

test("http: respons API tidak boleh di-cache", async () => {
  const r = await kirim("/api/config", { method: "GET" });
  assert.equal(r.status, 200);
  assert.match(r.headers.get("cache-control"), /no-store/);
});

test("http: rute API tak dikenal → 404 JSON, JSON rusak → 400", async () => {
  const a = await kirim("/api/tidak-ada", { method: "GET" });
  assert.equal(a.status, 404);
  assert.equal(a.data.error, ERR.NOT_FOUND);
  const b = await kirim("/api/redeem", { raw: "{rusak" });
  assert.equal(b.status, 400);
});

/* ------------------- gerbang body besar (anti DoS) ------------------- */

test("http: unggahan tanpa token DITOLAK sebelum body besar dibaca", async () => {
  // 2 MB sampah tanpa token → 403, bukan diparse dulu
  const besar = JSON.stringify({ photos: ["x".repeat(2 * 1024 * 1024)] });
  for (const p of ["/api/fallback-upload", "/api/render-strip"]) {
    const r = await kirim(p, { raw: besar });
    assert.equal(r.status, 403, p);
    assert.equal(r.data.error, ERR.PREMIUM_REQUIRED);
  }
});

test("http: token di BODY saja tidak cukup (harus header)", async () => {
  const tok = createTokens({ secret: process.env.SESSION_SECRET, hours: 1 }).make("OSC-TIDAKADA");
  const r = await kirim("/api/fallback-upload", { body: { token: tok } });
  assert.equal(r.status, 403);
});

test("http: token palsu ditolak", async () => {
  const palsu = createTokens({ secret: "rahasia-lain-yang-bukan-milik-server-ini!!", hours: 1 }).make("OSC-AAAA");
  const r = await kirim("/api/render-strip", { body: {}, headers: { authorization: `Bearer ${palsu}` } });
  assert.equal(r.status, 403);
});

test("http: unggah template tanpa kunci admin → 401 sebelum body dibaca", async () => {
  const r = await kirim("/api/admin/template", { raw: JSON.stringify({ image: "x".repeat(1024 * 1024) }) });
  assert.equal(r.status, 401);
});

test("http: body besar di rute biasa → 413", async () => {
  const r = await kirim("/api/redeem", { body: { code: "x".repeat(40 * 1024) } });
  assert.equal(r.status, 413);
});

/* ------------------------------ redeem ------------------------------ */

test("http: redeem menolak tipe aneh tanpa 500", async () => {
  const ip = ipBaru();
  for (const code of [{}, [], 123, null, "   ", "A".repeat(200)]) {
    const r = await kirim("/api/redeem", { body: { code }, ip });
    assert.ok(r.status === 400 || r.status === 404, `code=${JSON.stringify(code)} → ${r.status}`);
  }
});

test("http: redeem tidak menyentuh prototipe objek", async () => {
  const ip = ipBaru();
  for (const code of ["__proto__", "constructor", "toString", "hasOwnProperty"]) {
    const r = await kirim("/api/redeem", { body: { code }, ip });
    assert.equal(r.status, 404, code);
  }
});

test("http: penebak kode diblokir setelah batas kegagalan", async () => {
  const ip = ipBaru();
  let terblokir = false;
  for (let i = 0; i < 20; i++) {
    const r = await kirim("/api/redeem", { body: { code: `OSC-TEBAK${i}` }, ip });
    if (r.status === 429) { terblokir = true; break; }
  }
  assert.ok(terblokir, "tebakan tanpa batas");
});

test("http: rotasi alamat IPv6 dalam satu /64 tetap dihitung satu penebak", async () => {
  let terblokir = false;
  for (let i = 0; i < 20; i++) {
    const ip = `2001:db8:1234:5678::${(i + 1).toString(16)}`;
    const r = await kirim("/api/redeem", { body: { code: `OSC-V6TEBAK${i}` }, ip });
    if (r.status === 429) { terblokir = true; break; }
  }
  assert.ok(terblokir, "ganti alamat IPv6 = lolos rate limit");
});

test("http: alur lengkap redeem → sesi → pesanan (validasi foto)", async () => {
  const [kode] = codeLib.generate(1, { writeFile: false }).codes;
  assert.match(kode, /^OSC-[A-Z2-9]{8}$/);
  const ip = ipBaru();

  const r = await kirim("/api/redeem", { body: { code: kode.toLowerCase(), deviceId: "hp-1" }, ip });
  assert.equal(r.status, 200);
  assert.ok(r.data.token);

  const s = await kirim("/api/session", { body: { token: r.data.token }, ip });
  assert.equal(s.data.ok, true);
  assert.equal(s.data.code, kode);
  assert.equal(s.data.maxSubmissions, 1, "jatah dari setelan, bukan env mentah");

  const auth = { authorization: `Bearer ${r.data.token}` };
  const dasar = {
    consent: true, name: "Uji", email: "uji@contoh.id",
    address: "Jl. Pengujian No. 1, Jakarta", photos: [],
  };

  // "foto" berisi HTML → ditolak
  const palsu = await kirim("/api/fallback-upload", {
    ip, headers: auth,
    body: { ...dasar, photos: [dataUrl(Buffer.from("<html><script>alert(1)</script></html>"))] },
  });
  assert.equal(palsu.status, 400);
  assert.equal(palsu.data.error, ERR.BAD_PHOTO);

  // bom dekompresi (header mengaku 30.000 x 30.000) → ditolak tanpa decode
  const bom = await kirim("/api/fallback-upload", {
    ip, headers: auth, body: { ...dasar, photos: [dataUrl(jpeg(30000, 30000))] },
  });
  assert.equal(bom.status, 400);
  assert.equal(bom.data.error, ERR.BAD_PHOTO);

  // foto sah → lolos validasi (lalu gagal karena email belum diatur di tes)
  const sah = await kirim("/api/fallback-upload", {
    ip, headers: auth, body: { ...dasar, photos: [dataUrl(jpeg(1280, 1024))] },
  });
  assert.notEqual(sah.data.error, ERR.BAD_PHOTO);
  assert.equal(sah.data.errors, undefined, "detail error SMTP/Drive tidak boleh bocor ke browser");
});

/* ------------------------------ healthz ------------------------------ */

test("http: /healthz publik tidak membocorkan info bisnis", async () => {
  const r = await kirim("/healthz", { method: "GET" });
  assert.equal(r.status, 200);
  assert.equal(r.data.ok, true);
  for (const k of ["chatbotStock", "email", "drive", "pendingOrders"]) {
    assert.equal(r.data[k], undefined, `${k} bocor ke publik`);
  }
});

test("http: /healthz detail hanya dengan kunci admin", async () => {
  const salah = await kirim("/healthz", { method: "GET", headers: { "x-admin-key": "salah" } });
  assert.equal(salah.status, 401);
  const benar = await kirim("/healthz", { method: "GET", headers: { "x-admin-key": process.env.ADMIN_KEY } });
  assert.equal(benar.status, 200);
  assert.equal(typeof benar.data.chatbotStock, "number");
});

/* ------------------------------ admin ------------------------------ */

test("http: semua rute admin menolak tanpa kunci", async () => {
  for (const p of ["stats", "next-code", "generate", "logs", "unbind", "settings", "template"]) {
    const r = await kirim(`/api/admin/${p}`, { body: {} });
    assert.equal(r.status, 401, p);
  }
});

test("http: admin generate menolak jumlah bukan bilangan bulat & tidak membocorkan error", async () => {
  const h = { "x-admin-key": process.env.ADMIN_KEY };
  for (const n of [0, -1, 1.5, "abc", 999999]) {
    const r = await kirim("/api/admin/generate", { body: { n }, headers: h });
    assert.equal(r.status, 400, `n=${n}`);
  }
  const ok = await kirim("/api/admin/generate", { body: { n: 3, forChatbot: true }, headers: h });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.codes.length, 3);
});

test("http: nama pembeli dibersihkan dari karakter HTML", async () => {
  const h = { "x-admin-key": process.env.ADMIN_KEY };
  await kirim("/api/admin/generate", { body: { n: 1, forChatbot: false }, headers: h });
  const r = await kirim("/api/admin/next-code", { body: { buyer: '<img src=x onerror=alert(1)>' }, headers: h });
  assert.equal(r.status, 200);
  const st = await kirim("/api/admin/stats", { body: {}, headers: h });
  const b = st.data.recent.find((x) => x.code === r.data.code).buyer;
  assert.ok(!/[<>]/.test(b), b);
});

test("http: template palsu (bukan PNG/JPEG sungguhan) ditolak", async () => {
  const h = { "x-admin-key": process.env.ADMIN_KEY };
  const r = await kirim("/api/admin/template", {
    headers: h, body: { image: dataUrl(Buffer.from("<svg onload=alert(1)>"), "image/png") },
  });
  assert.equal(r.status, 400);
});


