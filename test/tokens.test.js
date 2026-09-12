const test = require("node:test");
const assert = require("node:assert/strict");
const { createTokens } = require("../lib/tokens");

const SECRET = "rahasia-uji-coba-panjang";

test("token: kode kembali utuh setelah verify", () => {
  const t = createTokens({ secret: SECRET });
  const token = t.make("OSC-ABC123");
  const data = t.verify(token);
  assert.ok(data, "token seharusnya valid");
  assert.equal(data.code, "OSC-ABC123");
});

test("token: tanda tangan diubah → ditolak", () => {
  const t = createTokens({ secret: SECRET });
  const token = t.make("OSC-ABC123");
  assert.equal(t.verify(token.slice(0, -3) + "xyz"), null);
});

test("token: isi payload diubah → ditolak", () => {
  const t = createTokens({ secret: SECRET });
  const token = t.make("OSC-ABC123");
  const [, sig] = token.split(".");
  const jahat = Buffer.from(
    JSON.stringify({ code: "OSC-PALSU", exp: Date.now() + 60000 })
  ).toString("base64url");
  assert.equal(t.verify(`${jahat}.${sig}`), null);
});

test("token: secret berbeda → ditolak", () => {
  const a = createTokens({ secret: SECRET });
  const b = createTokens({ secret: "secret-lain" });
  assert.equal(b.verify(a.make("OSC-ABC123")), null);
});

test("token: kedaluwarsa → ditolak", () => {
  let waktu = 1_000_000;
  const t = createTokens({ secret: SECRET, hours: 1, now: () => waktu });
  const token = t.make("OSC-ABC123");
  assert.ok(t.verify(token), "masih sah sebelum lewat");
  waktu += 61 * 60 * 1000; // maju 61 menit
  assert.equal(t.verify(token), null, "harus kedaluwarsa");
});

test("token: input ngawur tidak bikin crash", () => {
  const t = createTokens({ secret: SECRET });
  for (const jelek of ["", null, undefined, "aaa", "a.b.c", "{}", 12345, "....."]) {
    assert.equal(t.verify(jelek), null);
  }
});

test("token: secret kosong ditolak saat dibuat", () => {
  assert.throws(() => createTokens({ secret: "" }));
});
