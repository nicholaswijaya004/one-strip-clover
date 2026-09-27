require("./_setup").pakaiDataSementara();
/**
 * Pengiriman pesanan: email (Resend → SMTP cadangan) + Google Drive paralel.
 * Tanpa jaringan sungguhan: fetch & transport SMTP disuntikkan (deps).
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const delivery = require("../lib/delivery");

const KUNCI = "re_kunci_uji_rahasia_1234567890";
const envDasar = {
  STUDIO_EMAIL: "studio@contoh.id",
  RESEND_API_KEY: KUNCI,
  SMTP_HOST: "smtp.contoh.id",
  SMTP_USER: "pengirim@contoh.id",
  SMTP_PASS: "x",
  SMTP_FROM: "pengirim@contoh.id",
};

const pesanan = {
  ref: "OSC260927-ABC123", code: "OSC-ABCDEFGH", name: "Budi\r\nBcc: korban@contoh.id",
  email: "pembeli@contoh.id", wa: "", address: "Jl. Uji No. 1, Jakarta", note: "",
  createdAt: "2026-09-27T07:00:00Z",
};
const att = {
  a4: null, strip: null, rawPhotos: [], sertakanAsli: true,
  semua: [{ filename: "foto-1.jpg", content: Buffer.from([0xff, 0xd8, 0xff]), contentType: "image/jpeg" }],
};

function fetchPalsu(status = 200, body = { id: "email_1" }) {
  const panggilan = [];
  const fn = async (url, opsi) => {
    panggilan.push({ url, opsi, body: JSON.parse(opsi.body) });
    return { ok: status >= 200 && status < 300, status, json: async () => body };
  };
  fn.panggilan = panggilan;
  return fn;
}

function smtpPalsu({ gagal = false } = {}) {
  const terkirim = [];
  const createTransport = () => ({
    sendMail: async (m) => {
      if (gagal) throw new Error("connect ETIMEDOUT");
      terkirim.push(m);
    },
  });
  createTransport.terkirim = terkirim;
  return createTransport;
}

test("email: Resend dipakai lebih dulu, SMTP tidak disentuh kalau Resend berhasil", async () => {
  const fetch = fetchPalsu();
  const createTransport = smtpPalsu();
  const via = await delivery.sendEmail(pesanan, att, envDasar, { fetch, createTransport });
  assert.equal(via, "resend");
  assert.equal(fetch.panggilan.length, 1);
  assert.equal(createTransport.terkirim.length, 0, "studio tidak boleh menerima email ganda");
});

test("email: isi permintaan Resend benar & aman", async () => {
  const fetch = fetchPalsu();
  await delivery.sendEmail(pesanan, att, envDasar, { fetch });
  const [{ url, opsi, body }] = fetch.panggilan;
  assert.equal(url, "https://api.resend.com/emails");
  assert.equal(opsi.method, "POST");
  assert.equal(opsi.headers.Authorization, `Bearer ${KUNCI}`);
  assert.ok(opsi.signal, "harus ada batas waktu");
  assert.deepEqual(body.to, ["studio@contoh.id"]);
  assert.equal(body.reply_to, "pembeli@contoh.id");
  assert.match(body.from, /onboarding@resend\.dev/);
  assert.ok(!/[\r\n]/.test(body.subject), "subject tidak boleh berisi baris baru (header injection)");
  assert.match(body.subject, /OSC260927-ABC123/);
  assert.equal(body.attachments.length, 1);
  assert.equal(body.attachments[0].content, Buffer.from([0xff, 0xd8, 0xff]).toString("base64"));
  assert.equal(body.attachments[0].content_type, "image/jpeg");
});

test("email: RESEND_FROM dipakai kalau diisi (domain sendiri)", async () => {
  const fetch = fetchPalsu();
  await delivery.sendEmail(pesanan, att, { ...envDasar, RESEND_FROM: "Studio <studio@osc.id>" }, { fetch });
  assert.equal(fetch.panggilan[0].body.from, "Studio <studio@osc.id>");
});

test("email: Resend gagal → otomatis lewat SMTP", async () => {
  const fetch = fetchPalsu(403, { name: "validation_error", message: "domain not verified" });
  const createTransport = smtpPalsu();
  const via = await delivery.sendEmail(pesanan, att, envDasar, { fetch, createTransport });
  assert.equal(via, "smtp");
  const [m] = createTransport.terkirim;
  assert.equal(m.to, "studio@contoh.id");
  assert.equal(m.from, "pengirim@contoh.id", "pengirim SMTP selalu alamat sendiri, bukan pembeli");
  assert.equal(m.replyTo, "pembeli@contoh.id");
});

test("email: dua-duanya gagal → error menyebut keduanya, TANPA membocorkan kunci", async () => {
  const fetch = fetchPalsu(500, { message: "internal" });
  await assert.rejects(
    delivery.sendEmail(pesanan, att, envDasar, { fetch, createTransport: smtpPalsu({ gagal: true }) }),
    (e) => {
      assert.match(e.message, /Resend HTTP 500/);
      assert.match(e.message, /SMTP: connect ETIMEDOUT/);
      assert.ok(!e.message.includes(KUNCI), "kunci API bocor ke pesan error");
      return true;
    }
  );
});

test("email: Resend menggantung → berhenti karena timeout, lalu SMTP", async () => {
  const fetch = async () => {
    const e = new Error("The operation was aborted due to timeout");
    e.name = "TimeoutError";
    throw e;
  };
  const createTransport = smtpPalsu();
  const via = await delivery.sendEmail(pesanan, att, envDasar, { fetch, createTransport });
  assert.equal(via, "smtp");
});

test("email: hanya SMTP diatur → langsung SMTP", async () => {
  const createTransport = smtpPalsu();
  const { RESEND_API_KEY: _abaikan, ...env } = envDasar;
  assert.equal(await delivery.sendEmail(pesanan, att, env, { createTransport }), "smtp");
});

test("email: belum diatur → error jelas; status konfigurasi benar", async () => {
  await assert.rejects(delivery.sendEmail(pesanan, att, { STUDIO_EMAIL: "a@b.id" }), /belum dikonfigurasi/);
  await assert.rejects(delivery.sendEmail(pesanan, att, { RESEND_API_KEY: KUNCI }), /STUDIO_EMAIL/);
  assert.equal(delivery.emailConfigured({ STUDIO_EMAIL: "a@b.id", RESEND_API_KEY: "x" }), true);
  assert.equal(delivery.emailConfigured({ STUDIO_EMAIL: "a@b.id", SMTP_HOST: "x" }), true);
  assert.equal(delivery.emailConfigured({ RESEND_API_KEY: "x" }), false);
  assert.equal(delivery.driveConfigured({ GOOGLE_CLIENT_ID: "a", GOOGLE_REFRESH_TOKEN: "b", DRIVE_FOLDER_ID: "c" }), false,
    "tanpa CLIENT_SECRET Drive pasti gagal — jangan dianggap aktif");
});

test("pengiriman ganda: email & Drive jalan BERBARENGAN, satu gagal tidak membatalkan yang lain", async () => {
  const log = { info() {}, warn() {}, error() {} };
  const pesananLengkap = { ...pesanan, photos: [`data:image/jpeg;base64,${Buffer.from([0xff, 0xd8, 0xff]).toString("base64")}`] };

  // email berhasil, Drive gagal
  let r = await delivery.deliver(pesananLengkap, {
    log, env: envDasar,
    deps: { fetch: fetchPalsu(), sendDrive: async () => { throw new Error("Drive mati"); } },
  });
  assert.equal(r.ok, true);
  assert.deepEqual([r.results.email, r.results.emailVia, r.results.drive], [true, "resend", false]);

  // email gagal total, Drive berhasil → pesanan tetap sampai
  r = await delivery.deliver(pesananLengkap, {
    log, env: envDasar,
    deps: {
      fetch: fetchPalsu(500), createTransport: smtpPalsu({ gagal: true }),
      sendDrive: async () => "https://drive.google.com/folder",
    },
  });
  assert.equal(r.ok, true);
  assert.deepEqual([r.results.email, r.results.drive], [false, true]);

  // semua gagal → ok:false (server memarkir ke antrean coba-ulang)
  r = await delivery.deliver(pesananLengkap, {
    log, env: envDasar,
    deps: {
      fetch: fetchPalsu(500), createTransport: smtpPalsu({ gagal: true }),
      sendDrive: async () => { throw new Error("Drive mati"); },
    },
  });
  assert.equal(r.ok, false);
  assert.equal(r.errors.length, 2);
});
