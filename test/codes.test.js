const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const CODES_FILE = path.join(__dirname, "..", "data", "codes.json");
const BACKUP = path.join(__dirname, "..", "data", "codes.test-backup.json");

// Semua tes menulis ke data/codes.json, jadi isi aslinya diamankan dulu.
test.before(() => {
  if (fs.existsSync(CODES_FILE)) fs.copyFileSync(CODES_FILE, BACKUP);
});
test.after(() => {
  if (fs.existsSync(BACKUP)) {
    fs.copyFileSync(BACKUP, CODES_FILE);
    fs.unlinkSync(BACKUP);
  } else if (fs.existsSync(CODES_FILE)) {
    fs.unlinkSync(CODES_FILE);
  }
});

const lib = require("../lib/codes");
const reset = () => fs.writeFileSync(CODES_FILE, "{}");

/* --------------------------- pembuatan kode --------------------------- */

test("generate: jumlah kode sesuai permintaan", () => {
  reset();
  const r = lib.generate(25, { writeFile: false });
  assert.equal(r.codes.length, 25);
  assert.equal(lib.stats().total, 25);
});

test("generate: semua kode unik", () => {
  reset();
  const r = lib.generate(500, { writeFile: false });
  assert.equal(new Set(r.codes).size, 500, "tidak boleh ada kode kembar");
});

test("generate: menambah, bukan menimpa batch sebelumnya", () => {
  reset();
  lib.generate(10, { writeFile: false });
  lib.generate(15, { writeFile: false });
  assert.equal(lib.stats().total, 25);
});

test("generate: tanpa huruf/angka yang membingungkan (0,O,1,I,L)", () => {
  reset();
  const r = lib.generate(200, { writeFile: false });
  for (const c of r.codes) {
    const badan = c.split("-")[1];
    assert.doesNotMatch(badan, /[01OIL]/, `kode ${c} mengandung karakter rancu`);
  }
});

test("generate: format kode PREFIX-6 karakter", () => {
  reset();
  const r = lib.generate(5, { writeFile: false });
  for (const c of r.codes) assert.match(c, /^[A-Z]+-[A-Z0-9]{6}$/);
});

/* ----------------------- pemisahan pool chatbot ----------------------- */

test("generate --chatbot: langsung ditandai sudah dibagikan", () => {
  reset();
  lib.generate(10, { forChatbot: true, writeFile: false });
  const s = lib.stats();
  assert.equal(s.chatbotStock, 10);
  assert.equal(s.available, 0, "kode chatbot tidak boleh masuk stok admin");
});

test("generate biasa: masuk stok admin, bukan chatbot", () => {
  reset();
  lib.generate(8, { writeFile: false });
  const s = lib.stats();
  assert.equal(s.available, 8);
  assert.equal(s.chatbotStock, 0);
});

test("tombol admin tidak pernah membagikan kode milik chatbot", () => {
  reset();
  const bot = lib.generate(10, { forChatbot: true, writeFile: false });
  lib.generate(3, { writeFile: false });

  // tiru perilaku /api/admin/next-code
  const codes = lib.load();
  const dibagikan = [];
  for (let i = 0; i < 10; i++) {
    const entry = Object.entries(codes).find(([, v]) => !v.issued && !v.used);
    if (!entry) break;
    entry[1].issued = true;
    dibagikan.push(entry[0]);
  }
  lib.save(codes);

  assert.equal(dibagikan.length, 3, "hanya stok admin yang boleh keluar");
  const bocor = dibagikan.filter((c) => bot.codes.includes(c));
  assert.equal(bocor.length, 0, "kode chatbot bocor lewat tombol admin");
});

/* ------------------------------ statistik ------------------------------ */

test("stats: hitungan tiap kategori benar", () => {
  reset();
  lib.generate(10, { forChatbot: true, writeFile: false }); // pool chatbot
  lib.generate(4, { writeFile: false }); // stok admin

  const codes = lib.load();
  let manual = 0;
  for (const v of Object.values(codes)) {
    if (!v.issued && !v.used && manual < 2) { v.issued = true; v.buyer = "WA Budi"; manual++; }
  }
  let dipakai = 0;
  for (const v of Object.values(codes)) {
    if (v.buyer === "(batch chatbot)" && !v.used && dipakai < 3) { v.used = true; dipakai++; }
  }
  lib.save(codes);

  const s = lib.stats();
  assert.equal(s.total, 14);
  assert.equal(s.redeemed, 3);
  assert.equal(s.chatbotStock, 7, "10 chatbot - 3 dipakai");
  assert.equal(s.available, 2, "4 admin - 2 dibagikan manual");
  assert.equal(s.adminIssued, 2);
});

/* ------------------------------- batasan ------------------------------- */

test("generate: jumlah dibatasi maksimal 5000", () => {
  reset();
  const r = lib.generate(99999, { writeFile: false });
  assert.equal(r.codes.length, 5000);
});

test("generate: angka tidak masuk akal ditangani konsisten", () => {
  reset();
  assert.equal(lib.generate(0, { writeFile: false }).codes.length, 1, "0 → minimal 1");
  assert.equal(lib.generate(-5, { writeFile: false }).codes.length, 1, "negatif → minimal 1");
  assert.equal(lib.generate(10.7, { writeFile: false }).codes.length, 10, "desimal dibulatkan bawah");
  assert.equal(lib.generate("abc", { writeFile: false }).codes.length, 20, "bukan angka → default 20");
  assert.equal(lib.generate(undefined, { writeFile: false }).codes.length, 20, "kosong → default 20");
});
