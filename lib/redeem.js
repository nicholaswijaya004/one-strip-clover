/**
 * Aturan penukaran kode — fungsi murni supaya gampang diuji.
 *
 * Masalah yang dipecahkan:
 *   Pembeli menukar kode, lalu me-refresh halaman / ganti HP / tab tertutup.
 *   Kalau kode langsung dianggap hangus, pembeli yang sudah bayar terkunci
 *   dan harus beli lagi → komplain & refund.
 *
 * Solusinya "masa tenggang": dalam N jam setelah penukaran pertama, kode yang
 * sama masih bisa dipakai untuk memulihkan sesi (bukan membeli akses baru).
 *
 * Ini aman secara bisnis karena batas pesanan studio (MAX_STUDIO_SUBMISSIONS)
 * dihitung PER KODE, bukan per sesi — jadi memulihkan sesi tidak menambah
 * jatah cetak/kirim yang kamu tanggung.
 */

// Hanya SATU perangkat yang boleh memakai satu kode.
// Perangkat pertama yang menukar "mengklaim" kode itu; yang lain ditolak.
// Kalau pembeli sah terkunci (mis. pindah dari browser dalam aplikasi TikTok
// ke Safari), kamu bisa melepas ikatannya dari halaman /admin.
const MAX_DEVICES = 1;

const STATUS = {
  OK: "ok", // penukaran pertama
  REENTRY: "reentry", // pemulihan sesi (belum pernah memesan)
  SPENT: "spent", // sudah dipakai memesan → hangus permanen
  OTHER_DEVICE: "other_device", // dipakai di perangkat lain (kode dibagikan?)
  USED: "used", // belum memesan, tapi sudah lewat batas waktu
  INVALID: "invalid", // kode tidak ada
};

/**
 * Urutan pemeriksaan (penting):
 *   1. kode tidak ada            → INVALID
 *   2. sudah dipakai MEMESAN     → SPENT  (hangus, berapa pun waktunya)
 *   3. belum pernah ditukar      → OK
 *   4. sudah ditukar, belum pesan, masih dalam batas waktu → REENTRY
 *   5. sisanya                   → USED
 *
 * Kenapa "sudah memesan" diperiksa lebih dulu daripada waktu:
 * yang menghanguskan kode adalah PESANAN TERKIRIM, bukan jam berjalan.
 * Pembeli yang masih mengisi formulir tidak boleh terkunci, sedangkan kode
 * yang sudah dipakai memesan langsung mati walau baru 10 detik.
 *
 * @param {object|undefined} entry isi codes.json untuk kode tsb
 * @param {object} opts { now:number, graceMs:number, maxSubmissions:number }
 * @returns {{status:string, since?:number, expiredAt?:number, submissions?:number}}
 */
function evaluateRedemption(entry, opts = {}) {
  const now = opts.now == null ? Date.now() : opts.now;
  const graceMs = opts.graceMs == null ? 3 * 3600 * 1000 : opts.graceMs;
  const maxSubmissions = opts.maxSubmissions == null ? 1 : opts.maxSubmissions;
  const deviceId = opts.deviceId || null;
  const maxDevices = opts.maxDevices == null ? MAX_DEVICES : opts.maxDevices;

  if (!entry) return { status: STATUS.INVALID };

  // Sudah dipakai memesan → hangus permanen, tidak peduli waktu
  const terpakai = entry.submissions || 0;
  if (terpakai >= maxSubmissions) {
    return { status: STATUS.SPENT, submissions: terpakai, ref: entry.lastRef || null };
  }

  if (!entry.used) return { status: STATUS.OK, claimDevice: deviceId };

  /* --- Pengikatan perangkat ---
     Tanpa ini, kode yang dibagikan di kolom komentar bisa dipakai siapa saja
     selama masa tenggang. Perangkat pertama yang menukar "mengklaim" kode itu;
     perangkat lain ditolak. Batas 2 supaya pembeli yang ganti HP atau
     kehilangan cache tidak ikut terkunci. */
  const devices = Array.isArray(entry.devices) ? entry.devices : [];
  const dikenal = deviceId && devices.includes(deviceId);
  if (devices.length > 0 && !dikenal && devices.length >= maxDevices) {
    return { status: STATUS.OTHER_DEVICE, devices: devices.length, maxDevices };
  }

  const usedAt = Date.parse(entry.usedAt || "");
  // Kode lama tanpa catatan waktu: beri kesempatan pulih daripada mengunci pembeli
  if (!usedAt || Number.isNaN(usedAt))
    return { status: STATUS.REENTRY, since: null, claimDevice: deviceId };

  const expiredAt = usedAt + graceMs;
  if (now <= expiredAt) return { status: STATUS.REENTRY, since: usedAt, expiredAt };

  return { status: STATUS.USED, since: usedAt, expiredAt };
}

module.exports = { evaluateRedemption, STATUS, MAX_DEVICES };
