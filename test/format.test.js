const test = require("node:test");
const assert = require("node:assert/strict");
const fmt = require("../lib/format");

/* ------------------------------ clean ------------------------------ */

test("clean: karakter terlarang nama file dibuang", () => {
  assert.equal(fmt.clean("Siti / Rahma"), "Siti Rahma");
  assert.equal(fmt.clean('Nama<>Aneh:Sekali'), "Nama Aneh Sekali");
  assert.equal(fmt.clean("baris\nbaru\ttab"), "baris baru tab");
});

test("clean: spasi berlebih dirapikan & dipotong sesuai batas", () => {
  assert.equal(fmt.clean("  Daniel    Wijaya  "), "Daniel Wijaya");
  assert.equal(fmt.clean("abcdefghij", 4), "abcd");
});

test("clean: nilai kosong/null aman", () => {
  assert.equal(fmt.clean(null), "");
  assert.equal(fmt.clean(undefined), "");
  assert.equal(fmt.clean(""), "");
});

/* --------------------------- takenLabel --------------------------- */

test("takenLabel: format tanggal-jam WIB", () => {
  // 2026-07-28 11:07 UTC = 18.07 WIB
  const label = fmt.takenLabel("2026-07-28T11:07:00Z");
  assert.match(label, /^2026-07-28 18\.07$/);
});

test("takenLabel: tanggal tidak valid → pakai waktu sekarang", () => {
  const tetap = new Date("2026-01-02T03:04:00Z");
  assert.equal(fmt.takenLabel("bukan-tanggal", () => tetap), fmt.takenLabel(null, () => tetap));
});

/* --------------------------- buildLabel --------------------------- */

test("buildLabel: susunan Nama - kontak - tanggal - kode", () => {
  const label = fmt.buildLabel({
    name: "Daniel Wijaya", email: "", wa: "082121484856",
    takenAt: "2026-07-28T11:07:00Z", code: "OSC-K3PQ7M",
  });
  assert.equal(label, "Daniel Wijaya - 082121484856 - 2026-07-28 18.07 - OSC-K3PQ7M");
});

test("buildLabel: email diprioritaskan di atas WhatsApp", () => {
  const label = fmt.buildLabel({
    name: "A", email: "a@b.com", wa: "0812",
    takenAt: "2026-07-28T11:07:00Z", code: "OSC-X",
  });
  assert.ok(label.includes("a@b.com"));
  assert.ok(!label.includes("0812"));
});

test("buildLabel: karakter berbahaya tidak lolos ke nama folder", () => {
  const label = fmt.buildLabel({
    name: "Budi/../etc", wa: "0812", takenAt: "2026-07-28T11:07:00Z", code: "OSC-X",
  });
  assert.ok(!label.includes("/"), "garis miring harus hilang");
});

/* ---------------------------- buildRef ---------------------------- */

test("buildRef: format OSCyymmdd-RID huruf besar", () => {
  const ref = fmt.buildRef("a3f9c1", new Date("2026-07-29T00:00:00Z"));
  assert.equal(ref, "OSC260729-A3F9C1");
});

/* -------------------------- validateOrder -------------------------- */

const pesananValid = {
  consent: true,
  photos: ["data:image/jpeg;base64,AAA", "b", "c", "d"],
  name: "Daniel Wijaya",
  wa: "082121484856",
  address: "Jl. Merdeka No. 12, Sukabumi, Jawa Barat 43351",
};

test("validateOrder: pesanan lengkap lolos", () => {
  assert.equal(fmt.validateOrder(pesananValid), null);
});

test("validateOrder: tanpa persetujuan ditolak", () => {
  assert.equal(fmt.validateOrder({ ...pesananValid, consent: false }), "CONSENT_REQUIRED");
});

test("validateOrder: tanpa foto ditolak", () => {
  assert.equal(fmt.validateOrder({ ...pesananValid, photos: [] }), "NO_PHOTOS");
  assert.equal(fmt.validateOrder({ ...pesananValid, photos: null }), "NO_PHOTOS");
});

test("validateOrder: foto kebanyakan ditolak", () => {
  assert.equal(
    fmt.validateOrder({ ...pesananValid, photos: new Array(9).fill("x") }),
    "TOO_MANY"
  );
});

test("validateOrder: nama wajib", () => {
  assert.equal(fmt.validateOrder({ ...pesananValid, name: "" }), "NAME_REQUIRED");
  assert.equal(fmt.validateOrder({ ...pesananValid, name: "   " }), "NAME_REQUIRED");
});

test("validateOrder: minimal salah satu kontak", () => {
  const tanpaKontak = { ...pesananValid, wa: "", email: "", contact: "" };
  assert.equal(fmt.validateOrder(tanpaKontak), "CONTACT_REQUIRED");
  assert.equal(fmt.validateOrder({ ...tanpaKontak, email: "a@b.com" }), null);
});

test("validateOrder: format email & WhatsApp diperiksa", () => {
  assert.equal(fmt.validateOrder({ ...pesananValid, email: "bukan-email" }), "BAD_EMAIL");
  assert.equal(fmt.validateOrder({ ...pesananValid, wa: "12" }), "BAD_WA");
  assert.equal(fmt.validateOrder({ ...pesananValid, wa: "+62 812-1234-5678" }), null);
});

test("validateOrder: alamat wajib & minimal 12 karakter", () => {
  assert.equal(fmt.validateOrder({ ...pesananValid, address: "" }), "ADDRESS_REQUIRED");
  assert.equal(fmt.validateOrder({ ...pesananValid, address: "Jl. Mawar" }), "ADDRESS_REQUIRED");
});

test("validateOrder: body kosong tidak bikin crash", () => {
  assert.equal(fmt.validateOrder(null), "CONSENT_REQUIRED");
  assert.equal(fmt.validateOrder({}), "CONSENT_REQUIRED");
});
