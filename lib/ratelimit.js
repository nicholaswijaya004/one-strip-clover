/**
 * Rate limiter sederhana berbasis memori (tanpa dependency).
 * Dipisah agar bisa diuji tanpa menyalakan Express.
 *
 * Catatan: kalau nanti jalan di banyak instance server, ganti Map ini
 * dengan Redis supaya hitungannya dibagi bersama.
 */

function createStore(nowFn = () => Date.now()) {
  const buckets = new Map();

  /**
   * @returns {{allowed:boolean, remaining:number, retryAfter:number}}
   */
  function hit(id, windowMs, max) {
    const now = nowFn();
    const b = buckets.get(id);

    if (!b || now > b.reset) {
      buckets.set(id, { count: 1, reset: now + windowMs });
      return { allowed: true, remaining: max - 1, retryAfter: 0 };
    }
    if (b.count >= max) {
      return {
        allowed: false,
        remaining: 0,
        retryAfter: Math.ceil((b.reset - now) / 1000),
      };
    }
    b.count++;
    return { allowed: true, remaining: max - b.count, retryAfter: 0 };
  }

  function sweep() {
    const now = nowFn();
    let removed = 0;
    for (const [k, v] of buckets) {
      if (now > v.reset) {
        buckets.delete(k);
        removed++;
      }
    }
    return removed;
  }

  /**
   * Periksa TANPA menambah hitungan.
   * Dipakai untuk pola "hanya kegagalan yang dihitung": penukaran kode yang
   * BERHASIL tidak boleh memakan jatah, karena yang ingin dicegah adalah
   * penebakan kode (yang selalu menghasilkan kegagalan). Kalau keberhasilan
   * ikut dihitung, pembeli sah di operator seluler yang sama (CGNAT) bisa
   * saling memblokir saat trafik ramai.
   */
  function check(id, windowMs, max) {
    const now = nowFn();
    const b = buckets.get(id);
    if (!b || now > b.reset) return { allowed: true, remaining: max, retryAfter: 0 };
    if (b.count >= max) {
      return { allowed: false, remaining: 0, retryAfter: Math.ceil((b.reset - now) / 1000) };
    }
    return { allowed: true, remaining: max - b.count, retryAfter: 0 };
  }

  /** Tambah hitungan (dipakai saat terjadi kegagalan). */
  function penalize(id, windowMs, max) {
    return hit(id, windowMs, max);
  }

  /** Bersihkan hitungan (mis. setelah berhasil). */
  function reset(id) {
    buckets.delete(id);
  }

  return { hit, check, penalize, reset, sweep, size: () => buckets.size, _buckets: buckets };
}

module.exports = { createStore };
