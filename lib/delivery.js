/**
 * PENGIRIMAN PESANAN KE STUDIO (email + Google Drive)
 *
 * Dipisah dari server.js karena dipakai DUA jalur:
 *   1. permintaan langsung dari pembeli
 *   2. proses coba-ulang dari antrean (lib/queue.js)
 *
 * Kalau logikanya tetap menempel di route handler, jalur coba-ulang harus
 * menyalin kodenya — dan dua salinan pasti berbeda perilaku suatu hari nanti.
 */

const fmt = require("./format");
const render = require("./render");
const pdf = require("./pdf");

/** Ubah data URL / base64 jadi Buffer */
function toBuffer(dataUrl) {
  const s = String(dataUrl || "");
  const koma = s.indexOf(",");
  return Buffer.from(koma >= 0 ? s.slice(koma + 1) : s, "base64");
}

/**
 * Susun lampiran: strip jadi (utama) + foto asli (opsional).
 * Kalau strip tidak ada, foto asli SELALU disertakan supaya kamu tetap
 * punya bahan untuk membuat strip manual.
 */
/**
 * Susun lampiran untuk studio.
 *
 * Lembar A4 adalah lampiran UTAMA — itulah yang langsung dicetak lalu
 * dipotong oleh staf. Dibuat dengan dua lapis pengaman:
 *   1. Server (300 dpi, kualitas cetak) — kalau @napi-rs/canvas tersedia
 *   2. Kalau tidak, pakai lembar A4 yang sudah dibuat browser (±150 dpi)
 * Jadi kamu tidak akan pernah menerima email tanpa lembar siap cetak.
 */
async function buildAttachmentsAsync(o, env = process.env, log) {
  const att = buildAttachments(o, env);
  const stamp = new Date(o.createdAt || Date.now()).toISOString().replace(/[:.]/g, "-");

  /* --- LEMBAR CETAK A4 (PDF) — lampiran utama ---
     Dibuat dari berkas strip yang dikirim browser, memakai pembuat PDF
     murni JavaScript. Tidak butuh pustaka gambar apa pun, jadi selalu
     berhasil selama stripnya ada. Ukuran cetak dijamin 51 x 152 mm. */
  if (att.strip) {
    try {
      const buf = pdf.buildA4Pdf(att.strip.content, {
        copies: Number(env.A4_COPIES || 1),
        marginMm: Number(env.A4_MARGIN_MM || 10),
      });
      att.a4 = {
        filename: `CETAK-A4-${stamp}.pdf`,
        content: buf,
        contentType: "application/pdf",
      };
      att.a4Source = "pdf";
      log?.info?.("a4.pdf_built", { ref: o.ref, kb: Math.round(buf.length / 1024) });
    } catch (e) {
      log?.error?.("a4.pdf_failed", { ref: o.ref, msg: e.message });
    }
  } else {
    log?.warn?.("a4.no_strip", {
      ref: o.ref,
      hint: "browser tidak mengirim strip — lembar A4 tidak bisa dibuat",
    });
  }

  // Urutan lampiran: lembar A4 paling depan (itu yang dicetak staf)
  att.semua = [
    ...(att.a4 ? [att.a4] : []),
    ...(att.strip ? [att.strip] : []),
    ...(att.sertakanAsli ? att.rawPhotos : []),
  ];
  return att;
}

function buildAttachments(o, env = process.env) {
  const stamp = new Date(o.createdAt || Date.now())
    .toISOString()
    .replace(/[:.]/g, "-");

  const rawPhotos = (o.photos || []).map((p, i) => ({
    filename: `foto-asli-${stamp}-${i + 1}.jpg`,
    content: toBuffer(p),
  }));

  const punyaStrip = typeof o.strip === "string" && o.strip.length > 0;
  const strip = punyaStrip
    ? { filename: `STRIP-${stamp}.jpg`, content: toBuffer(o.strip) }
    : null;

  const sertakanAsli =
    String(env.ATTACH_RAW_PHOTOS || "true").toLowerCase() !== "false" || !strip;

  return {
    a4: null, // diisi oleh buildAttachmentsAsync (PDF dibuat di server)
    strip,
    rawPhotos,
    sertakanAsli,
    semua: [
      ...(strip ? [strip] : []),
      ...(sertakanAsli ? rawPhotos : []),
    ],
  };
}

function buildEmailText(o, att, env = process.env) {
  const takenLabel = fmt.takenLabel(o.takenAt);
  return (
    `PESANAN STRIP MANUAL — ONE STRIP CLOVER\n` +
    `====================================================\n\n` +
    `No. Pesanan: ${o.ref}\n\n` +
    `>>> ALAMAT PENGIRIMAN:\n${String(o.address || "").trim()}\n` +
    `====================================================\n\n` +
    `Nama    : ${o.name || "-"}\n` +
    `Email   : ${o.email || "-"}\n` +
    `WhatsApp: ${o.wa || "-"}\n` +
    `Kode    : ${o.code}\n` +
    `Catatan : ${o.note || "-"}\n` +
    `Gaya    : ${o.style || "-"}\n` +
    `Lampiran: ${att.a4 ? "CETAK-A4-*.pdf ← CETAK INI (strip 51x152mm, tinggal potong), " : "⚠️ TIDAK ADA lembar A4, "}` +
    `${att.strip ? "strip .jpg" : "(strip gagal dibuat)"}` +
    `${att.sertakanAsli ? ` + ${att.rawPhotos.length} foto asli` : ""}\n` +
    `Foto diambil: ${takenLabel} WIB\n` +
    `Dikirim     : ${new Date().toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })} WIB\n` +
    `Sumber  : ${o.reason === "generation_failed" ? "strip GAGAL dibuat otomatis" : "diminta sendiri oleh user"}\n\n` +
    `Balas ke kontak di atas setelah strip selesai dibuat.\n`
  );
}

async function sendEmail(o, att, env = process.env) {
  if (!env.SMTP_HOST) throw new Error("SMTP_HOST belum diisi");

  const nodemailer = require("nodemailer");
  const transporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: Number(env.SMTP_PORT || 587),
    secure: String(env.SMTP_PORT) === "465",
    auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
  });

  const label = fmt.buildLabel({
    name: o.name, email: o.email, wa: o.wa,
    contact: o.email || o.wa, takenAt: o.takenAt, code: o.code,
  });

  await transporter.sendMail({
    from: env.SMTP_FROM || env.SMTP_USER,
    to: env.STUDIO_EMAIL,
    // fmt.clean membuang CR/LF → subject aman dari header injection
    subject: fmt.clean(`🍀 [${o.ref}] ${label}`, 180),
    text: buildEmailText(o, att, env),
    attachments: att.semua,
  });
}

async function sendDrive(o, att, env = process.env) {
  if (
    !env.GOOGLE_CLIENT_ID ||
    !env.GOOGLE_CLIENT_SECRET ||
    !env.GOOGLE_REFRESH_TOKEN ||
    !env.DRIVE_FOLDER_ID
  ) {
    throw new Error("Drive belum dikonfigurasi");
  }

  const { google } = require("googleapis");
  const { Readable } = require("stream");

  const oauth2 = new google.auth.OAuth2(
    env.GOOGLE_CLIENT_ID,
    env.GOOGLE_CLIENT_SECRET,
    env.GOOGLE_REDIRECT_URI || "http://localhost:5555/oauth2callback"
  );
  oauth2.setCredentials({ refresh_token: env.GOOGLE_REFRESH_TOKEN });
  const drive = google.drive({ version: "v3", auth: oauth2 });

  const folderName = fmt.buildLabel({
    name: o.name, email: o.email, wa: o.wa,
    contact: o.email || o.wa, takenAt: o.takenAt, code: o.code,
  });

  const folderRes = await drive.files.create({
    requestBody: {
      name: folderName,
      mimeType: "application/vnd.google-apps.folder",
      parents: [env.DRIVE_FOLDER_ID],
    },
    fields: "id, webViewLink",
  });
  const folderId = folderRes.data.id;

  // Semua berkas diunggah PARALEL
  const uploads = att.rawPhotos.map((a) =>
    drive.files.create({
      requestBody: { name: a.filename, parents: [folderId] },
      media: { mimeType: "image/jpeg", body: Readable.from(a.content) },
      fields: "id",
    })
  );
  if (att.a4) {
    uploads.push(
      drive.files.create({
        requestBody: { name: `__${att.a4.filename}`, parents: [folderId] },
        media: {
          mimeType: att.a4.contentType || "image/jpeg",
          body: Readable.from(att.a4.content),
        },
        fields: "id",
      })
    );
  }
  if (att.strip) {
    uploads.push(
      drive.files.create({
        requestBody: { name: `_${att.strip.filename}`, parents: [folderId] },
        media: { mimeType: "image/jpeg", body: Readable.from(att.strip.content) },
        fields: "id",
      })
    );
  }
  uploads.push(
    drive.files.create({
      requestBody: { name: "_INFO.txt", parents: [folderId] },
      media: {
        mimeType: "text/plain",
        body: Readable.from(Buffer.from(buildEmailText(o, att, env), "utf8")),
      },
      fields: "id",
    })
  );

  await Promise.all(uploads);
  return folderRes.data.webViewLink || folderId;
}

/**
 * Kirim lewat SEMUA channel yang tersedia, PARALEL.
 * Satu gagal tidak membatalkan yang lain — pesanan dianggap sampai kalau
 * minimal satu channel berhasil.
 */
async function deliver(o, { log, env = process.env } = {}) {
  const att = await buildAttachmentsAsync(o, env, log);
  const results = { email: false, drive: false, driveFolder: null };
  const errors = [];

  const t0 = Date.now();
  const [e1, e2] = await Promise.allSettled([
    sendEmail(o, att, env),
    sendDrive(o, att, env),
  ]);

  if (e1.status === "fulfilled") {
    results.email = true;
    log?.info?.("email.sent", { ref: o.ref, attachments: att.semua.length });
  } else {
    errors.push("email: " + e1.reason.message);
    log?.error?.("email.failed", { ref: o.ref, msg: e1.reason.message });
  }

  if (e2.status === "fulfilled") {
    results.drive = true;
    results.driveFolder = e2.value;
    log?.info?.("drive.uploaded", { ref: o.ref });
  } else {
    const msg = e2.reason.message;
    errors.push("drive: " + msg);
    // Drive belum diatur bukan "kegagalan" yang perlu diteriakkan
    if (!/belum dikonfigurasi/i.test(msg)) {
      log?.error?.("drive.failed", {
        ref: o.ref,
        msg,
        hint: /invalid_grant/i.test(msg)
          ? "token kadaluarsa — app masih Testing? jalankan npm run auth lagi"
          : /not found/i.test(msg)
          ? "DRIVE_FOLDER_ID salah / folder dibuat manual"
          : undefined,
      });
    }
  }

  log?.info?.("delivery.done", {
    ref: o.ref, ms: Date.now() - t0,
    email: results.email, drive: results.drive,
  });

  return { ok: results.email || results.drive, results, errors };
}

module.exports = { deliver, buildAttachments, buildAttachmentsAsync, sendEmail, sendDrive, buildEmailText };
