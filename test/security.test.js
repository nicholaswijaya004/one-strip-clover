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
  const { LIMIT, ROUTE_BESAR } = require("../public/shared/contract.js");
  assert.equal(LIMIT.BODY_KECIL, "16kb", "rute biasa harus dibatasi kecil");
  assert.equal(LIMIT.BODY_BESAR, "25mb");
  assert.ok(
    !/app\.use\(express\.json\(\{ limit: LIMIT\.BODY_BESAR \}\)\)/.test(server),
    "badan besar tidak boleh berlaku global"
  );
  assert.ok(ROUTE_BESAR.length >= 3, "daftar rute besar harus lengkap");
});

test("keamanan: header CSP & anti-clickjacking dipasang", () => {
  const server = fs.readFileSync(
    path.join(__dirname, "..", "lib", "http", "middleware.js"), "utf8"
  );
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

test("body: SEMUA rute unggahan terdaftar di ROUTE_BESAR", () => {
  // Bug nyata: /api/admin/template kena batas 16 KB dari middleware global,
  // sehingga unggah template gagal dengan 500 yang tidak menjelaskan apa pun.
  const { ROUTE, ROUTE_BESAR } = require("../public/shared/contract.js");
  for (const rute of [ROUTE.ORDER, ROUTE.ADMIN_TEMPLATE, ROUTE.RENDER]) {
    assert.ok(ROUTE_BESAR.includes(rute), `${rute} belum terdaftar — unggahan akan gagal`);
  }
});

test("body: rute biasa tetap dibatasi kecil (anti habiskan memori)", () => {
  const { LIMIT } = require("../public/shared/contract.js");
  const mw = fs.readFileSync(
    path.join(__dirname, "..", "lib", "http", "middleware.js"), "utf8"
  );
  assert.equal(LIMIT.BODY_KECIL, "16kb", "rute biasa harus 16 KB");
  assert.ok(mw.includes("LIMIT.BODY_KECIL"), "middleware harus memakai konstanta itu");
});

test("body: berkas kelewat besar dijawab 413 dengan penjelasan, bukan 500", () => {
  assert.ok(server.includes("entity.too.large"), "harus menangani galat ukuran body");
  assert.ok(server.includes("TOO_BIG"), "harus mengembalikan kode TOO_BIG");
});

/* -------------------- pengirim & tujuan balasan email -------------------- */

test("email: pengirim SELALU alamat studio, bukan alamat pembeli", () => {
  const delivery = fs.readFileSync(
    path.join(__dirname, "..", "lib", "delivery.js"), "utf8"
  );
  assert.ok(
    delivery.includes("from: env.SMTP_FROM || env.SMTP_USER"),
    "pengirim harus dari setelan server"
  );
  assert.ok(
    !/from:\s*o\.email/.test(delivery),
    "email pembeli TIDAK boleh dipakai sebagai pengirim (akan ditolak Gmail & dianggap spoofing)"
  );
});

test("email: balasan diarahkan ke pembeli kalau emailnya valid", () => {
  const delivery = fs.readFileSync(
    path.join(__dirname, "..", "lib", "delivery.js"), "utf8"
  );
  assert.ok(delivery.includes("replyTo"), "harus mengatur replyTo");
  assert.ok(delivery.includes("balasKe"), "replyTo diambil dari email pembeli");
});

test("email: email pembeli tidak valid → tanpa replyTo (tidak error)", () => {
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  for (const jelek of ["", "  ", "bukan-email", "a@b", null, undefined]) {
    assert.equal(re.test(String(jelek || "").trim()), false);
  }
  assert.equal(re.test("daniel@gmail.com"), true);
});

/* ------------------------- pipeline CI ------------------------- */

test("CI: workflow tes, review, dan asisten tersedia", () => {
  const dir = path.join(__dirname, "..", ".github", "workflows");
  for (const f of ["ci.yml", "claude-review.yml", "claude-assistant.yml"]) {
    assert.ok(fs.existsSync(path.join(dir, f)), `workflow ${f} hilang`);
  }
});

test("CI: ada penjaga agar .env & data/ tidak ikut ter-commit", () => {
  const ci = fs.readFileSync(
    path.join(__dirname, "..", ".github", "workflows", "ci.yml"), "utf8"
  );
  assert.match(ci, /git ls-files --error-unmatch/, "harus memeriksa berkas terlacak");
  assert.ok(ci.includes("data/codes.json"), "codes.json harus dijaga");
  assert.ok(ci.includes('".env"'), ".env harus dijaga");
});

test("CI: ambang cakupan dipasang (PR yang menurunkan cakupan gagal)", () => {
  const pkg = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8")
  );
  const cov = pkg.scripts["test:coverage"];
  assert.ok(cov, "skrip test:coverage belum ada");
  assert.match(cov, /--test-coverage-lines=\d+/, "ambang baris belum dipasang");
  assert.match(cov, /--test-coverage-functions=\d+/, "ambang fungsi belum dipasang");
  assert.match(cov, /--test-coverage-branches=\d+/, "ambang cabang belum dipasang");
});

test("CI: smoke test memastikan endpoint admin menolak tanpa kunci", () => {
  const ci = fs.readFileSync(
    path.join(__dirname, "..", ".github", "workflows", "ci.yml"), "utf8"
  );
  assert.ok(ci.includes("/api/admin/stats"), "harus menguji endpoint admin");
  assert.ok(ci.includes('"401"'), "harus memastikan tanpa kunci ditolak 401");
});

test("CI: .gitignore menutup rahasia & data jalan", () => {
  const gi = fs.readFileSync(path.join(__dirname, "..", ".gitignore"), "utf8");
  for (const pola of [".env", "data/", "node_modules/"]) {
    assert.ok(gi.includes(pola), `.gitignore harus memuat ${pola}`);
  }
});

/* ---------- tes tidak boleh menyentuh data produksi ---------- */

test("tes: setiap berkas tes yang memakai modul data WAJIB terisolasi", () => {
  // Bug nyata: `npm test` dulu menulis ke data/codes.json ASLI —
  // kode yang sudah dijual ikut tertimpa. Sekarang tiap berkas tes
  // mengarahkan DATA_DIR ke folder sementara lewat test/_setup.js.
  const dir = __dirname;
  const modulData = /require\("\.\.\/lib\/(codes|template|settings|queue|logger)"\)/;
  const kurang = [];

  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".test.js"))) {
    const isi = fs.readFileSync(path.join(dir, f), "utf8");
    if (!modulData.test(isi)) continue;
    const barisPertama = isi.split("\n")[0];
    if (!barisPertama.includes("_setup")) kurang.push(f);
  }

  assert.deepEqual(
    kurang, [],
    "berkas ini menulis ke data ASLI — tambahkan di baris pertama:\n" +
      '  require("./_setup").pakaiDataSementara();'
  );
});

test("data: lokasi folder diambil dari satu tempat (lib/paths.js)", () => {
  const libDir = path.join(__dirname, "..", "lib");
  const salah = [];
  for (const f of fs.readdirSync(libDir).filter((f) => f.endsWith(".js"))) {
    if (f === "paths.js") continue;
    const isi = fs.readFileSync(path.join(libDir, f), "utf8");
    if (/path\.join\(__dirname,\s*"\.\.",\s*"data"/.test(isi)) salah.push(f);
  }
  assert.deepEqual(salah, [], "modul ini menghitung path data sendiri — pakai lib/paths.js");
});

/* ---------- kontrak bersama: tidak ada teks ajaib yang tercecer ---------- */

test("kontrak: server tidak menulis kode error sebagai teks mentah", () => {
  // Dulu "SPENT" ditulis langsung di server.js DAN booth.html. Salah ketik
  // di salah satu sisi tidak ketahuan sampai ada pembeli melihat pesan kosong.
  const mentah = [...server.matchAll(/error:\s*"([A-Z_]{3,})"/g)].map((m) => m[1]);
  assert.deepEqual(
    mentah, [],
    "pakai ERR.<NAMA> dari public/shared/contract.js, jangan teks mentah"
  );
});

test("kontrak: browser memakai kode error yang SAMA dengan server", () => {
  const booth = fs.readFileSync(
    path.join(__dirname, "..", "public", "booth.html"), "utf8"
  );
  const mentah = [...booth.matchAll(/d\.error\s*===\s*"([A-Z_]{3,})"/g)].map((m) => m[1]);
  assert.deepEqual(mentah, [], "browser harus membandingkan dengan ERR.<NAMA>");
  assert.ok(booth.includes('src="/shared/contract.js"'), "kontrak harus dimuat halaman");
});

test("kontrak: setiap kode error yang dipakai server benar-benar ada", () => {
  const { ERR } = require("../public/shared/contract.js");
  const dipakai = [...server.matchAll(/ERR\.([A-Z_]+)/g)].map((m) => m[1]);
  const hilang = [...new Set(dipakai)].filter((k) => ERR[k] === undefined);
  assert.deepEqual(hilang, [], "kode error ini belum didaftarkan di contract.js");
});

test("kontrak: angka status HTTP tidak ditulis mentah di server", () => {
  const mentah = [...server.matchAll(/\.status\((\d{3})\)/g)].map((m) => m[1]);
  assert.deepEqual(mentah, [], "pakai HTTP.<NAMA> dari contract.js");
});

test("SRP: server.js hanya merangkai — middleware ada di modulnya sendiri", () => {
  assert.ok(
    fs.existsSync(path.join(__dirname, "..", "lib", "http", "middleware.js")),
    "middleware harus terpisah dari server.js"
  );
  const baris = server.split("\n").length;
  assert.ok(baris < 1000, `server.js ${baris} baris — terlalu besar, pecah lagi`);
});
