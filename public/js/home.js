/* ONE STRIP CLOVER — skrip halaman pembuka (/)
 * Berkas terpisah (bukan <script> inline) supaya CSP bisa melarang skrip inline.
 */
/* Harga & tautan toko diambil dari .env lewat /api/config — satu sumber,
   sama dengan yang dipakai halaman photobox. */
(async () => {
  try {
    const r = await fetch("/api/config");
    const d = await r.json();
    if (!d || !d.ok || !d.hasShop) return;

    const tautan = [
      ["TikTok Shop", d.shops.tiktok, ""],
      ["Tokopedia", d.shops.tokopedia, ""],
      ["Shopee", d.shops.shopee, ""],
    ].filter(([, u]) => u);

    if (d.shops.whatsapp) {
      const pesan = encodeURIComponent("Halo, saya mau beli kode One Strip Clover");
      tautan.push(["💬 WhatsApp", "https://wa.me/" + d.shops.whatsapp + "?text=" + pesan, "wa"]);
    }
    if (!tautan.length) return;

    if (d.price) document.getElementById("harga").textContent = d.price;
    document.getElementById("beliLinks").innerHTML = tautan
      .map(function (t) {
        return '<a class="' + t[2] + '" href="' + t[1] +
               '" target="_blank" rel="noopener noreferrer">' + t[0] + "</a>";
      })
      .join("");
    document.getElementById("beliBox").style.display = "block";
  } catch (e) {
    /* halaman tetap tampil normal walau setelan toko gagal dimuat */
  }
})();
