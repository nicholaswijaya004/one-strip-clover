/**
 * ANTREAN PENGIRIMAN (retry queue)
 *
 * Masalah yang dipecahkan (temuan audit poin A):
 *   Kalau email DAN Drive sama-sama gagal, pembeli disuruh "coba lagi".
 *   Kalau dia keburu menutup halaman, fotonya HILANG SELAMANYA — padahal
 *   dia sudah bayar dan kodenya mungkin sudah hangus.
 *
 * Cara kerja:
 *   1. Pengiriman gagal → seluruh pesanan (foto + data) ditulis ke
 *      data/pending/<ref>.json
 *   2. Pembeli tetap mendapat konfirmasi — pesanannya memang sudah kami terima
 *   3. Proses latar mencoba mengirim ulang tiap beberapa menit
 *   4. Berhasil → berkas dihapus. Gagal terus sampai batas usia → ditandai
 *      "gagal permanen" supaya kamu bisa memprosesnya manual
 *
 * TIDAK butuh database. Hanya file di volume yang sudah kamu punya.
 * Ukurannya kecil karena HANYA pesanan gagal yang disimpan.
 */

const fs = require("fs");
const path = require("path");

const DIR = path.join(__dirname, "..", "data", "pending");
const GAGAL_DIR = path.join(__dirname, "..", "data", "failed");

function pastikanFolder() {
  for (const d of [DIR, GAGAL_DIR]) {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  }
}

/** Simpan pesanan yang gagal dikirim */
function park(ref, payload) {
  pastikanFolder();
  const berkas = path.join(DIR, `${sanitize(ref)}.json`);
  const isi = {
    ref,
    payload,
    percobaan: 0,
    dibuatPada: new Date().toISOString(),
    terakhirDicoba: null,
    errorTerakhir: null,
  };
  const tmp = berkas + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(isi));
  fs.renameSync(tmp, berkas); // atomik
  return berkas;
}

function daftar() {
  pastikanFolder();
  return fs
    .readdirSync(DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => path.join(DIR, f));
}

function baca(berkas) {
  try {
    return JSON.parse(fs.readFileSync(berkas, "utf8"));
  } catch {
    return null;
  }
}

function hapus(berkas) {
  try {
    fs.unlinkSync(berkas);
  } catch {
    /* sudah terhapus */
  }
}

/** Pindahkan ke folder "failed" — butuh penanganan manual */
function menyerah(berkas, data) {
  pastikanFolder();
  try {
    fs.writeFileSync(
      path.join(GAGAL_DIR, path.basename(berkas)),
      JSON.stringify(data, null, 2)
    );
    fs.unlinkSync(berkas);
  } catch {
    /* abaikan */
  }
}

function sanitize(s) {
  return String(s).replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 60);
}

function stats() {
  pastikanFolder();
  return {
    menunggu: fs.readdirSync(DIR).filter((f) => f.endsWith(".json")).length,
    gagalPermanen: fs.readdirSync(GAGAL_DIR).filter((f) => f.endsWith(".json")).length,
  };
}

/**
 * Jalankan proses coba-ulang.
 * @param {(payload:object)=>Promise<{ok:boolean, errors?:string[]}>} kirim
 * @param {object} opts { maxUsiaJam, jedaMenit, log }
 */
function mulaiRetryLoop(kirim, opts = {}) {
  const maxUsiaMs = (opts.maxUsiaJam || 24) * 3600 * 1000;
  const jedaMs = (opts.jedaMenit || 5) * 60 * 1000;
  const log = opts.log || console;

  async function putaran() {
    const berkasList = daftar();
    if (berkasList.length === 0) return;

    log.info?.("retry.mulai", { jumlah: berkasList.length });

    for (const berkas of berkasList) {
      const data = baca(berkas);
      if (!data) {
        hapus(berkas);
        continue;
      }

      const usia = Date.now() - Date.parse(data.dibuatPada || 0);
      if (usia > maxUsiaMs) {
        log.error?.("retry.menyerah", {
          ref: data.ref,
          percobaan: data.percobaan,
          errorTerakhir: data.errorTerakhir,
          hint: "proses manual — berkasnya ada di data/failed/",
        });
        menyerah(berkas, data);
        continue;
      }

      try {
        data.percobaan++;
        data.terakhirDicoba = new Date().toISOString();
        const hasil = await kirim(data.payload);
        if (hasil && hasil.ok) {
          log.info?.("retry.berhasil", { ref: data.ref, percobaan: data.percobaan });
          hapus(berkas);
          continue;
        }
        data.errorTerakhir = (hasil && hasil.errors && hasil.errors.join(" | ")) || "tidak diketahui";
      } catch (e) {
        data.errorTerakhir = e.message;
      }

      // simpan kembali dengan hitungan percobaan terbaru
      try {
        fs.writeFileSync(berkas, JSON.stringify(data));
      } catch {
        /* abaikan */
      }
      log.warn?.("retry.belum_berhasil", {
        ref: data.ref,
        percobaan: data.percobaan,
        err: data.errorTerakhir,
      });
    }
  }

  const timer = setInterval(() => {
    putaran().catch((e) => log.error?.("retry.loop_error", { msg: e.message }));
  }, jedaMs);
  timer.unref();

  // coba sekali segera setelah server hidup (mis. setelah SMTP kembali normal)
  setTimeout(() => putaran().catch(() => {}), 15000).unref();

  return () => clearInterval(timer);
}

module.exports = { park, daftar, baca, hapus, stats, mulaiRetryLoop, DIR, GAGAL_DIR };
