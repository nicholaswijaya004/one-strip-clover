/**
 * API ADMIN — /api/admin/*
 *
 * Dipisah dari server.js (SRP): server.js hanya MERANGKAI modul; aturan
 * siapa-boleh-apa di panel admin hidup di sini dan bisa dibaca utuh di satu
 * tempat. Semua dependensi disuntikkan (DI) supaya modul ini tidak diam-diam
 * membuka berkas atau membaca konfigurasi sendiri.
 */

const crypto = require("crypto");
const { ERR, HTTP, LIMIT } = require("../../public/shared/contract.js");
const { sniff } = require("../images");

/**
 * @param {import("express").Express} app
 * @param {object} d  { log, rateLimit, codeLib, loadCodes, saveCodes, cariKode, queue, template, settings }
 * @returns {{ adminOk:(req)=>boolean, codeStats:(codes)=>object }}
 */
function registerAdminRoutes(app, d) {
  const { log, rateLimit, codeLib, loadCodes, saveCodes, cariKode, queue, template, settings } = d;

  /* ---------------------------- admin API ---------------------------- */
  /*
   * Dipakai oleh halaman /admin, atau oleh tool otomasi (n8n / Make / chatbot).
   * Semua butuh header  x-admin-key  yang cocok dengan ADMIN_KEY di .env.
   *
   * Contoh dari tool otomasi:
   *   POST /api/admin/next-code
   *   Header: x-admin-key: rahasia123
   *   → { ok:true, code:"FB-K3PQ7M", remaining:487 }
   */

  function adminOk(req) {
    const key = process.env.ADMIN_KEY;
    const diberi = req.get("x-admin-key") || "";
    let ok = false;
    if (key) {
      // Perbandingan tahan timing-attack: `a === b` berhenti di karakter pertama
      // yang berbeda, sehingga lama waktunya membocorkan panjang kecocokan.
      // Keduanya di-hash dulu → panjangnya selalu sama (32 byte), jadi
      // panjang ADMIN_KEY pun tidak bocor lewat waktu respons.
      const h = (v) => crypto.createHash("sha256").update(String(v)).digest();
      ok = crypto.timingSafeEqual(h(diberi), h(key));
    }
    if (!ok) log.warn("admin.unauthorized", { rid: req.rid, path: req.path, ip: req.ip });
    return ok;
  }

  // Semua rute admin dibatasi percobaannya — dulu hanya /next-code yang dibatasi,
  // sehingga ADMIN_KEY bisa ditebak tanpa batas lewat /api/admin/stats.
  const adminGuard = rateLimit({ windowMs: LIMIT.ADMIN_WINDOW_MS, max: LIMIT.ADMIN_MAKS, key: "admin" });

  function codeStats(codes) {
    const list = Object.values(codes);
    const isChatbot = (c) => c.buyer === "(batch chatbot)";
    return {
      total: list.length,
      redeemed: list.filter((c) => c.used).length,
      // stok admin  = belum dibagikan sama sekali, siap dipakai tombol /admin
      available: list.filter((c) => !c.issued && !c.used).length,
      // stok chatbot = sudah diekspor ke pool chatbot, tapi belum ditukar pembeli
      chatbotStock: list.filter((c) => c.issued && isChatbot(c) && !c.used).length,
      // dibagikan manual lewat tombol /admin
      adminIssued: list.filter((c) => c.issued && !isChatbot(c)).length,
      issued: list.filter((c) => c.issued).length, // dipertahankan untuk kompatibilitas
    };
  }

  // Ambil 1 kode yang BELUM pernah dibagikan, lalu tandai "issued".
  app.post(
    "/api/admin/next-code",
    rateLimit({ windowMs: LIMIT.ADMIN_WINDOW_MS, max: LIMIT.ADMIN_MAKS, key: "admin" }),
    (req, res) => {
    if (!adminOk(req)) return res.status(HTTP.UNAUTHORIZED).json({ ok: false, error: ERR.UNAUTHORIZED });

    const codes = loadCodes();
    const entry = Object.entries(codes).find(([, v]) => !v.issued && !v.used);

    if (!entry) {
      log.error("code.out_of_stock", { rid: req.rid });
      return res.status(HTTP.CONFLICT).json({
        ok: false,
        error: ERR.OUT_OF_STOCK,
        hint: "Stok admin habis — buat kode baru lewat tombol Generate (pilihan Stok admin).",
        stats: codeStats(codes),
      });
    }

    const [code, data] = entry;
    data.issued = true;
    data.issuedAt = new Date().toISOString();
    if (req.body && req.body.buyer) {
      data.buyer = String(req.body.buyer).replace(/[\r\n\t<>]/g, " ").slice(0, 80);
    }
    saveCodes(codes);

    const stats = codeStats(codes);
    log.order("code.issued", { rid: req.rid, code, buyer: data.buyer, remaining: stats.available });
    if (stats.available < 20)
      log.warn("code.low_stock", { remaining: stats.available });
    res.json({ ok: true, code, remaining: stats.available, stats });
    }
  );

  // Ringkasan stok kode
  app.post("/api/admin/stats", adminGuard, (req, res) => {
    if (!adminOk(req)) return res.status(HTTP.UNAUTHORIZED).json({ ok: false, error: ERR.UNAUTHORIZED });
    const codes = loadCodes();
    const recent = Object.entries(codes)
      .filter(([, v]) => v.issued)
      .sort((a, b) => String(b[1].issuedAt).localeCompare(String(a[1].issuedAt)))
      .slice(0, 10)
      .map(([code, v]) => ({
        code,
        issuedAt: v.issuedAt,
        used: !!v.used,
        buyer: v.buyer || null,
      }));
    res.json({ ok: true, stats: codeStats(codes), recent, queue: queue.stats() });
  });

  // Buat kode baru langsung dari halaman /admin (pengganti buka terminal)
  app.post(
    "/api/admin/generate",
    rateLimit({ windowMs: LIMIT.UPLOAD_WINDOW_MS, max: LIMIT.GENERATE_MAKS, key: "generate" }),
    (req, res) => {
      if (!adminOk(req)) return res.status(HTTP.UNAUTHORIZED).json({ ok: false, error: ERR.UNAUTHORIZED });

      const n = Number(req.body.n);
      if (!Number.isInteger(n) || n < 1 || n > LIMIT.KODE_MAKS_SEKALI)
        return res.status(HTTP.BAD_REQUEST).json({ ok: false, error: ERR.BAD_COUNT, hint: "1 - 2000" });

      const forChatbot = !!req.body.forChatbot;
      try {
        const r = codeLib.generate(n, { forChatbot });
        const stats = codeLib.stats();
        log.order("code.batch_generated", {
          rid: req.rid,
          count: r.codes.length,
          target: forChatbot ? "chatbot" : "admin",
          total: stats.total,
        });
        res.json({ ok: true, codes: r.codes, forChatbot, stats });
      } catch (e) {
        log.error("code.generate_failed", { rid: req.rid, msg: e.message });
        res.status(HTTP.SERVER_ERROR).json({ ok: false, error: ERR.GENERATE_FAILED });
      }
    }
  );

  app.post("/api/admin/template", adminGuard, async (req, res) => {
    if (!adminOk(req)) return res.status(HTTP.UNAUTHORIZED).json({ ok: false, error: ERR.UNAUTHORIZED });

    try {
      // 1) baca pustaka
      if (req.body.baca) {
        return res.json({ ok: true, items: template.daftar(), maks: template.MAKS_TEMPLATE });
      }

      // 2) hapus satu template
      if (req.body.hapus) {
        const t = template.cari(String(req.body.hapus));
        const items = await template.hapus(String(req.body.hapus));
        log.order("template.deleted", { rid: req.rid, id: req.body.hapus, nama: t && t.nama });
        return res.json({ ok: true, items, maks: template.MAKS_TEMPLATE });
      }

      // 3) ubah nama / tata letak satu template
      if (req.body.ubah && req.body.ubah.id) {
        const t = await template.ubah(String(req.body.ubah.id), req.body.ubah);
        if (!t) return res.status(HTTP.NOT_FOUND).json({ ok: false, error: ERR.NOT_FOUND });
        log.order("template.updated", { rid: req.rid, id: t.id, nama: t.nama });
        return res.json({ ok: true, items: template.daftar(), maks: template.MAKS_TEMPLATE });
      }

      // 4) unggah template baru
      const dataUrl = String(req.body.image || "");
      const cocok = dataUrl.match(/^data:(image\/(png|jpeg));base64,(.+)$/);
      if (!cocok) {
        return res.status(HTTP.BAD_REQUEST).json({ ok: false, error: ERR.BAD_IMAGE, hint: "PNG atau JPG saja" });
      }
      const buf = Buffer.from(cocok[3], "base64");
      if (buf.length > LIMIT.TEMPLATE_MAKS_BYTE) {
        return res.status(HTTP.PAYLOAD_TOO_LARGE).json({ ok: false, error: ERR.TOO_BIG, hint: "maksimal 8 MB" });
      }
      // Isi berkas harus BENAR-BENAR PNG/JPEG (bukan sekadar klaim di data URL),
      // dan ukurannya wajar — template dimuat ulang oleh browser setiap pembeli.
      let info;
      try {
        info = sniff(buf);
      } catch {
        return res.status(HTTP.BAD_REQUEST).json({ ok: false, error: ERR.BAD_IMAGE, hint: "PNG atau JPG saja" });
      }
      if (info.width > 4000 || info.height > 12000) {
        return res.status(HTTP.BAD_REQUEST).json({ ok: false, error: ERR.BAD_IMAGE, hint: "maksimal 4000 x 12000 px" });
      }

      const t = await template.tambah(
        buf, info.mime,
        { lebarPx: info.width, tinggiPx: info.height },
        req.body.nama
      );
      log.order("template.uploaded", {
        rid: req.rid, id: t.id, nama: t.nama, kb: Math.round(buf.length / 1024),
      });
      res.json({ ok: true, items: template.daftar(), baru: t.id, maks: template.MAKS_TEMPLATE });
    } catch (e) {
      log.error("template.failed", { rid: req.rid, msg: e.message });
      res.status(HTTP.SERVER_ERROR).json({ ok: false, error: ERR.SERVER_ERROR, hint: e.message });
    }
  });

  app.post("/api/admin/settings", adminGuard, async (req, res) => {
    if (!adminOk(req)) return res.status(HTTP.UNAUTHORIZED).json({ ok: false, error: ERR.UNAUTHORIZED });

    if (req.body && req.body.update) {
      const sebelum = settings.all();
      const sesudah = await settings.update(req.body.update);
      log.order("settings.changed", { rid: req.rid, sebelum, sesudah });
      return res.json({ ok: true, settings: sesudah, skema: settings.SKEMA });
    }
    res.json({ ok: true, settings: settings.all(), skema: settings.SKEMA });
  });

  // Lepas ikatan perangkat sebuah kode.
  // Dipakai kalau pembeli sah terkunci — mis. dia menukar kode di browser dalam
  // aplikasi TikTok, lalu membuka situsnya lagi di Safari (penyimpanannya beda).
  app.post(
    "/api/admin/unbind",
    adminGuard,
    (req, res) => {
      if (!adminOk(req)) return res.status(HTTP.UNAUTHORIZED).json({ ok: false, error: ERR.UNAUTHORIZED });

      const kode = String((req.body && req.body.code) || "").trim().toUpperCase();
      const codes = loadCodes();
      const entry = cariKode(codes, kode);
      if (!entry) return res.status(HTTP.NOT_FOUND).json({ ok: false, error: ERR.INVALID });

      if (entry.submissions > 0) {
        // Kode yang sudah dipakai memesan memang sudah selesai tugasnya
        return res.status(HTTP.CONFLICT).json({ ok: false, error: ERR.SPENT, ref: entry.lastRef || null });
      }

      const sebelum = (entry.devices || []).length;
      entry.devices = [];
      entry.unbindCount = (entry.unbindCount || 0) + 1;
      entry.lastUnbindAt = new Date().toISOString();
      saveCodes(codes);

      log.order("code.unbind", {
        rid: req.rid, code: kode, perangkatSebelumnya: sebelum,
        totalPelepasan: entry.unbindCount,
      });
      res.json({ ok: true, code: kode, unbindCount: entry.unbindCount });
    }
  );

  // Lihat log lewat browser (berguna saat sudah live, tanpa buka shell)
  app.post("/api/admin/logs", adminGuard, (req, res) => {
    if (!adminOk(req)) return res.status(HTTP.UNAUTHORIZED).json({ ok: false, error: ERR.UNAUTHORIZED });
    const which = req.body.which === "app" ? "app" : "orders";
    const n = Math.min(Number(req.body.n || 60), 300);
    res.json({ ok: true, which, lines: log.tail(which, n) });
  });

  return { adminOk, codeStats };
}

module.exports = { registerAdminRoutes };
