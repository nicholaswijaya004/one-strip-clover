require("./_setup").pakaiDataSementara();
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const settings = require("../lib/settings");

const bersih = () => {
  try { fs.unlinkSync(settings.FILE); } catch {}
  try { fs.unlinkSync(settings.FILE + ".bak"); } catch {}
};
test.beforeEach(bersih);
test.after(bersih);

test("setelan: bawaan masuk akal saat .env kosong", () => {
  const s = settings.all({});
  assert.equal(s.maxDevicesPerCode, 2);
  assert.equal(s.maxStudioSubmissions, 1);
  assert.equal(s.redeemGraceHours, 3);
});

test("setelan: nilai dari .env dipakai sebagai bawaan", () => {
  const s = settings.all({ MAX_DEVICES_PER_CODE: "3" });
  assert.equal(s.maxDevicesPerCode, 3);
});

test("setelan: perubahan dari admin menimpa .env", async () => {
  await settings.update({ maxDevicesPerCode: 4 }, {});
  assert.equal(settings.all({ MAX_DEVICES_PER_CODE: "1" }).maxDevicesPerCode, 4);
});

test("setelan: nilai di luar batas DIPOTONG oleh server", async () => {
  // UI bisa diakali; batasnya harus dijaga di server
  const s = await settings.update(
    { maxDevicesPerCode: 999, maxStudioSubmissions: 0, redeemGraceHours: 9999 },
    {}
  );
  assert.equal(s.maxDevicesPerCode, 5, "batas atas");
  assert.equal(s.maxStudioSubmissions, 1, "batas bawah");
  assert.equal(s.redeemGraceHours, 72, "batas atas jam");
});

test("setelan: nilai ngawur tidak merusak apa pun", async () => {
  const s = await settings.update({ maxDevicesPerCode: "abc" }, {});
  assert.equal(s.maxDevicesPerCode, 2, "kembali ke bawaan");
});

test("setelan: kunci tak dikenal diabaikan (anti suntik setelan)", async () => {
  const s = await settings.update({ adminKey: "bocor", maxDevicesPerCode: 3 }, {});
  assert.equal(s.adminKey, undefined, "kunci asing tidak boleh tersimpan");
  assert.equal(s.maxDevicesPerCode, 3);
});

test("setelan: bertahan setelah dibaca ulang (tersimpan di disk)", async () => {
  await settings.update({ maxDevicesPerCode: 5 }, {});
  assert.equal(settings.all({}).maxDevicesPerCode, 5);
  assert.ok(fs.existsSync(settings.FILE), "harus tersimpan di berkas");
});

test("setelan: file rusak tidak membuat server gagal", async () => {
  await settings.update({ maxDevicesPerCode: 4 }, {});
  fs.writeFileSync(settings.FILE, "{ rusak");
  const s = settings.all({});
  assert.ok(s.maxDevicesPerCode >= 1, "harus tetap mengembalikan nilai sah");
});
