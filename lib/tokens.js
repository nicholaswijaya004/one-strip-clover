/**
 * Token sesi premium — ditandatangani HMAC.
 *
 * Dipisah dari server.js supaya bisa diuji unit tanpa menyalakan server.
 * Tidak disimpan di memori, jadi token tetap sah setelah server restart.
 */

const crypto = require("crypto");

function createTokens({ secret, hours = 6, now = () => Date.now() } = {}) {
  if (!secret) throw new Error("secret wajib diisi");

  function make(code) {
    const payload = Buffer.from(
      JSON.stringify({ code, exp: now() + hours * 3600 * 1000 })
    ).toString("base64url");
    const sig = crypto.createHmac("sha256", secret).update(payload).digest("base64url");
    return `${payload}.${sig}`;
  }

  function verify(token) {
    try {
      const parts = String(token || "").split(".");
      if (parts.length !== 2) return null;
      const [payload, sig] = parts;
      if (!payload || !sig) return null;

      const expect = crypto
        .createHmac("sha256", secret)
        .update(payload)
        .digest("base64url");

      const a = Buffer.from(sig);
      const b = Buffer.from(expect);
      if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

      const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
      if (!data || typeof data.exp !== "number" || data.exp < now()) return null;
      if (!data.code) return null;
      return data;
    } catch {
      return null;
    }
  }

  return { make, verify };
}

module.exports = { createTokens };
