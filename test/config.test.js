const test = require("node:test");
const assert = require("node:assert/strict");
const { buildPublicConfig, bersih, nomorWa } = require("../lib/config");

test("config: link & harga dari .env diteruskan apa adanya", () => {
  const c = buildPublicConfig({
    PREMIUM_PRICE: "Rp 15.000",
    SHOP_TIKTOK: "https://vt.tiktok.com/abc",
    SHOP_TOKOPEDIA: "https://tokopedia.com/toko/produk",
    SHOP_SHOPEE: "https://shopee.co.id/product/1/2",
    SHOP_WHATSAPP: "6281234567890",
  });
  assert.equal(c.price, "Rp 15.000");
  assert.equal(c.shops.tiktok, "https://vt.tiktok.com/abc");
  assert.equal(c.shops.whatsapp, "6281234567890");
  assert.equal(c.hasShop, true);
});

test("config: .env kosong → tidak ada toko yang tampil", () => {
  const c = buildPublicConfig({});
  assert.equal(c.price, "");
  assert.equal(c.hasShop, false);
  assert.deepEqual(Object.values(c.shops), ["", "", "", ""]);
});

test("config: placeholder yang belum diganti tidak dianggap link", () => {
  const c = buildPublicConfig({
    SHOP_TIKTOK: "https://vt.tiktok.com/...",
    SHOP_SHOPEE: "https://example.com/produk",
  });
  assert.equal(c.shops.tiktok, "", "link contoh dengan ... harus diabaikan");
  assert.equal(c.shops.shopee, "", "example.com harus diabaikan");
  assert.equal(c.hasShop, false);
});

test("config: hanya http/https yang diterima (anti javascript:)", () => {
  const c = buildPublicConfig({
    SHOP_TOKOPEDIA: "javascript:alert(1)",
    SHOP_SHOPEE: "tokopedia.com/tanpa-protokol",
    SHOP_TIKTOK: "http://boleh.test/x",
  });
  assert.equal(c.shops.tokopedia, "", "skema berbahaya harus ditolak");
  assert.equal(c.shops.shopee, "", "tanpa http(s) ditolak");
  assert.equal(c.shops.tiktok, "http://boleh.test/x");
});

test("config: nomor WhatsApp dibersihkan jadi angka saja", () => {
  assert.equal(nomorWa("+62 812-1234-5678"), "6281212345678");
  assert.equal(nomorWa("(62) 812 3456 7890"), "6281234567890");
});

test("config: nomor WhatsApp tidak masuk akal ditolak", () => {
  assert.equal(nomorWa("123"), "", "terlalu pendek");
  assert.equal(nomorWa("1234567890123456789"), "", "terlalu panjang");
  assert.equal(nomorWa(""), "");
  assert.equal(nomorWa(null), "");
});

test("config: spasi di awal/akhir dirapikan", () => {
  const c = buildPublicConfig({ PREMIUM_PRICE: "  Rp 20.000  " });
  assert.equal(c.price, "Rp 20.000");
});

test("config: hasShop true kalau salah satu saja terisi", () => {
  assert.equal(buildPublicConfig({ SHOP_WHATSAPP: "6281234567890" }).hasShop, true);
  assert.equal(buildPublicConfig({ SHOP_SHOPEE: "https://a.test/x" }).hasShop, true);
});

test("config: nilai sesi memakai default kalau .env kosong", () => {
  const c = buildPublicConfig({});
  assert.equal(c.sessionHours, 3);
  assert.equal(c.graceHours, 3);
});

test("config: rahasia server tidak ikut terkirim ke pengunjung", () => {
  const c = buildPublicConfig({
    SMTP_PASS: "rahasia-banget",
    ADMIN_KEY: "kunci-admin",
    SESSION_SECRET: "secret",
    GOOGLE_REFRESH_TOKEN: "token",
    SHOP_SHOPEE: "https://a.test/x",
  });
  const teks = JSON.stringify(c);
  for (const bocor of ["rahasia-banget", "kunci-admin", "secret", "token"]) {
    assert.ok(!teks.includes(bocor), `${bocor} bocor ke config publik!`);
  }
});
