const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const server = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
const fmt = require("../lib/format");

test("keamanan: ADMIN_KEY dibandingkan tahan timing-attack", () => {
  assert.ok(server.includes("timingSafeEqual"), "harus pakai crypto.timingSafeEqual");
  assert.ok(
    !/x-admin-key"\) === key/.test(server),
    "perbandingan === langsung masih ada"
  );
});

test("keamanan: semua rute admin dibatasi percobaannya", () => {
  const rute = [...server.matchAll(/app\.post\(\s*"(\/api\/admin\/[^"]+)"([^)]*)/g)];
  assert.ok(rute.length >= 3, "harus ada minimal 3 rute admin");
  for (const [, jalur, sisa] of rute) {
    assert.ok(
      /adminGuard|rateLimit/.test(sisa),
      `${jalur} belum dibatasi rate limit — ADMIN_KEY bisa ditebak tanpa batas`
    );
  }
});

test("keamanan: batas ukuran body dibedakan per rute", () => {
  assert.ok(server.includes('limit: "16kb"'), "rute biasa harus dibatasi kecil");
  assert.ok(
    !/app\.use\(express\.json\(\{ limit: "25mb" \}\)\)/.test(server),
    "25 MB tidak boleh berlaku global"
  );
});

test("keamanan: header CSP & anti-clickjacking dipasang", () => {
  for (const h of [
    "Content-Security-Policy",
    "X-Content-Type-Options",
    "X-Frame-Options",
    "Strict-Transport-Security",
  ]) {
    assert.ok(server.includes(h), `header ${h} belum ada`);
  }
  assert.ok(server.includes("frame-ancestors 'none'"), "CSP harus melarang di-iframe");
});

test("keamanan: input panjang dipotong sebelum masuk email/log/Drive", () => {
  assert.ok(server.includes("const potong ="), "belum ada pemotongan panjang input");
});

test("keamanan: nama file & subject email bebas karakter berbahaya", () => {
  const jahat = 'Budi\r\nBcc: korban@example.com';
  const bersih = fmt.clean(jahat, 80);
  assert.ok(!bersih.includes("\r") && !bersih.includes("\n"),
    "newline harus hilang — kalau tidak, header email bisa disisipkan");
});

test("keamanan: path traversal pada nama tidak lolos ke nama folder", () => {
  const label = fmt.buildLabel({
    name: "../../etc/passwd", wa: "0812", takenAt: "2026-07-28T11:07:00Z", code: "OSC-X",
  });
  assert.ok(!label.includes("/"), "garis miring harus dibuang");
  assert.ok(!label.includes("\\"), "backslash harus dibuang");
});

test("keamanan: crash tak tertangani membuat proses keluar (bukan lanjut rusak)", () => {
  const blok = server.slice(server.indexOf('process.on("uncaughtException"'));
  assert.ok(/process\.exit\(1\)/.test(blok.slice(0, 500)),
    "harus keluar supaya platform menyalakan ulang dengan kondisi bersih");
});

test("produksi: ada health check untuk monitoring", () => {
  assert.ok(server.includes('app.get("/healthz"'), "endpoint /healthz belum ada");
});

test("produksi: menangani SIGTERM agar pesanan berjalan tidak hilang saat deploy", () => {
  assert.ok(server.includes('process.on("SIGTERM"'), "SIGTERM belum ditangani");
  assert.ok(server.includes("server.close("), "koneksi harus ditutup rapi");
});

test("keamanan: codes.json tidak ditulis langsung dengan fs di server.js", () => {
  assert.ok(
    !/fs\.writeFileSync\(CODES_FILE/.test(server),
    "penulisan langsung menyebabkan balapan data — harus lewat lib/store.js"
  );
});

/* -------- batas ukuran body: rute unggahan tidak boleh ikut kecil -------- */

test("body: SEMUA rute unggahan terdaftar di RUTE_BESAR", () => {
  // Bug nyata: /api/admin/template kena batas 16 KB dari middleware global,
  // sehingga unggah template gagal dengan 500 yang tidak menjelaskan apa pun.
  const daftar = server.slice(
    server.indexOf("const RUTE_BESAR"),
    server.indexOf("]);", server.indexOf("const RUTE_BESAR"))
  );
  for (const rute of ["/api/fallback-upload", "/api/admin/template", "/api/render-strip"]) {
    assert.ok(daftar.includes(rute), `${rute} belum terdaftar — unggahan akan gagal`);
  }
});

test("body: rute biasa tetap dibatasi kecil (anti habiskan memori)", () => {
  assert.ok(server.includes('limit: "16kb"'), "rute biasa harus 16 KB");
});

test("body: berkas kelewat besar dijawab 413 dengan penjelasan, bukan 500", () => {
  assert.ok(server.includes("entity.too.large"), "harus menangani galat ukuran body");
  assert.ok(server.includes("TOO_BIG"), "harus mengembalikan kode TOO_BIG");
});
