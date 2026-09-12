const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

/**
 * buyBoxState() hidup di dalam <script> pada index.html.
 * Diambil langsung dari file itu supaya yang diuji benar-benar kode
 * yang dipakai pengunjung — bukan salinan yang bisa ketinggalan zaman.
 */
const html = fs.readFileSync(
  path.join(__dirname, "..", "public", "booth.html"),
  "utf8"
);

const mulai = html.indexOf("function buyBoxState(");
const selesai = html.indexOf("function renderBuyBox(");
assert.ok(mulai !== -1 && selesai > mulai, "buyBoxState tidak ditemukan di index.html");
const buyBoxState = new Function(
  html.slice(mulai, selesai) + "\nreturn buyBoxState;"
)();

const toko = (links, wa) => ({ links, waAdmin: wa || "" });

test("kotak beli: muncul kalau ada minimal satu link", () => {
  const st = buyBoxState(toko({ Tokopedia: "https://tokopedia.com/" }));
  assert.equal(st.visible, true);
  assert.ok(st.html.includes("https://tokopedia.com/"));
});

test("kotak beli: muncul kalau hanya WhatsApp yang diisi", () => {
  const st = buyBoxState(toko({}, "6281234567890"));
  assert.equal(st.visible, true);
  assert.ok(st.html.includes("wa.me/6281234567890"));
});

test("kotak beli: disembunyikan kalau semua kosong", () => {
  assert.equal(buyBoxState(toko({})).visible, false);
  assert.equal(buyBoxState(toko({ Shopee: "", Tokopedia: "   " })).visible, false);
});

test("kotak beli: link kosong tidak jadi tombol", () => {
  const st = buyBoxState(toko({ Shopee: "", Tokopedia: "https://tokopedia.com/" }));
  assert.equal((st.html.match(/<a /g) || []).length, 1, "hanya 1 tombol");
});

test("BUG LAMA: setelan datang belakangan harus tetap memunculkan kotak", () => {
  // render pertama: setelan dari server belum tiba → kotak kosong
  const kosong = buyBoxState(toko({ TikTok: "", Tokopedia: "", Shopee: "" }, ""));
  assert.equal(kosong.visible, false);

  // render kedua: setelan sudah tiba → HARUS terlihat lagi
  const terisi = buyBoxState(
    toko({ TikTok: "", Tokopedia: "https://tokopedia.com/", Shopee: "" }, "6281234567890")
  );
  assert.equal(terisi.visible, true, "kotak harus muncul kembali setelah setelan tiba");
});

test("kotak beli: semua tombol dibuka di tab baru dengan aman", () => {
  const st = buyBoxState(toko({ Shopee: "https://shopee.co.id/" }, "6281234567890"));
  const jumlahLink = (st.html.match(/<a /g) || []).length;
  assert.equal((st.html.match(/rel="noopener noreferrer"/g) || []).length, jumlahLink);
  assert.equal((st.html.match(/target="_blank"/g) || []).length, jumlahLink);
});

test("kotak beli: tombol ganjil dibuat selebar 2 kolom biar tidak menggantung", () => {
  const satu = buyBoxState(toko({ Shopee: "https://shopee.co.id/" }));
  assert.ok(satu.html.includes('class="wide"'), "1 tombol → lebar penuh");

  const dua = buyBoxState(
    toko({ Shopee: "https://shopee.co.id/", Tokopedia: "https://tokopedia.com/" })
  );
  assert.ok(!dua.html.includes('class="wide"'), "2 tombol → tidak perlu melebar");
});

test("kotak beli: pesan WhatsApp sudah ter-encode", () => {
  const st = buyBoxState(toko({}, "6281234567890"));
  assert.ok(st.html.includes("?text=Halo%2C%20saya%20mau%20beli"), "teks harus di-encode");
});

test("kotak beli: input aneh tidak bikin crash", () => {
  assert.equal(buyBoxState({}).visible, false);
  assert.equal(buyBoxState({ links: null }).visible, false);
  assert.equal(buyBoxState(undefined).visible, false);
});
