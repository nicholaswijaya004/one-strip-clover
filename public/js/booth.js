/* ONE STRIP CLOVER — skrip halaman photobox (/booth)
 *
 * Dulu skrip ini menempel di booth.html sebagai <script> inline. Dipindah ke
 * berkas sendiri supaya CSP bisa melarang skrip inline ('unsafe-inline'):
 * kalau suatu hari ada celah XSS, skrip sisipan penyerang TIDAK akan jalan.
 */
// Kalau modul bersama gagal dimuat (mis. browser memakai versi lama dari
  // cache), halaman akan rusak sebagian tanpa pesan. Ini membuatnya terlihat.
  window.__oscSiap = !!(window.StripRenderer && window.StripRenderer.LAYOUT_BAWAAN);

/* ===================================================================
   TOKO — harga & link diatur lewat file .env di server, BUKAN di sini.
   Buka .env lalu isi:
       PREMIUM_PRICE=Rp 15.000
       SHOP_TIKTOK=https://...
       SHOP_TOKOPEDIA=https://...
       SHOP_SHOPEE=https://...
       SHOP_WHATSAPP=6281234567890
   Lalu restart server. Yang dikosongkan tidak akan muncul tombolnya.
   Nilai di bawah cuma cadangan kalau server belum sempat menjawab.
   =================================================================== */
const SHOP = {
  price: "",
  links: { "TikTok Shop":"", "Tokopedia":"", "Shopee":"" },
  waAdmin: "",
  benefits: [
    "3 bingkai eksklusif: Blush, Mint & Plum",
    "Unduhan HD tanpa watermark",
    "Strip dicetak & dikirim ke rumahmu — lucky charm asli",
  ],
};

/* ------------------------- template strip -------------------------
   Kalau admin sudah mengunggah desain strip, gambar itu yang dipakai —
   foto pembeli ditempel di kotak yang posisinya diatur dari /admin. */
// Daftar template dari admin. Tiap template = satu pilihan bingkai.
const TPL = { items:[], images:{} };  // images: id → objek gambar yang sudah dimuat

async function loadTemplate(){
  try{
    const r = await fetch(ROUTE.TEMPLATE);
    const d = await r.json();
    TPL.items = (d && Array.isArray(d.items)) ? d.items : [];

    // muat semua gambar template lebih dulu supaya langsung bisa dipakai
    await Promise.all(TPL.items.map(async (it)=>{
      try{
        TPL.images[it.id] = await loadImg(
          "/api/template/image?id=" + it.id + "&v=" + encodeURIComponent(it.versi||"1"));
      }catch(e){ /* satu gagal, lainnya tetap jalan */ }
    }));

    rebuildFrames();
    if(TPL.items.length){ S.frameIdx = 0; terapkanRasioFoto(TPL.items[0].layout); }
    renderFrameStrip();
    if(S.photos.length===SHOTS) composeStrip();
  }catch(e){
    console.warn("[ONE STRIP CLOVER] Template gagal dimuat, pakai desain bawaan:", e.message);
    TPL.items = [];
  }
}
/* Ambil setelan toko dari server, lalu gambar ulang kotak "beli kode" */
async function loadShopConfig(){
  try{
    const r = await fetch(ROUTE.CONFIG);
    const d = await r.json();
    if(!d || !d.ok) return;
    SHOP.price = d.price || "";
    SHOP.links["TikTok Shop"] = (d.shops && d.shops.tiktok)    || "";
    SHOP.links["Tokopedia"]   = (d.shops && d.shops.tokopedia) || "";
    SHOP.links["Shopee"]      = (d.shops && d.shops.shopee)    || "";
    SHOP.waAdmin              = (d.shops && d.shops.whatsapp)  || "";
  }catch(e){
    console.warn("[ONE STRIP CLOVER] Gagal memuat /api/config:", e.message);
  }
  renderBuyBox();
}

/* =============================== state =============================== */
const S = {
  stream: null,
  photos: [],        // raw dataURLs of the 4 shots (mirrored back to normal)
  filter: "warna",
  frameIdx: 0,
  premium: false,
  token: null,
  lastStrip: null,
  takenAt: null,
  code: null,
  genFailed: false,
  cancel: false,
  busy: false,
};

const FILTERS = StripRenderer.FILTERS;


// Daftar bingkai & filter diambil dari modul bersama — kalau ditulis ulang
// di sini, suatu hari daftarnya beda dengan yang dipakai server.
// Daftar bingkai. Kalau admin sudah mengunggah template, template itu
// muncul sebagai pilihan PERTAMA di baris Bingkai — jadi pembeli bisa
// memilih desainmu atau kembali ke bingkai bawaan.
let FRAMES = [];
function rebuildFrames(){
  const bawaan = StripRenderer.FRAMES.map(f => ({
    ...f, name: f.name + (f.premium ? " ★" : "")
  }));
  const template = TPL.items.map(it => ({
    id: "__tpl_" + it.id,
    name: it.nama,
    premium: false,
    isTemplate: true,
    templateId: it.id,
    layout: it.layout,
  }));
  FRAMES = [...template, ...bawaan]; // template dulu, lalu bingkai bawaan
}

const $ = (id) => document.getElementById(id);

// Foto KOTAK (1:1) di semua perangkat.
// Alasannya bukan selera: 3 foto kotak menghasilkan strip berbanding 1 : 3,
// yaitu ukuran strip photobox klasik (2 x 6 inci). Kalau fotonya 4:3, strip
// jadi 1 : 2,37 — terlihat pendek dan gemuk.
// Nilai ini dipakai di 3 tempat (pratinjau, jepretan, komposisi strip)
// supaya yang dilihat = yang didapat, dan hasilnya sama di HP maupun laptop.
// Rasio pratinjau kamera = rasio kotak foto di strip (5:4).
// Kalau tidak disamakan, pembeli membingkai wajahnya di kotak persegi lalu
// hasil cetaknya terpotong — yang dilihat bukan yang didapat.
let ASPECT = StripRenderer.LAYOUT_BAWAAN.photoWmm / StripRenderer.LAYOUT_BAWAAN.photoHmm;

/* Kalau template memakai foto 5:4 (atau rasio lain), pratinjau kamera dan
   hasil jepretan ikut menyesuaikan — supaya yang dilihat = yang dicetak. */
function terapkanRasioFoto(layout){
  const L = layout || StripRenderer.LAYOUT_BAWAAN;
  if(!L.photoWmm || !L.photoHmm) return;
  ASPECT = L.photoWmm / L.photoHmm;
  const vp = document.querySelector(".viewport");
  if(vp) vp.style.aspectRatio = String(ASPECT);
}
jalankan("terapkanRasioFoto", ()=>terapkanRasioFoto(null));

// Jumlah foto per sesi — diambil dari modul bersama supaya browser & server
// tidak mungkin berbeda angka.
const SHOTS = (window.StripRenderer && window.StripRenderer.PHOTO_COUNT) || 3;

/* Kode error & alamat API diambil dari kontrak bersama (shared/contract.js),
   BUKAN ditulis ulang sebagai teks. Kalau server mengganti nama sebuah kode,
   sisi ini ikut berubah — tidak ada lagi perbandingan teks yang diam-diam
   tidak pernah cocok. */
const ERR = OSC.ERR, ROUTE = OSC.ROUTE;

/* Teks dari server/env yang masuk ke innerHTML WAJIB lewat esc() —
   membuang < > saja tidak menghentikan tanda kutip keluar dari atribut. */
const esc=(v)=>String(v==null?"":v).replace(/[&<>"'`]/g,(c)=>(
  {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;","`":"&#96;"}[c]));

/* ---------------- penampil error di layar ----------------
   Tanpa ini, satu baris yang gagal membuat separuh halaman mati diam-diam
   (kamera tidak jalan, bingkai kosong, tombol tidak bereaksi) dan sulit
   ditebak penyebabnya. Sekarang errornya muncul jelas beserta cara benahi. */
function tampilkanErrorFatal(pesan, detail){
  try{
    const d=document.createElement("div");
    d.style.cssText="position:fixed;inset:0;z-index:999;background:#3B2E38;color:#fff;"+
      "display:grid;place-items:center;padding:28px;text-align:center;font-family:system-ui";
    d.innerHTML="<div style='max-width:420px;line-height:1.6'>"+
      "<div style='font-size:34px;margin-bottom:10px'>🍀</div>"+
      "<h2 style='margin-bottom:10px;font-size:19px'>"+esc(pesan)+"</h2>"+
      "<p style='font-size:13.5px;opacity:.85'>Coba <b>muat ulang paksa</b>: "+
      "Cmd+Shift+R (Mac) atau Ctrl+Shift+R (Windows).</p>"+
      "<pre style='margin-top:14px;font-size:11px;opacity:.7;white-space:pre-wrap;text-align:left'>"+
      esc(String(detail||"").slice(0,300))+"</pre></div>";
    document.body.appendChild(d);
  }catch(e){ alert(pesan); }
}

if(!window.__oscSiap){
  tampilkanErrorFatal(
    "Berkas tampilan belum lengkap dimuat",
    "strip-renderer.js tidak termuat atau versinya lama (cache browser)."
  );
  throw new Error("StripRenderer belum siap");
}

/* Banner error kecil di atas layar. Tanpa ini, satu baris yang gagal membuat
   halaman "diam saja" — tombol tidak bereaksi tanpa penjelasan apa pun. */
function bannerError(teks){
  let b=document.getElementById("errBanner");
  if(!b){
    b=document.createElement("div");
    b.id="errBanner";
    b.style.cssText="position:fixed;top:0;left:0;right:0;z-index:9999;background:#C0526B;"+
      "color:#fff;font:12px/1.5 system-ui;padding:10px 14px;white-space:pre-wrap;"+
      "max-height:40vh;overflow:auto";
    document.body.appendChild(b);
  }
  b.textContent += teks + "\n";
}

window.addEventListener("error", (e)=>{
  console.error("[ONE STRIP CLOVER]", e.message, e.filename, e.lineno);
  bannerError("⚠️ " + e.message + "  (" + String(e.filename||"").split("/").pop() + ":" + e.lineno + ")");
});
window.addEventListener("unhandledrejection", (e)=>{
  bannerError("⚠️ " + ((e.reason && e.reason.message) || e.reason));
});

/* Jalankan satu langkah persiapan secara terisolasi.
   Kalau satu langkah gagal, langkah lain TETAP jalan — jadi kamera dan
   tombol premium tidak ikut mati hanya karena thumbnail bingkai bermasalah. */
function jalankan(nama, fn){
  try{ return fn(); }
  catch(err){
    console.error("[ONE STRIP CLOVER] gagal di:", nama, err);
    bannerError("⚠️ Gagal di \"" + nama + "\": " + err.message);
    return null;
  }
}

// Penanda build — buka Console (F12) untuk memastikan versi yang jalan
console.log("%c🍀 One Strip Clover", "color:#AEAF4E;font-weight:700",
  "| tata letak mm-grid | foto " +
  StripRenderer.LAYOUT_BAWAAN.photoWmm + " x " + StripRenderer.LAYOUT_BAWAAN.photoHmm + " mm (5:4)" +
  " | strip " + StripRenderer.STRIP_W_MM + " x " + StripRenderer.STRIP_H_MM + " mm");
const cam=$("cam"), lensMsg=$("lensMsg"), rec=$("rec"), shots=$("shots"),
  countdown=$("countdown"), flash=$("flash"), startBtn=$("startBtn");

/* ============================== controls ============================== */
$("filterSeg").addEventListener("click",(e)=>{
  const b=e.target.closest("button"); if(!b) return;
  S.filter=b.dataset.f;
  document.querySelectorAll("#filterSeg button").forEach(x=>x.classList.toggle("on",x===b));
  cam.style.filter=FILTERS[S.filter];
  if(S.photos.length===SHOTS) composeStrip(); // re-render strip with new filter
});
cam.style.filter=FILTERS.warna;

/* -------- thumbnail mini tiap bingkai (biar kelihatan sebelum dipilih) -------- */
function frameThumb(frame){
  const W=104,H=148;
  const c=document.createElement("canvas"); c.width=W; c.height=H;
  const x=c.getContext("2d");
  const st=StripRenderer.frameStyle(frame.id);

  x.fillStyle=st.bg; x.fillRect(0,0,W,H);
  if(st.wash){ x.fillStyle=st.wash; x.fillRect(0,0,W,H); }

  const pad=W*0.14, pw=W-pad*2, ph=pw*0.62, gap=H*0.045;
  for(let i=0;i<3;i++){
    const y=pad*0.8+i*(ph+gap);
    x.fillStyle=st.dark?"#4A3A46":"#D7D0C4";
    x.fillRect(pad,y,pw,ph);
    x.fillStyle=st.dark?"#5D4A58":"#C3BAAB";
    x.beginPath(); x.arc(pad+pw*0.5,y+ph*0.42,ph*0.22,0,Math.PI*2); x.fill();
  }

  StripRenderer.drawFrameDecor(x, frame.id, W, H, {thumb:true});

  x.fillStyle=st.accent;
  x.fillRect(pad,H-pad*0.85,pw,2.5);
  return c.toDataURL("image/png");
}

/* Gaya tiap bingkai — satu sumber kebenaran untuk thumbnail & strip asli */
function renderFrameStrip(){
  const strip=$("frameStrip");
  if(!strip){ console.warn("[OSC] elemen frameStrip tidak ditemukan"); return; }

  strip.innerHTML = FRAMES.map((f,i)=>{
    const locked = f.premium && !S.premium;

    // Kalau menggambar thumbnail gagal, JANGAN jatuhkan seluruh baris bingkai.
    // Cukup tampilkan kotak warna polos — pengguna tetap bisa memilih bingkai,
    // dan kamera serta tombol premium tetap hidup.
    let gambar;
    try{
      gambar = f.isTemplate
        ? `<img src="/api/template/image?id=${encodeURIComponent(f.templateId)}" alt="Template ${esc(f.name)}">`
        : `<img src="${frameThumb(f)}" alt="Bingkai ${esc(f.name)}">`;
    }catch(err){
      console.error("[OSC] thumbnail gagal untuk bingkai", f.id, err);
      const st = (StripRenderer.frameStyle && StripRenderer.frameStyle(f.id)) || {bg:"#EEE"};
      gambar = `<span style="display:block;width:54px;height:76px;border-radius:8px;
                 border:2px solid transparent;background:${st.bg}"></span>`;
    }

    return `<button class="fthumb ${i===S.frameIdx?"on":""}" data-i="${i}"
              role="option" aria-selected="${i===S.frameIdx}" title="${esc(f.name)}">
        ${gambar}
        <span class="fname">${esc(f.name.replace(" ★",""))}${locked?' <span class="lock">🔒</span>':""}</span>
      </button>`;
  }).join("");
}

$("frameStrip").addEventListener("click",(e)=>{
  const b=e.target.closest(".fthumb"); if(!b) return;
  S.frameIdx=Number(b.dataset.i);
  const f=FRAMES[S.frameIdx];
  terapkanRasioFoto(f && f.isTemplate ? f.layout : StripRenderer.LAYOUT_BAWAAN);
  renderFrameStrip();
  b.scrollIntoView({block:"nearest",inline:"nearest"});
  if(S.photos.length===SHOTS) composeStrip();
});
rebuildFrames();
jalankan("renderFrameStrip", renderFrameStrip);
jalankan("renderStudioBtn", renderStudioBtn);

/* ---------------------- render kotak "beli kode" ---------------------- */
/* Murni (tanpa DOM) supaya bisa diuji: tentukan isi & perlu tampil atau tidak */
function buyBoxState(shop){
  const links = (shop && shop.links) || {};
  const entries = Object.entries(links).filter(([,u]) => u && String(u).trim());
  const wa = shop && shop.waAdmin ? String(shop.waAdmin).trim() : "";

  let html = entries.map(([name,url],i)=>{
    // kalau jumlahnya ganjil, tombol terakhir dibuat selebar 2 kolom
    const wide = (entries.length % 2 === 1 && i === entries.length-1 && !wa) ? " wide" : "";
    // Hanya http(s) — "javascript:" dari setelan yang salah tidak boleh jadi tautan
    if(!/^https?:\/\//i.test(String(url).trim())) return "";
    return `<a class="${wide.trim()}" href="${esc(String(url).trim())}" target="_blank" rel="noopener noreferrer">${esc(name)}</a>`;
  }).join("");

  if(wa){
    const wide = entries.length % 2 === 0 ? " wide" : "";
    html += `<a class="wa${wide}" target="_blank" rel="noopener noreferrer"
      href="https://wa.me/${encodeURIComponent(wa)}?text=${encodeURIComponent("Halo, saya mau beli kode One Strip Clover")}">💬 Chat admin</a>`;
  }

  return { visible: html.length > 0, html };
}

function renderBuyBox(){
  $("benefitList").innerHTML = SHOP.benefits.map(b=>`<li>${esc(b)}</li>`).join("");
  $("priceTag").innerHTML = SHOP.price
    ? esc(SHOP.price) + `<small>Berlaku untuk 1 sesi photobox</small>`
    : "";
  $("priceTag").style.display = SHOP.price ? "" : "none";

  const st = buyBoxState(SHOP);
  $("shopLinks").innerHTML = st.html;
  // PENTING: selalu set kedua-duanya. Dulu kotaknya disembunyikan saat render
  // pertama (setelan belum datang dari server) dan tidak pernah dimunculkan lagi.
  $("buyBox").style.display = st.visible ? "" : "none";

  if(!st.visible){
    console.warn("[ONE STRIP CLOVER] Link toko masih kosong. Isi SHOP_TIKTOK / SHOP_TOKOPEDIA / "+
                 "SHOP_SHOPEE / SHOP_WHATSAPP di file .env lalu restart server.");
  }
}
renderBuyBox();

/* ------------------ ingat sesi premium di perangkat ------------------ */
/* Kenapa perlu: kalau tidak, sekali refresh pembeli kehilangan akses padahal
   kodenya sudah hangus → mereka harus beli lagi. Ini menyimpan token + kode
   secara lokal, lalu memulihkannya otomatis saat halaman dibuka lagi.      */
const STORE_KEY = "osc_premium";
const DEVICE_KEY = "osc_device";

/* ID perangkat: angka acak yang dibuat sekali lalu disimpan di perangkat ini.
   Bukan data pribadi — tidak berisi info apa pun tentang pemiliknya.
   Gunanya: mengikat kode ke SATU perangkat, supaya kode yang dibagikan ke
   orang lain tidak bisa dipakai. */
function deviceId(){
  try{
    let id = localStorage.getItem(DEVICE_KEY);
    if(!id){
      id = (crypto.randomUUID ? crypto.randomUUID()
            : String(Date.now()) + Math.random().toString(36).slice(2));
      localStorage.setItem(DEVICE_KEY, id);
    }
    return id;
  }catch(e){
    // Mode privat: penyimpanan diblokir. Kirim null — server akan
    // memperlakukannya sebagai perangkat baru.
    return null;
  }
}

function saveSession(token, code){
  try{
    localStorage.setItem(STORE_KEY, JSON.stringify({token, code, at:Date.now()}));
  }catch(e){ /* mode privat / storage penuh → diabaikan, ada jalur ketik ulang kode */ }
}
function loadSession(){
  try{ return JSON.parse(localStorage.getItem(STORE_KEY) || "null"); }
  catch(e){ return null; }
}
function clearSession(){
  try{ localStorage.removeItem(STORE_KEY); }catch(e){}
}

function applyPremium(code, token){
  S.premium = true;
  S.token = token;
  S.code = code;
  $("premiumBadge").style.display = "block";
  renderFrameStrip();
  renderStudioBtn();
}

async function restorePremium(){
  const saved = loadSession();
  if(!saved || !saved.token) return;

  // 1) token masih sah?
  try{
    const r = await fetch(ROUTE.SESSION,{method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({token:saved.token})});
    const d = await r.json();
    if(d.ok){
      applyPremium(d.code, saved.token);
      toast("🍀 Sesi premium dipulihkan.", 2600);
      return;
    }
  }catch(e){ /* offline → coba jalur berikutnya */ }

  // 2) token kedaluwarsa tapi kodenya masih dalam masa tenggang → tukar ulang
  if(saved.code){
    try{
      const r = await fetch(ROUTE.REDEEM,{method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({code:saved.code, deviceId:deviceId()})});
      const d = await r.json();
      if(d.ok){
        applyPremium(saved.code, d.token);
        saveSession(d.token, saved.code);
        toast("🍀 Sesi premium dipulihkan.", 2600);
        return;
      }
    }catch(e){}
  }

  clearSession(); // benar-benar sudah lewat → bersihkan
}

/* ------------------------------- toast ------------------------------- */
let toastTimer;
// Teks biasa, BUKAN HTML: beberapa pesan menyertakan data dari halaman
// (mis. nomor pesanan), dan textContent tidak pernah bisa menjalankan markup.
function toast(teks, ms){
  const t=$("toast");
  t.textContent=teks; t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer=setTimeout(()=>t.classList.remove("show"), ms||4000);
}

/* =============================== camera =============================== */
async function startCamera(){
  if(S.stream) return true;
  if(!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia){
    lensMsg.style.display="grid";
    lensMsg.innerHTML="Kamera hanya bisa jalan lewat <b>http://localhost:3000</b> (server) atau situs <b>HTTPS</b> — bukan file yang dibuka langsung.<br><br>Sementara itu, pakai tombol <b>Unggah foto</b> ya.";
    return false;
  }
  try{
    S.stream = await navigator.mediaDevices.getUserMedia({
      video:{ facingMode:"user", width:{ideal:1280}, height:{ideal:960} }, audio:false
    });
    cam.srcObject=S.stream;
    lensMsg.style.display="none";
    rec.classList.add("live");
    return true;
  }catch(err){
    lensMsg.style.display="grid";
    lensMsg.innerHTML="Kamera tidak bisa diakses 😢<br>Izinkan kamera di browser (ikon 🔒 di address bar), atau pakai tombol <b>Unggah foto</b>.";
    return false;
  }
}

function captureFrame(){
  const vw=cam.videoWidth||1280, vh=cam.videoHeight||960;
  // potong bagian tengah video agar rasionya sama persis dengan preview
  let sw=vw, sh=vh;
  if(vw/vh > ASPECT) sw = vh*ASPECT; else sh = vw/ASPECT;
  const sx=(vw-sw)/2, sy=(vh-sh)/2;

  const c=document.createElement("canvas");
  c.width=Math.round(sw); c.height=Math.round(sh);
  const ctx=c.getContext("2d");
  ctx.translate(c.width,0); ctx.scale(-1,1); // un-mirror
  ctx.drawImage(cam, sx,sy,sw,sh, 0,0,c.width,c.height);
  return c.toDataURL("image/jpeg",0.92);
}

const wait=(ms)=>new Promise(r=>setTimeout(r,ms));
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

function endSession(){
  S.busy=false; S.cancel=false;
  startBtn.disabled=false;
  startBtn.style.display=""; $("uploadLabel").style.display="";
  $("cancelBtn").style.display="none";
  countdown.style.display="none";
  shots.textContent="";
}

$("cancelBtn").onclick=()=>{ S.cancel=true; };            // jalan keluar (#4)
addEventListener("keydown",(e)=>{ if(e.key==="Escape" && S.busy) S.cancel=true; });

if(startBtn) startBtn.addEventListener("click", async ()=>{
  if(S.busy) return;
  const ok=await startCamera(); if(!ok) return;

  S.busy=true; S.cancel=false;
  startBtn.disabled=true;
  startBtn.style.display="none"; $("uploadLabel").style.display="none";
  $("cancelBtn").style.display="";
  S.photos=[]; $("slotWrap").style.display="none";

  // aba-aba dulu supaya tidak kaget (#8)
  countdown.style.display="grid";
  countdown.style.fontSize="26px";
  countdown.textContent=`Bersiap… ${SHOTS} foto!`;
  await wait(reduceMotion?500:1400);
  countdown.style.fontSize="";

  for(let i=1;i<=SHOTS;i++){
    if(S.cancel) break;
    shots.textContent=`FOTO ${i}/${SHOTS}`;
    for(let n=3;n>=1;n--){
      if(S.cancel) break;
      countdown.textContent=n; countdown.style.display="grid";
      await wait(reduceMotion?350:800);
    }
    if(S.cancel) break;
    countdown.style.display="none";
    flash.classList.remove("on"); void flash.offsetWidth; flash.classList.add("on");
    S.photos.push(captureFrame());
    await wait(500);
  }

  if(S.cancel){
    S.photos=[];
    endSession();
    toast("Sesi dibatalkan. Tekan Mulai Sesi kapan pun kamu siap.", 3000);
    return;
  }

  S.takenAt=new Date().toISOString();
  endSession();
  composeStrip();
});

/* ============================ upload path ============================= */
if($("uploadInput")) $("uploadInput").addEventListener("change", async (e)=>{
  const files=[...e.target.files].slice(0,SHOTS);
  if(files.length===0) return;
  S.photos=[];
  for(const f of files){
    const mentah = await new Promise((res)=>{
      const r=new FileReader(); r.onload=()=>res(r.result); r.readAsDataURL(f);
    });
    try{ S.photos.push(await normalkanFoto(mentah)); }
    catch(err){ toast("Foto ini tidak bisa dibaca browser. Coba foto lain (JPG/PNG) ya.", 5000); return; }
  }
  while(S.photos.length<SHOTS) S.photos.push(S.photos[S.photos.length-1]); // lengkapi kalau kurang
  S.takenAt=new Date().toISOString();
  composeStrip();
  e.target.value="";
});

/* Foto dari galeri HP bisa 48 MP / 15 MB / WebP. Dikirim mentah = unggahan
   lambat di data seluler, dan ditolak server (batas 24 MP, hanya JPEG/PNG —
   pengaman anti bom dekompresi). Jadi SELALU di-encode ulang di browser:
   JPEG, sisi terpanjang maks. 2400 px (lebih dari cukup untuk cetak 300 dpi). */
async function normalkanFoto(dataUrl){
  const im = await loadImg(dataUrl);
  const MAKS = 2400;
  const skala = Math.min(1, MAKS / Math.max(im.naturalWidth, im.naturalHeight));
  const c=document.createElement("canvas");
  c.width=Math.max(1, Math.round(im.naturalWidth*skala));
  c.height=Math.max(1, Math.round(im.naturalHeight*skala));
  c.getContext("2d").drawImage(im,0,0,c.width,c.height);
  return c.toDataURL("image/jpeg",0.92);
}

/* =========================== strip composer =========================== */
function loadImg(src){return new Promise((res,rej)=>{
  const im=new Image(); im.onload=()=>res(im); im.onerror=rej; im.src=src;
});}

async function composeStrip(opts){
  const o = opts || {};
  // o.studio = true → versi bersih untuk studio: HD, tanpa watermark,
  //                   tidak mengubah tampilan halaman
  try{
    const HD = o.studio ? true : S.premium;
    const W  = o.studio ? 1200 : (HD ? 960 : 480);

    const images = [];
    for(let i=0;i<SHOTS;i++) images.push(await loadImg(S.photos[i]));

    // Tinggi selalu dari ukuran fisik strip (56,1 x 171,5 mm), baik memakai
    // template maupun bingkai bawaan — supaya hasil cetaknya identik.
    const H = Math.ceil(StripRenderer.stripHeight(W));
    const c=document.createElement("canvas"); c.width=W; c.height=H;
    const ctx=c.getContext("2d");

    const frame=FRAMES[S.frameIdx];
    // Bingkai premium tetap bisa dilihat pemakai gratis (berwatermark) —
    // ini yang mendorong mereka membeli kode.
    StripRenderer.drawStrip(ctx, images, {
      width:W, aspect:ASPECT,
      frameId:frame.id, filter:S.filter,
      // Template dipakai HANYA kalau pembeli memilih bingkai template.
      templateImage: frame.isTemplate ? (TPL.images[frame.templateId] || null) : null,
      layout: frame.isTemplate ? frame.layout : StripRenderer.LAYOUT_BAWAAN,
      watermark: !S.premium && !o.studio,
      dateText:new Date().toLocaleDateString("id-ID",
        {day:"2-digit",month:"short",year:"numeric"}).toUpperCase(),
    });

    if(o.studio) return c.toDataURL("image/jpeg",0.95);

    const url=c.toDataURL("image/jpeg",0.92);
    S.lastStrip=url;
    const strip=$("stripImg");
    strip.classList.remove("printed");
    strip.src=url;
    $("slotWrap").style.display="block";
    $("howto").style.display="none";
    requestAnimationFrame(()=>strip.classList.add("printed"));

    const lockedPreview = frame.premium && !S.premium;
    $("qualityHint").innerHTML = S.premium
      ? "Kualitas HD tanpa watermark. Terima kasih! 🍀"
      : lockedPreview
        ? `Ini preview bingkai <b>premium</b> (watermark). <a href="#" id="hintUnlock">Buka dengan kode</a> untuk unduhan bersih &amp; HD.`
        : `Versi gratis (watermark). <a href="#" id="hintUnlock">Punya kode premium?</a>`;
    const hu=$("hintUnlock"); if(hu) hu.onclick=(e)=>{e.preventDefault();openOverlay("codeOverlay");};
    strip.scrollIntoView({behavior:reduceMotion?"auto":"smooth",block:"center"});
  }catch(err){
    console.error(err);
    if(o.studio) return null;
    S.genFailed=true;
    if(S.premium){
      $("studioIntro").textContent =
        "Waduh, strip gagal dibuat otomatis 😔 Tapi tenang — kirim fotomu ke studio kami dan tim kami akan membuatkan stripnya manual.";
      openOverlay("studioOverlay");
    }else{
      $("slotWrap").style.display="block";
      $("qualityHint").innerHTML =
        "Strip gagal dibuat otomatis 😔 Coba ulangi, atau " +
        "<a href=\"#\" id=\"hintUnlock\">buka premium</a> untuk minta dibuatkan manual oleh studio kami.";
      const hu=$("hintUnlock"); if(hu) hu.onclick=(e)=>{e.preventDefault();openOverlay("codeOverlay");};
    }
  }
}

/* Lembar cetak A4 dibuat DI SERVER sebagai PDF (lib/pdf.js) — ukuran
   cetaknya pasti dan tidak bergantung pada kanvas browser. */

// Dulu tidak dideklarasikan → jadi variabel global tak sengaja (dan akan
// melempar ReferenceError begitu skrip dijalankan dalam mode strict).
let retakeArmed=false, retakeTimer=null;
$("retakeBtn").onclick=()=>{
  if(!retakeArmed){
    // konfirmasi dua langkah: sekali ketuk = tanya, ketuk lagi = benar-benar hapus
    retakeArmed=true;
    $("retakeBtn").textContent="⚠ Yakin? Ketuk lagi";
    $("retakeBtn").style.borderColor="var(--safelight)";
    clearTimeout(retakeTimer);
    retakeTimer=setTimeout(()=>{
      retakeArmed=false;
      $("retakeBtn").textContent="↺ Ulangi";
      $("retakeBtn").style.borderColor="";
    },3500);
    return;
  }
  clearTimeout(retakeTimer); retakeArmed=false;
  $("retakeBtn").textContent="↺ Ulangi"; $("retakeBtn").style.borderColor="";
  S.photos=[]; S.lastStrip=null; $("slotWrap").style.display="none";
  $("howto").style.display="";
  window.scrollTo({top:0,behavior:reduceMotion?"auto":"smooth"});
};

const IS_IOS = /iP(hone|ad|od)/.test(navigator.userAgent) ||
  (navigator.platform==="MacIntel" && navigator.maxTouchPoints>1);

async function ambilStripUntukDiunduh(){
  // PREMIUM: strip bersih dibuat DI SERVER, bukan di browser.
  // Ini yang membuat "paksa premium lewat DevTools" tidak ada gunanya —
  // tanpa token sah, server menolak dan yang didapat tetap berwatermark.
  if(S.premium && S.token && S.photos.length===SHOTS){
    try{
      // Token lewat HEADER: server memeriksanya SEBELUM membaca body besar
      const r=await fetch(ROUTE.RENDER,{method:"POST",
        headers:{"Content-Type":"application/json","Authorization":"Bearer "+S.token},
        body:JSON.stringify({
          photos:S.photos,
          frameId:FRAMES[S.frameIdx].id, filter:S.filter,
          aspect:ASPECT, width:1400,
          dateText:new Date().toLocaleDateString("id-ID",
            {day:"2-digit",month:"short",year:"numeric"}).toUpperCase(),
        })});
      if(r.ok) return await r.blob();

      // 501 = server belum bisa merender → pakai versi browser (berwatermark)
      if(r.status===403){
        toast("Sesi premium habis. Masukkan kodemu lagi ya.", 5000);
        return null;
      }
    }catch(e){ /* jaringan bermasalah → jatuh ke versi browser */ }
  }
  // GRATIS (atau server render nonaktif): pakai gambar yang sudah tampil
  const src=$("stripImg").src;
  if(!src) return null;
  return await (await fetch(src)).blob();
}

$("downloadBtn").onclick=async ()=>{
  const filename=`one-strip-clover-${Date.now()}.jpg`;
  $("downloadBtn").disabled=true;
  const teksAsli=$("downloadBtn").textContent;
  $("downloadBtn").textContent="Menyiapkan…";

  try{
    const blob=await ambilStripUntukDiunduh();
    $("downloadBtn").disabled=false;
    $("downloadBtn").textContent=teksAsli;
    if(!blob) return;
    const file=new File([blob],filename,{type:"image/jpeg"});

    // 1) Cara terbaik di HP: share sheet bawaan → "Simpan ke Foto"
    if(navigator.canShare && navigator.canShare({files:[file]})){
      try{
        await navigator.share({files:[file], title:"One Strip Clover"});
        return;
      }catch(err){
        if(err && err.name==="AbortError") return; // user membatalkan, wajar
        // selain itu: lanjut ke cara berikutnya
      }
    }

    // 2) iOS Safari tanpa share: atribut download diabaikan → beri instruksi
    if(IS_IOS){
      toast("📲 Di iPhone: tekan lama gambar strip di atas, lalu pilih “Simpan ke Foto”.", 7000);
      return;
    }

    // 3) Desktop & Android: unduh biasa
    const url=URL.createObjectURL(blob);
    const a=document.createElement("a");
    a.href=url; a.download=filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
    toast("✅ Strip tersimpan di folder Download.", 3000);
  }catch(e){
    $("downloadBtn").disabled=false;
    $("downloadBtn").textContent=teksAsli;
    toast("Gagal mengunduh. Coba tekan lama gambarnya lalu simpan manual.", 6000);
  }
};

/* ============================== modals =============================== */
function openOverlay(id){ $(id).classList.add("open");
  const inp=$(id).querySelector("input"); if(inp) setTimeout(()=>inp.focus(),60); }
function closeOverlays(){ document.querySelectorAll(".overlay").forEach(o=>o.classList.remove("open")); }
document.querySelectorAll("[data-close]").forEach(b=>b.onclick=closeOverlays);
document.querySelectorAll(".overlay").forEach(o=>o.addEventListener("click",(e)=>{ if(e.target===o) closeOverlays(); }));
addEventListener("keydown",(e)=>{ if(e.key==="Escape") closeOverlays(); });

$("unlockBtn").onclick=()=>openOverlay("codeOverlay");
function resetStudioModal(){
  $("studioDone").style.display="none";
  $("studioTitle").style.display="";
  ["studioIntro","studioBtns","studioMsg"].forEach(id=>{
    const el=$(id); if(el) el.style.display="";
  });
  $("studioOverlay").querySelectorAll(".field").forEach(f=>f.style.display="");
  $("studioOverlay").querySelectorAll(".consent").forEach(f=>f.style.display="");
  $("studioOverlay").querySelectorAll("p").forEach(p=>{ if(!p.closest("#studioDone")) p.style.display=""; });
  $("progWrap").style.display="none";
  $("progFill").style.width="0%";
  $("studioMsg").textContent=""; $("studioMsg").className="msg";
}

function openStudio(){
  if(!S.premium){
    // fitur khusus premium → arahkan ke penukaran kode
    $("codeMsg").textContent="Fitur \u201cKirim ke Studio\u201d khusus premium. Masukkan kodemu dulu ya.";
    $("codeMsg").className="msg";
    openOverlay("codeOverlay");
    return;
  }
  resetStudioModal();
  $("studioIntro").textContent="Foto-fotomu akan dikirim ke tim studio kami untuk dibuatkan strip secara manual, lalu hasilnya kami kirim balik ke kontakmu.";
  openOverlay("studioOverlay");
}
$("studioBtn").onclick=()=>{ S.genFailed=false; openStudio(); };

function renderStudioBtn(){
  $("studioBtn").textContent = S.premium ? "\u2709 Kirim ke studio" : "\uD83C\uDF40 Kirim ke studio (premium)";
}

/* ------------------------ premium code redeem ------------------------ */
$("codeSubmit").onclick=async ()=>{
  const msg=$("codeMsg"); msg.className="msg";
  const code=$("codeInput").value.trim().toUpperCase();
  if(!code){ msg.textContent="Isi kodenya dulu ya."; msg.classList.add("err"); return; }
  msg.textContent="Memeriksa kode…";
  try{
    const r=await fetch(ROUTE.REDEEM,{method:"POST",
      headers:{"Content-Type":"application/json"},
      // deviceId WAJIB ikut — tanpa ini server tidak bisa mengikat kode
      // ke satu perangkat, dan kode yang dibagikan akan bisa dipakai siapa saja.
      body:JSON.stringify({code, deviceId:deviceId()})});
    const d=await r.json();
    if(d.ok){
      applyPremium(code, d.token);
      saveSession(d.token, code);
      msg.textContent = d.reentry
        ? "Sesi premium dipulihkan 🍀 (kode ini sudah pernah dipakai di perangkat lain)"
        : "Kode diterima! Premium aktif 🍀";
      msg.classList.add("okk");
      setTimeout(()=>{ closeOverlays(); if(S.photos.length===SHOTS) composeStrip(); },900);
    }else{
      msg.classList.add("err");
      msg.innerHTML = d.error===ERR.TOO_MANY_REQUESTS
        ? "Terlalu banyak percobaan kode. Tunggu beberapa menit ya."
        : d.error===ERR.OTHER_DEVICE
        ? "Kode ini sudah dipakai di perangkat lain. Satu kode hanya untuk satu perangkat. Kalau ini memang kodemu, hubungi kami ya."
        : d.error===ERR.SPENT
        ? (d.ref
            ? `Kode ini sudah dipakai untuk pesanan <b>${esc(d.ref)}</b>. Satu kode hanya untuk satu strip.`
            : "Kode ini sudah dipakai untuk memesan. Satu kode hanya untuk satu strip.")
        : d.error===ERR.USED
        ? `Kode ini sudah dipakai lebih dari ${esc(d.graceHours||72)} jam lalu. Kalau kamu merasa ini keliru, hubungi kami dengan menyebutkan kodenya.`
        : "Kode tidak ditemukan. Cek lagi ejaannya ya.";
    }
  }catch(e){ msg.textContent="Server tidak merespons. Coba lagi sebentar."; msg.classList.add("err"); }
};
$("codeInput").addEventListener("keydown",(e)=>{ if(e.key==="Enter") $("codeSubmit").click(); });

/* ------------------------ studio fallback send ------------------------ */
/* ---------------- tampilkan layar konfirmasi pesanan ---------------- */
function showOrderDone(ref, queued){
  const addr=$("addressInput").value.trim().replace(/\s*\n\s*/g,", ");
  $("refNo").textContent = ref || "-";
  const dc=$("doneCode"); if(dc) dc.textContent = S.code || "—";
  const qn=$("queuedNote"); if(qn) qn.style.display = queued ? "block" : "none";
  $("doneSummary").innerHTML = [
    ["Nama",     $("nameInput").value.trim()],
    ["Kontak",   $("emailInput").value.trim() || $("waInput").value.trim()],
    ["Alamat",   addr.length>90 ? addr.slice(0,90)+"…" : addr],
    ["Kode",     (S.code || "-") + " (hangus)"],
  ].map(([k,v])=>`<div><span>${esc(k)}</span><span>${esc(v||"-")}</span></div>`).join("");

  // sembunyikan form, tampilkan konfirmasi
  ["studioIntro","studioBtns","progWrap","studioMsg"].forEach(id=>{
    const el=$(id); if(el) el.style.display="none";
  });
  $("studioOverlay").querySelectorAll(".field").forEach(f=>f.style.display="none");
  $("studioOverlay").querySelectorAll(".consent").forEach(f=>f.style.display="none");
  $("studioOverlay").querySelectorAll("p").forEach(p=>{ if(!p.closest("#studioDone")) p.style.display="none"; });
  $("studioTitle").style.display="none";
  $("studioDone").style.display="block";
  $("studioDone").scrollIntoView({block:"start",behavior:"smooth"});
}

$("copyRef").onclick=async ()=>{
  try{ await navigator.clipboard.writeText($("refNo").textContent);
    $("copyRef").textContent="Tersalin ✓";
    setTimeout(()=>$("copyRef").textContent="Salin nomor",1600);
  }catch(e){ toast("Salin manual ya: "+$("refNo").textContent, 5000); }
};

/* --------- tanggapi hasil kiriman ke studio (dipakai oleh XHR) --------- */
function handleStudioResponse(d,msg,setProg){
  msg.className="msg";
  if(d && d.ok){
    setProg(100,"Selesai ✓");
    showOrderDone(d.ref, d.queued);
    return;
  }
  $("progWrap").style.display="none";
  const e=(d&&d.error)||"";
  const say=(t)=>{ msg.innerHTML=t; msg.classList.add("err"); };

  if(e===ERR.PREMIUM_REQUIRED){
    say("Sesi premium habis atau belum aktif. Masukkan kode premium lagi.");
    setTimeout(()=>{ closeOverlays(); openOverlay("codeOverlay"); },1400);
  }
  else if(e===ERR.NAME_REQUIRED)     say("Nama lengkap wajib diisi.");
  else if(e===ERR.CONTACT_REQUIRED)  say("Isi email atau nomor WhatsApp.");
  else if(e===ERR.ADDRESS_REQUIRED)  say("Alamat pengiriman wajib diisi.");
  else if(e===ERR.SUBMISSION_LIMIT)  say("Kode ini sudah dipakai untuk <b>"+esc(d.max)+"x</b> pesanan studio (batas maksimal). Hubungi kami kalau ada kendala.");
  else if(e===ERR.TOO_MANY_REQUESTS) say("Terlalu banyak percobaan. Coba lagi beberapa menit lagi.");
  else if(e===ERR.ALREADY_PROCESSING) say("Pesananmu sedang diproses — tunggu sebentar, jangan menekan kirim dua kali ya.");
  else if(e===ERR.NOT_CONFIGURED)    say("Email/Drive belum diatur di server. Cek file <b>.env</b> lalu restart server.");
  else if(e===ERR.TIMEOUT)           say("Jaringan terlalu lambat sampai waktu habis. Coba pakai WiFi, lalu kirim ulang.");
  else if(e===ERR.NETWORK)           say("Koneksi terputus saat mengirim. Cek internetmu lalu coba lagi.");
  else if(e===ERR.BUSY)              say("Server sedang ramai. Tunggu beberapa detik lalu tekan kirim lagi ya.");
  else if(e===ERR.BAD_PHOTO)         say("Ada foto yang tidak bisa dibaca. Ambil ulang fotonya lalu kirim lagi.");
  else                             say("Gagal mengirim. Coba lagi, atau hubungi kami langsung.");
}

$("studioSubmit").onclick=async ()=>{
  const msg=$("studioMsg"); msg.className="msg";
  if(S.photos.length===0){ msg.textContent="Belum ada foto — ambil atau unggah dulu."; msg.classList.add("err"); return; }
  if(!$("consentBox").checked){ msg.textContent="Centang persetujuan dulu ya."; msg.classList.add("err"); return; }

  const name=$("nameInput").value.trim();
  const email=$("emailInput").value.trim();
  const wa=$("waInput").value.trim();

  if(!name){ msg.textContent="Nama lengkap wajib diisi."; msg.classList.add("err"); $("nameInput").focus(); return; }

  if(!email && !wa){
    msg.textContent="Isi email ATAU nomor WhatsApp (minimal salah satu).";
    msg.classList.add("err"); $("emailInput").focus(); return;
  }
  const address=$("addressInput").value.trim();
  if(address.length<12){
    msg.textContent="Alamat pengiriman wajib diisi selengkap mungkin.";
    msg.classList.add("err"); $("addressInput").focus(); return;
  }
  if(email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){
    msg.textContent="Format email sepertinya keliru."; msg.classList.add("err"); $("emailInput").focus(); return;
  }
  if(wa && !/^[0-9+()\-\s]{8,20}$/.test(wa)){
    msg.textContent="Nomor WhatsApp sepertinya keliru."; msg.classList.add("err"); $("waInput").focus(); return;
  }

  const setProg=(pct,txt)=>{
    $("progWrap").style.display="block";
    $("progFill").style.width=Math.max(2,Math.min(100,pct))+"%";
    $("progText").textContent=txt;
  };

  msg.textContent="";
  $("studioSubmit").disabled=true;
  $("studioSubmit").textContent="Mengirim…";
  setProg(3,"Menyiapkan foto…");

  const studioStrip = await composeStrip({studio:true});   // versi bersih HD

  const payload=JSON.stringify({
    photos:S.photos,
    name, email, wa, address,
    contact: email || wa,
    note:$("noteInput").value.trim(),
    takenAt: S.takenAt || new Date().toISOString(),
    consent:true,
    strip:studioStrip||S.lastStrip||null,
    reason:S.genFailed?"generation_failed":"user_request",
    style:`filter=${S.filter}; bingkai=${FRAMES[S.frameIdx].name}`
  });

  const mb=(payload.length/1024/1024).toFixed(1);
  setProg(5,`Mengunggah 0% (${mb} MB)`);

  const finish=(d)=>{
    $("studioSubmit").disabled=false;
    $("studioSubmit").textContent="Kirim foto";
    handleStudioResponse(d,msg,setProg);
  };

  try{
    // XHR dipakai (bukan fetch) karena hanya XHR yang bisa melaporkan
    // progres upload — penting karena payload bisa 2-4 MB di jaringan HP.
    const xhr=new XMLHttpRequest();
    xhr.open("POST",ROUTE.ORDER);
    xhr.setRequestHeader("Content-Type","application/json");
    // Token lewat HEADER: server menolak tanpa token SEBELUM membaca 25 MB body
    xhr.setRequestHeader("Authorization","Bearer "+S.token);
    xhr.timeout=180000; // 3 menit, jaringan lambat masih diberi kesempatan

    xhr.upload.onprogress=(e)=>{
      if(!e.lengthComputable) return;
      const pct=Math.round((e.loaded/e.total)*100);
      // upload = 0-85% dari bar, sisanya untuk proses di server
      setProg(5+pct*0.8, pct<100 ? `Mengunggah ${pct}% (${mb} MB)` : "Diproses studio…");
    };
    xhr.upload.onload=()=>setProg(88,"Diproses studio… (email & drive)");

    xhr.onload=()=>{
      let d={}; try{ d=JSON.parse(xhr.responseText); }catch(e){}
      finish(d);
    };
    xhr.onerror=()=>finish({error:ERR.NETWORK});
    xhr.ontimeout=()=>finish({error:ERR.TIMEOUT});
    xhr.send(payload);
  }catch(e){
    finish({error:ERR.NETWORK});
  }
  $("studioSubmit").disabled=false;
};

/* dipanggil terakhir agar semua fungsi sudah siap */
jalankan("loadShopConfig", loadShopConfig);
jalankan("loadTemplate", loadTemplate);
jalankan("restorePremium", restorePremium);

