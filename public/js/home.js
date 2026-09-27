/* ONE STRIP CLOVER — skrip halaman pembuka (/)
 * Berkas terpisah (bukan <script> inline) supaya CSP bisa melarang skrip inline.
 *
 * Isi:
 *   1. harga & tautan toko dari /api/config
 *   2. strip 3D: miring mengikuti kursor/jari, berputar saat digulir
 *   3. animasi muncul saat digulir
 *
 * Semua efek bersifat tambahan: tanpa skrip ini halaman tetap utuh & terbaca.
 */
(function () {
  "use strict";

  var hematGerak = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  document.documentElement.classList.add("js");

  /* ------------------------- tanggal & tahun ------------------------- */
  var kini = new Date();
  var tgl = document.getElementById("tanggal");
  if (tgl) {
    tgl.textContent = kini
      .toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" })
      .toUpperCase();
  }
  var thn = document.getElementById("tahun");
  if (thn) thn.textContent = String(kini.getFullYear());

  /* ------------------------ garis bawah navigasi ------------------------ */
  var nav = document.getElementById("nav");
  function cekNav() { if (nav) nav.classList.toggle("garis", window.scrollY > 8); }
  window.addEventListener("scroll", cekNav, { passive: true });
  cekNav();

  /* ------------------------- muncul saat digulir ------------------------- */
  var semua = document.querySelectorAll(".muncul, .cetak");
  if ("IntersectionObserver" in window && !hematGerak) {
    var pengamat = new IntersectionObserver(function (entri) {
      entri.forEach(function (e) {
        if (e.isIntersecting) {
          e.target.classList.add("tampil");
          pengamat.unobserve(e.target);
        }
      });
    }, { rootMargin: "0px 0px -8% 0px", threshold: 0.12 });
    semua.forEach(function (el) { pengamat.observe(el); });
  } else {
    semua.forEach(function (el) { el.classList.add("tampil"); });
  }

  /* ------------------------------ strip 3D ------------------------------
   * Sudut akhir = kemiringan dari kursor + ayunan pelan saat diam
   *             + putaran dari posisi gulir (strip berbalik memperlihatkan
   *               sisi belakang "dicetak & dikirim").
   * Nilai dihaluskan (lerp) supaya gerakannya terasa berbobot, bukan kaku.
   */
  var panggung = document.getElementById("panggung");
  var rig = document.getElementById("rig");
  var bayangan = document.getElementById("bayangan");

  if (panggung && rig) {
    var target = { x: 0, y: 0 };      // dari kursor, -1..1
    var halus = { x: 0, y: 0, putar: 0 };
    var terlihat = true;
    var terakhirBergerak = 0;

    function arahkan(clientX, clientY) {
      var r = panggung.getBoundingClientRect();
      target.x = Math.max(-1, Math.min(1, ((clientX - r.left) / r.width) * 2 - 1));
      target.y = Math.max(-1, Math.min(1, ((clientY - r.top) / r.height) * 2 - 1));
      terakhirBergerak = performance.now();
    }

    // Kursor di mana pun di halaman ikut menggerakkan strip (seperti menoleh)
    window.addEventListener("pointermove", function (e) {
      if (e.pointerType === "mouse") arahkan(e.clientX, e.clientY);
    }, { passive: true });
    // Di HP: geser jari di atas strip
    panggung.addEventListener("pointermove", function (e) {
      if (e.pointerType !== "mouse") arahkan(e.clientX, e.clientY);
    }, { passive: true });
    panggung.addEventListener("pointerleave", function () { target.x = 0; target.y = 0; });

    // Hemat baterai: berhenti menggambar saat panggung tidak terlihat / tab disembunyikan
    if ("IntersectionObserver" in window) {
      new IntersectionObserver(function (e) { terlihat = e[0].isIntersecting; }).observe(panggung);
    }

    function kemajuanGulir() {
      // 0 = panggung penuh di layar, 1 = panggung sudah hampir lewat atas
      var r = panggung.getBoundingClientRect();
      var p = -r.top / (r.height * 0.9);
      return Math.max(0, Math.min(1, p));
    }

    function gambar(t) {
      if (terlihat && !document.hidden) {
        var diam = t - terakhirBergerak > 2400;
        var ayun = hematGerak ? 0 : Math.sin(t / 1700) * (diam ? 1 : 0.25);

        halus.x += (target.x - halus.x) * 0.08;
        halus.y += (target.y - halus.y) * 0.08;
        halus.putar += ((hematGerak ? 0 : kemajuanGulir() * 180) - halus.putar) * 0.1;

        var ry = halus.x * 28 + ayun * 14 + halus.putar;
        var rx = -halus.y * 16 + (hematGerak ? 0 : Math.cos(t / 2100) * 3);

        rig.style.setProperty("--ry", ry.toFixed(2) + "deg");
        rig.style.setProperty("--rx", rx.toFixed(2) + "deg");
        // kilau bergerak berlawanan arah kemiringan
        rig.style.setProperty("--gx", (50 - halus.x * 45).toFixed(1) + "%");
        rig.style.setProperty("--gy", (30 - halus.y * 30).toFixed(1) + "%");
        if (bayangan) {
          bayangan.style.setProperty("--bx", (halus.x * -18).toFixed(1) + "px");
          bayangan.style.setProperty("--bs", (1 - Math.abs(Math.sin((ry * Math.PI) / 180)) * 0.45).toFixed(3));
        }
      }
      window.requestAnimationFrame(gambar);
    }
    window.requestAnimationFrame(gambar);
  }

  /* ---------------------- harga & tautan toko ----------------------
   * Diambil dari .env lewat /api/config — satu sumber, sama dengan yang
   * dipakai halaman photobox. Elemen dibuat lewat DOM (bukan innerHTML),
   * jadi nilai setelan tidak pernah bisa menjadi HTML/skrip.
   */
  function tautanAman(url) {
    return /^https?:\/\//i.test(String(url || "").trim());
  }

  fetch("/api/config")
    .then(function (r) { return r.json(); })
    .then(function (d) {
      if (!d || !d.ok || !d.hasShop || !d.shops) return;

      var tautan = [
        ["TikTok Shop", d.shops.tiktok, ""],
        ["Tokopedia", d.shops.tokopedia, ""],
        ["Shopee", d.shops.shopee, ""],
      ].filter(function (t) { return tautanAman(t[1]); });

      if (d.shops.whatsapp && /^\d{8,15}$/.test(String(d.shops.whatsapp))) {
        var pesan = encodeURIComponent("Halo, saya mau beli kode One Strip Clover");
        tautan.push(["💬 WhatsApp", "https://wa.me/" + d.shops.whatsapp + "?text=" + pesan, "wa"]);
      }
      if (!tautan.length) return;

      if (d.price) document.getElementById("harga").textContent = d.price;
      var wadah = document.getElementById("beliLinks");
      wadah.textContent = "";
      tautan.forEach(function (t) {
        var a = document.createElement("a");
        a.textContent = t[0];
        a.href = t[1];
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        if (t[2]) a.className = t[2];
        wadah.appendChild(a);
      });
      document.getElementById("beliBox").style.display = "block";
    })
    .catch(function () {
      /* halaman tetap tampil normal walau setelan toko gagal dimuat */
    });
})();
