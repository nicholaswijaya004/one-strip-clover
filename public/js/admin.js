/* ONE STRIP CLOVER — skrip panel admin (/admin)
 * Berkas terpisah (bukan <script> inline) supaya CSP bisa melarang skrip inline.
 */
const $=(id)=>document.getElementById(id);
let KEY="";

/* Semua teks dari server yang masuk ke innerHTML WAJIB lewat esc().
   Membuang < > saja tidak cukup: tanda kutip bisa keluar dari atribut
   (alt="x" onerror="…") dan menjalankan skrip di panel admin. */
const esc=(v)=>String(v==null?"":v).replace(/[&<>"'`]/g,(c)=>(
  {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;","`":"&#96;"}[c]));

async function api(path, body){
  const r=await fetch(path,{method:"POST",
    headers:{"Content-Type":"application/json","x-admin-key":KEY},
    body:JSON.stringify(body||{})});
  let data={};
  try{ data=await r.json(); }catch(e){ data={ok:false,error:"BAD_RESPONSE"}; }
  return {status:r.status, data};
}

$("loginBtn").onclick=async ()=>{
  KEY=$("keyInput").value.trim();
  if(!KEY){ $("loginMsg").textContent="Isi admin key dulu."; $("loginMsg").className="msg err"; return; }
  const {status,data}=await api("/api/admin/stats");
  if(status===401){ $("loginMsg").textContent="Admin key salah."; $("loginMsg").className="msg err"; return; }
  if(!data.ok){ $("loginMsg").textContent="Gagal terhubung ke server."; $("loginMsg").className="msg err"; return; }
  sessionStorage.setItem("fbkey",KEY);
  $("loginCard").style.display="none";
  $("dash").style.display="block";
  render(data);
  loadLogs("orders");
  muatSetelan();
  muatTpl();
};
$("keyInput").addEventListener("keydown",e=>{ if(e.key==="Enter") $("loginBtn").click(); });

function render(data){
  const s=data.stats;
  $("stats").innerHTML=`
    <div class="stat" title="Sudah diekspor ke pool chatbot, belum ditukar pembeli"><div class="n">${esc(s.chatbotStock??0)}</div><div class="l">STOK<br>CHATBOT</div></div>
    <div class="stat" title="Siap dibagikan manual lewat tombol Ambil Kode Berikutnya"><div class="n">${esc(s.available)}</div><div class="l">STOK<br>ADMIN</div></div>
    <div class="stat" title="Sudah ditukar pembeli di website"><div class="n">${esc(s.redeemed)}</div><div class="l">DIPAKAI</div></div>
    <div class="stat" title="Seluruh kode yang pernah dibuat"><div class="n">${esc(s.total)}</div><div class="l">TOTAL</div></div>`;

  const warns=[];
  const cb = s.chatbotStock ?? 0;
  if(cb === 0)
    warns.push(`🛑 <b>Stok chatbot habis.</b> Pembeli baru tidak akan dapat kode. Buat kode baru dengan pilihan <b>Untuk chatbot</b>, lalu upload ke pool chatbot.`);
  else if(cb < 25)
    warns.push(`⚠️ Stok chatbot tinggal <b>${cb}</b>. Siapkan batch baru sebelum habis.`);

  if(s.available === 0)
    warns.push(`ℹ️ Stok admin kosong — tombol “Ambil Kode Berikutnya” belum bisa dipakai. Ini hanya perlu kalau kamu membagi kode manual (DM/WA, kode pengganti).`);
  else if(s.available < 10)
    warns.push(`ℹ️ Stok admin tinggal <b>${s.available}</b> kode.`);

  const q = data.queue || {};
  if((q.menunggu||0) > 0)
    warns.push(`📦 <b>${q.menunggu} pesanan tertunda</b> — pengiriman ke email/Drive gagal, sedang dicoba ulang otomatis. Cek tab Error kalau tidak berkurang.`);
  if((q.gagalPermanen||0) > 0)
    warns.push(`🛑 <b>${q.gagalPermanen} pesanan GAGAL PERMANEN</b> — fotonya ada di <code>data/failed/</code>, proses manual.`);

  $("lowWarn").style.display = warns.length ? "block":"none";
  $("lowWarn").innerHTML = warns.join("<br><br>");

  $("recentBody").innerHTML = (data.recent||[]).map(r=>`
    <tr>
      <td>${esc(r.code)}</td>
      <td>${r.buyer==="(batch chatbot)" ? "<i>batch chatbot</i>" : (r.buyer? esc(r.buyer) : "—")}</td>
      <td><span class="pill ${r.used?"ok":"wait"}">${r.used?"dipakai":"belum"}</span></td>
    </tr>`).join("") || `<tr><td colspan="3" style="color:var(--smoke)">Belum ada</td></tr>`;
}

async function refresh(){
  const {data}=await api("/api/admin/stats");
  if(data.ok) render(data);
}
$("refreshBtn").onclick=()=>{refresh();loadLogs(logMode);};

let logMode="orders";
async function loadLogs(which){
  logMode=which;
  ["logOrders","logApp","logErr"].forEach(id=>$(id).classList.remove("on"));
  $(which==="orders"?"logOrders":which==="app"?"logApp":"logErr").classList.add("on");
  const {data}=await api("/api/admin/logs",{which:which==="orders"?"orders":"app",n:150});
  if(!data.ok){ $("logOut").textContent="(gagal memuat log)"; return; }
  let lines=data.lines;
  if(which==="err") lines=lines.filter(l=>l.includes("[ERROR]"));
  $("logOut").textContent = lines.slice(-120).join("\n") || "(kosong)";
  $("logOut").scrollTop=$("logOut").scrollHeight;
}
$("logOrders").onclick=()=>loadLogs("orders");
$("logApp").onclick=()=>loadLogs("app");
$("logErr").onclick=()=>loadLogs("err");

/* ------------------------- template strip ------------------------- */
const TPL_FIELDS = {
  photoWmm: "Lebar foto",
  photoHmm: "Tinggi foto",
  topMm:    "Jarak dari atas",
  gapMm:    "Jarak antar foto",
};
let tplItems = [];       // daftar template dari server
let tplDipilih = null;   // id template yang sedang diedit

async function muatTpl(){
  const r = await fetch("/api/template");   // endpoint publik: daftar ringkas
  const d = await r.json();
  // ambil detail lengkap (termasuk layout & status muat) lewat endpoint admin
  const {data} = await api("/api/admin/template",{baca:true});
  tplItems = (data && data.items) ? data.items : (d.items||[]);
  renderGaleri();
}

function renderGaleri(){
  const g=$("tplGaleri");
  if(tplItems.length===0){
    g.innerHTML='<div class="tplkosong">Belum ada template. Unggah di bawah — '+
      'strip memakai desain bawaan sampai kamu menambah satu.</div>';
  }else{
    g.innerHTML = tplItems.map(t=>`
      <div class="tplitem ${t.id===tplDipilih?"dipilih":""}" data-id="${esc(t.id)}">
        <img src="/api/template/image?id=${encodeURIComponent(t.id)}&v=${encodeURIComponent(t.diunggahPada||"")}" alt="${esc(t.nama)}">
        <div class="nm" title="${esc(t.nama)}">${esc(t.nama)}</div>
      </div>`).join("");
    g.querySelectorAll(".tplitem").forEach(el=>{
      el.onclick=()=>pilihTpl(el.dataset.id);
    });
  }
  // kalau template yang sedang diedit sudah terhapus, tutup panel
  if(tplDipilih && !tplItems.find(t=>t.id===tplDipilih)){ tplDipilih=null; $("tplEdit").style.display="none"; }
}

function pilihTpl(id){
  tplDipilih=id;
  const t=tplItems.find(x=>x.id===id);
  if(!t) return;
  renderGaleri();

  $("tplEdit").style.display="block";
  $("tplEditImg").src="/api/template/image?id="+encodeURIComponent(id)+"&v="+encodeURIComponent(t.diunggahPada||"");
  $("tplEditNama").value=t.nama||"";

  const muat = t.muat!==false;
  $("tplEditInfo").innerHTML =
    (t.lebarPx?`Ukuran: ${esc(t.lebarPx)} x ${esc(t.tinggiPx)} px<br>`:"") +
    (t.diunggahPada?`Diunggah: ${esc(new Date(t.diunggahPada).toLocaleString("id-ID"))}<br>`:"") +
    (muat ? `Margin samping ${esc(t.marginSampingMm)} mm · sisa bawah ${esc(t.sisaBawahMm)} mm`
          : `<b style="color:#C0526B">⚠️ Kotak foto tidak muat (kelebihan ${esc(Math.abs(t.sisaBawahMm))} mm)</b>`);

  $("tplLayout").innerHTML = Object.entries(TPL_FIELDS).map(([k,label])=>`
    <div class="setelan-item">
      <div class="setelan-baris">
        <span class="setelan-nama">${label}</span>
        <input type="number" id="tpl-${k}" value="${esc((t.layout||{})[k])}" step="0.1" min="0">
      </div>
    </div>`).join("");
}

$("tplPilih").onclick=()=>$("tplFile").click();

$("tplFile").onchange=async (e)=>{
  const f=e.target.files[0]; if(!f) return;
  const m=$("tplMsg"); m.className="msg"; m.textContent="Membaca berkas…";

  const dataUrl=await new Promise(res=>{
    const r=new FileReader(); r.onload=()=>res(r.result); r.readAsDataURL(f);
  });
  const img=await new Promise((res)=>{
    const i=new Image(); i.onload=()=>res(i); i.onerror=()=>res(null); i.src=dataUrl;
  });
  if(!img){ m.textContent="Berkas gambar tidak terbaca."; m.classList.add("err"); e.target.value=""; return; }

  const rasio=img.naturalHeight/img.naturalWidth, target=171.5/56.1;
  if(Math.abs(rasio-target)/target > 0.03){
    m.innerHTML=`Rasio gambar <b>1 : ${rasio.toFixed(2)}</b> tidak cocok. `+
      `Strip harus <b>1 : ${target.toFixed(2)}</b> (mis. 663 x 2026 px).`;
    m.classList.add("err"); e.target.value=""; return;
  }

  m.textContent="Mengunggah…";
  const {data}=await api("/api/admin/template",{
    image:dataUrl, lebarPx:img.naturalWidth, tinggiPx:img.naturalHeight,
    nama:$("tplNama").value.trim(),
  });
  e.target.value="";
  if(data.ok){
    tplItems=data.items||[];
    $("tplNama").value="";
    m.textContent="✓ Template ditambahkan. Muncul sebagai bingkai baru di halaman utama.";
    m.style.color="#7fd18a";
    renderGaleri();
    if(data.baru) pilihTpl(data.baru);
  }else{
    m.textContent="Gagal: "+(data.hint||data.error); m.classList.add("err");
  }
};

$("tplSimpan").onclick=async ()=>{
  if(!tplDipilih) return;
  const m=$("tplEditMsg"); m.className="msg";
  const layout={};
  for(const k of Object.keys(TPL_FIELDS)){ const el=$("tpl-"+k); if(el) layout[k]=Number(el.value); }
  const {data}=await api("/api/admin/template",{
    ubah:{ id:tplDipilih, nama:$("tplEditNama").value.trim(), layout },
  });
  if(data.ok){
    tplItems=data.items||[];
    const t=tplItems.find(x=>x.id===tplDipilih);
    m.textContent = (t && t.muat===false)
      ? "Disimpan, TAPI kotak foto tidak muat — perbaiki angkanya."
      : "✓ Tersimpan.";
    m.style.color = (t && t.muat===false) ? "" : "#7fd18a";
    if(t && t.muat===false) m.classList.add("err");
    renderGaleri();
  }else{ m.textContent="Gagal menyimpan."; m.classList.add("err"); }
};

/* Hapus butuh dua ketukan */
let hapusSiap=false, hapusTimer;
$("tplHapus").onclick=async ()=>{
  if(!tplDipilih) return;
  const m=$("tplEditMsg"); m.className="msg";
  const tombol=$("tplHapus");

  if(!hapusSiap){
    hapusSiap=true;
    tombol.textContent="⚠️ Yakin? Ketuk lagi";
    tombol.classList.add("siap");
    clearTimeout(hapusTimer);
    hapusTimer=setTimeout(()=>{ hapusSiap=false; tombol.textContent="🗑 Hapus"; tombol.classList.remove("siap"); },3500);
    return;
  }
  clearTimeout(hapusTimer); hapusSiap=false;
  tombol.textContent="🗑 Hapus"; tombol.classList.remove("siap"); tombol.disabled=true;

  const {data}=await api("/api/admin/template",{hapus:tplDipilih});
  tombol.disabled=false;
  if(data.ok){
    tplItems=data.items||[];
    tplDipilih=null;
    $("tplEdit").style.display="none";
    renderGaleri();
    m.textContent="Template dihapus. Bingkai itu hilang dari halaman utama.";
  }else{ m.textContent="Gagal menghapus."; m.classList.add("err"); }
};

/* ---------------------------- setelan ---------------------------- */
let skemaSetelan = {};

async function muatSetelan(){
  const {data}=await api("/api/admin/settings",{});
  if(!data.ok) return;
  skemaSetelan = data.skema || {};
  $("setelanList").innerHTML = Object.entries(skemaSetelan).map(([kunci,def])=>`
    <div class="setelan-item">
      <div class="setelan-baris">
        <span class="setelan-nama">${esc(def.label)}</span>
        <input type="number" id="set-${esc(kunci)}" value="${esc(data.settings[kunci])}"
               min="${esc(def.min)}" max="${esc(def.max)}" step="${def.min < 1 ? "0.5" : "1"}">
      </div>
      <div class="setelan-ket">${esc(def.keterangan)} <b>(${esc(def.min)}–${esc(def.max)})</b></div>
    </div>`).join("");
}

$("setelanSimpan").onclick=async ()=>{
  const m=$("setelanMsg"); m.className="msg";
  const update={};
  for(const kunci of Object.keys(skemaSetelan)){
    const el=$("set-"+kunci);
    if(el) update[kunci]=Number(el.value);
  }
  $("setelanSimpan").disabled=true;
  const {data}=await api("/api/admin/settings",{update});
  $("setelanSimpan").disabled=false;

  if(data.ok){
    // server membatasi nilainya — tampilkan hasil sebenarnya, bukan yang diketik
    for(const [k,v] of Object.entries(data.settings)){
      const el=$("set-"+k); if(el) el.value=v;
    }
    m.textContent="✓ Setelan disimpan & langsung berlaku.";
    m.style.color="#7fd18a";
  }else{
    m.textContent="Gagal menyimpan."; m.classList.add("err");
  }
};

/* ------------------ lepas ikatan perangkat ------------------ */
$("unbindBtn").onclick=async ()=>{
  const kode=$("unbindCode").value.trim().toUpperCase();
  const m=$("unbindMsg"); m.className="msg";
  if(!kode){ m.textContent="Isi kodenya dulu."; m.classList.add("err"); return; }

  $("unbindBtn").disabled=true;
  const {data}=await api("/api/admin/unbind",{code:kode});
  $("unbindBtn").disabled=false;

  if(data.ok){
    m.textContent=`✓ ${kode} dilepas. Pembeli bisa menukar ulang di perangkat barunya.`;
    m.style.color="#7fd18a";
    $("unbindCode").value="";
    refresh();
  }else if(data.error==="SPENT"){
    m.innerHTML=`Kode ini sudah dipakai untuk pesanan <b>${esc(data.ref||"-")}</b>, jadi memang sudah selesai.`;
    m.classList.add("err");
  }else if(data.error==="INVALID"){
    m.textContent="Kode tidak ditemukan."; m.classList.add("err");
  }else{
    m.textContent="Gagal: "+(data.error||"unknown"); m.classList.add("err");
  }
};

/* ---------------------- generator kode ---------------------- */
let genForChatbot=true, lastBatch=[];
function renderGenMode(){
  $("genChatbot").classList.toggle("on",genForChatbot);
  $("genAdmin").classList.toggle("on",!genForChatbot);
  $("genHint").innerHTML = genForChatbot
    ? "Kode langsung ditandai <b>sudah dibagikan</b>, jadi tombol “Ambil Kode Berikutnya” tidak akan membagikan kode yang sama. Upload hasilnya ke pool chatbot."
    : "Kode masuk <b>stok /admin</b> dan bisa dibagikan satu per satu lewat tombol di bawah. Untuk order manual (DM, WhatsApp) atau kode pengganti.";
}
$("genChatbot").onclick=()=>{genForChatbot=true;renderGenMode();};
$("genAdmin").onclick=()=>{genForChatbot=false;renderGenMode();};
renderGenMode();

$("genBtn").onclick=async ()=>{
  const n=Number($("genQty").value);
  const m=$("genMsg"); m.className="msg";
  if(!n||n<1||n>2000){ m.textContent="Jumlah harus 1–2000."; m.classList.add("err"); return; }

  $("genBtn").disabled=true; $("genBtn").textContent="Membuat…";
  const {data}=await api("/api/admin/generate",{n,forChatbot:genForChatbot});
  $("genBtn").disabled=false; $("genBtn").textContent="⚙ Generate kode";

  if(data.ok){
    lastBatch=data.codes;
    $("genOut").value=data.codes.join("\n");
    $("genResult").style.display="block";
    m.textContent=`✓ ${data.codes.length} kode dibuat (${data.forChatbot?"pool chatbot":"stok admin"}).`;
    m.style.color="#7fd18a";
    render({stats:data.stats,recent:null}); refresh();
  }else{
    m.textContent="Gagal: "+(data.hint||data.msg||data.error||"unknown");
    m.classList.add("err");
  }
};

$("genCopy").onclick=async ()=>{
  try{ await navigator.clipboard.writeText($("genOut").value);
    $("genCopy").textContent="Tersalin ✓";
    setTimeout(()=>$("genCopy").textContent="Salin semua",1500);
  }catch(e){ $("genOut").select(); }
};

$("genDl").onclick=()=>{
  const blob=new Blob([$("genOut").value],{type:"text/plain"});
  const url=URL.createObjectURL(blob);
  const a=document.createElement("a");
  a.href=url;
  a.download=`batch-${genForChatbot?"chatbot":"admin"}-${new Date().toISOString().slice(0,10)}.txt`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
};

$("nextBtn").onclick=async ()=>{
  $("nextBtn").disabled=true;
  $("nextMsg").textContent="";
  const buyer=$("buyerInput").value.trim();
  const {data}=await api("/api/admin/next-code",{buyer});
  if(data.ok){
    $("codebox").style.display="block";
    $("codeOut").textContent=data.code;
    $("codeMeta").textContent=`sisa stok: ${data.remaining}`;
    $("buyerInput").value="";
    render({stats:data.stats,recent:null});
    refresh();
  }else if(data.error==="OUT_OF_STOCK"){
    $("nextMsg").textContent="Stok kode habis. "+data.hint;
    $("nextMsg").className="msg err";
  }else{
    $("nextMsg").textContent="Gagal: "+(data.error||"unknown");
    $("nextMsg").className="msg err";
  }
  $("nextBtn").disabled=false;
};

$("copyBtn").onclick=async ()=>{
  try{ await navigator.clipboard.writeText($("codeOut").textContent);
    $("copyBtn").textContent="Tersalin ✓";
    setTimeout(()=>$("copyBtn").textContent="Salin kode",1500);
  }catch(e){ $("copyBtn").textContent="Salin manual"; }
};

// auto-login kalau key masih ada di session
const saved=sessionStorage.getItem("fbkey");
if(saved){ $("keyInput").value=saved; $("loginBtn").click(); }
