import { db } from "./firebase.js";
import {
  collection,
  getDocs,
  doc,
  addDoc,
  setDoc,
  deleteDoc,
  query,
  orderBy,
  serverTimestamp,
  writeBatch
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import {
  getStorage,
  ref as storageRef,
  uploadBytes,
  getDownloadURL
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js";

const suppliersListEl = document.getElementById("suppliersList");
const grandTotalEl = document.getElementById("grandTotal");
const searchInput = document.getElementById("searchInput");
const newSupplierBtn = document.getElementById("newSupplierBtn");

let suppliersCache = [];

function eur(n){
  const v = parseEuroLike(n);
  return v.toFixed(2);
}

function parseEuroLike(v){
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const s = String(v ?? "").trim();
  if (!s) return 0;
  let cleaned = s.replace(/[^0-9,.-]/g, "");
  if (cleaned.includes(",")) cleaned = cleaned.replace(/\./g, "").replace(",", ".");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

function normalize(s){
  return (s || "").toString().trim().toLowerCase();
}

function render(list){
  suppliersListEl.innerHTML = "";

  let grand = 0;

  list.forEach((s) => {
    const total = parseEuroLike(s.total);
    grand += total;

    const row = document.createElement("div");
    row.className = "supplier-row";
    row.innerHTML = `
      <div class="supplier-name">${(s.name || "Senza nome")}</div>
      <div class="supplier-total">€ ${eur(total)}</div>
    `;

    row.addEventListener("click", () => {
      // apre scheda fornitore
      window.location.href = `supplier.html?supplierId=${encodeURIComponent(s.id)}`;
    });

    suppliersListEl.appendChild(row);
  });

  grandTotalEl.textContent = eur(grand);

  // KPI (se presenti nel layout nuovo)
  const kpiCount = document.getElementById("kpiSuppliersCount");
  const kpiTotal = document.getElementById("kpiSuppliersTotal");
  if(kpiCount) kpiCount.textContent = String(list.length);
  if(kpiTotal) kpiTotal.textContent = `€ ${eur(grand)}`;
  renderSuppliersChart(list);
}

async function loadSuppliers(){
  // ordino per nome (se non c’è name, va comunque)
  const q = query(collection(db, "suppliers"), orderBy("name"));
  const snap = await getDocs(q);

  suppliersCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  applyFilter();
}

function applyFilter(){
  const term = normalize(searchInput.value);
  if(!term){
    render(suppliersCache);
    return;
  }
  const filtered = suppliersCache.filter(s => normalize(s.name).includes(term));
  render(filtered);
}

/* FIX iPhone: click bloccati da overlay
  - usiamo addEventListener e stopPropagation
  - e il CSS mette z-index/pointer-events corretti
*/
newSupplierBtn.addEventListener("click", (e) => {
  e.preventDefault();
  e.stopPropagation();
  window.location.href = "supplier.html";
});

searchInput.addEventListener("input", applyFilter);

loadSuppliers();

// ── Mark ALL invoices from ALL suppliers as paid ──────
const markAllSuppliersInvoicesPaidBtn = document.getElementById("markAllSuppliersInvoicesPaidBtn");
markAllSuppliersInvoicesPaidBtn?.addEventListener("click", async () => {
  if(!confirm("Segna TUTTE le fatture di TUTTI i fornitori come pagate?")) return;
  try {
    const suppSnap = await getDocs(collection(db, "suppliers"));
    const invRefs = suppSnap.docs.map(suppDoc =>
      collection(db, "suppliers", suppDoc.id, "invoices")
    );
    const invSnaps = await Promise.all(invRefs.map(ref => getDocs(ref)));

    // Collect all updates (Firestore batch limit: 500 ops per batch)
    const unpaidInvoiceRefs = [];
    invSnaps.forEach((invSnap, i) => {
      invSnap.forEach(invDoc => {
        if((invDoc.data().status || "da-pagare") !== "pagata"){
          unpaidInvoiceRefs.push(doc(invRefs[i], invDoc.id));
        }
      });
    });

    if(unpaidInvoiceRefs.length === 0){ alert("Tutte le fatture sono già segnate come pagate."); return; }

    // Commit in chunks of 500
    const FIRESTORE_BATCH_LIMIT = 500;
    for(let i = 0; i < unpaidInvoiceRefs.length; i += FIRESTORE_BATCH_LIMIT){
      const batch = writeBatch(db);
      unpaidInvoiceRefs.slice(i, i + FIRESTORE_BATCH_LIMIT).forEach(ref => batch.update(ref, { status: "pagata" }));
      await batch.commit();
    }

    alert(`✅ ${unpaidInvoiceRefs.length} fattura/e segnata/e come pagata.`);
  } catch(err) {
    console.error("Errore durante il salvataggio:", err);
    alert("❌ Errore durante il salvataggio: " + (err?.message || err));
  }
});

let suppliersChart;
function renderSuppliersChart(list){
  const canvas = document.getElementById('suppliersChart');
  if(!canvas || !window.Chart) return;
  const wrap = canvas.parentElement;
  if(wrap){
    wrap.style.height = (window.innerWidth <= 768 ? 260 : 320) + 'px';
    wrap.style.minHeight = wrap.style.height;
    wrap.style.maxHeight = wrap.style.height;
  }
  const labels = list.map(s=>String(s.name||'Senza nome'));
  const values = list.map(s=>parseEuroLike(s.total));
  if(suppliersChart) { try{suppliersChart.destroy();}catch(_){} }
  suppliersChart = new Chart(canvas.getContext('2d'), {
    type:'bar',
    data:{ labels, datasets:[{ data: values, backgroundColor:'rgba(59,130,246,0.55)', borderColor:'rgba(59,130,246,0.95)', borderWidth:1, borderRadius:8, maxBarThickness:42 }] },
    options:{
      responsive:true,
      maintainAspectRatio:false,
      animation:false,
      plugins:{ legend:{display:false}, tooltip:{ callbacks:{ label:(ctx)=>`€ ${eur(ctx.parsed.y||0)}` } } },
      scales:{ y:{ beginAtZero:true, ticks:{ callback:(value)=>'€ '+eur(value) } }, x:{ ticks:{ autoSkip:false, maxRotation:40, minRotation:0 } } }
    }
  });
}
window.addEventListener('resize', () => renderSuppliersChart(suppliersCache));

let monthlyOrdersChart;
function renderMonthlyOrdersChart(){
  const canvas = document.getElementById('monthlyOrdersChart');
  if(!canvas || !window.Chart) return;
  const wrap = canvas.parentElement;
  if(wrap){
    wrap.style.height = (window.innerWidth <= 768 ? 260 : 320) + 'px';
    wrap.style.minHeight = wrap.style.height;
    wrap.style.maxHeight = wrap.style.height;
  }
  // Collect totals per month per supplier
  const monthTotals = {}; // { 'YYYY-MM': { supplierId: amount } }
  const supplierIds = Object.keys(ordersHistory);
  supplierIds.forEach(supplierId => {
    const { orders } = ordersHistory[supplierId];
    orders.forEach(o => {
      const dateStr = o.dateISO || o.invoiceDate || o.date || null;
      if(!dateStr) return;
      const monthKey = String(dateStr).slice(0, 7); // YYYY-MM
      if(!monthTotals[monthKey]) monthTotals[monthKey] = {};
      monthTotals[monthKey][supplierId] = (monthTotals[monthKey][supplierId] || 0) + Number(o.totalWithVat || o.total || o.importo || o.amount || 0);
    });
  });
  const months = Object.keys(monthTotals).sort();
  if(!months.length){ canvas.style.display='none'; return; }
  canvas.style.display='';
  const monthLabels = months.map(m => {
    const [y, mo] = m.split('-');
    const d = new Date(parseInt(y), parseInt(mo)-1, 1);
    return d.toLocaleDateString('it-IT', { month: 'short', year: '2-digit' });
  });
  const chartColors = [
    'rgba(59,130,246,0.75)','rgba(16,185,129,0.75)','rgba(245,158,11,0.75)',
    'rgba(239,68,68,0.75)','rgba(139,92,246,0.75)','rgba(236,72,153,0.75)',
    'rgba(20,184,166,0.75)','rgba(249,115,22,0.75)'
  ];
  const datasets = supplierIds
    .filter(id => ordersHistory[id].orders.length > 0)
    .map((id, i) => ({
      label: ordersHistory[id].name,
      data: months.map(m => monthTotals[m]?.[id] || 0),
      backgroundColor: chartColors[i % chartColors.length],
      borderRadius: 4,
      maxBarThickness: 42
    }));
  if(monthlyOrdersChart){ try{monthlyOrdersChart.destroy();}catch(_){} }
  monthlyOrdersChart = new Chart(canvas.getContext('2d'), {
    type: 'bar',
    data: { labels: monthLabels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: {
        legend: { display: true, position: 'bottom' },
        tooltip: { callbacks: { label: (ctx) => `${ctx.dataset.label}: € ${eur(ctx.parsed.y||0)}` } }
      },
      scales: {
        x: { stacked: true, ticks: { autoSkip: false, maxRotation: 40, minRotation: 0 } },
        y: { stacked: true, beginAtZero: true, ticks: { callback: (value) => '€ '+eur(value) } }
      }
    }
  });
}

// ── STORICO ORDINI FORNITORI ─────────────────────────────────────────
const storage = getStorage();
let ordersHistory = {}; // { supplierId: { name, orders: [] } }

function eurFmt(n){
  return new Intl.NumberFormat('it-IT',{style:'currency',currency:'EUR'}).format(Number(n)||0);
}

// ── Sync tutte le fatture di tutti i fornitori → spese ──────────────────
async function syncAllInvoicesToSpese(){
  // Usa i dati già caricati in ordersHistory
  const entries = Object.entries(ordersHistory);
  const promises = [];
  for(const [supplierId, { name, orders }] of entries){
    for(const inv of orders){
      if(!inv.id) continue;
      const date = inv.dateISO || inv.invoiceDate || inv.date || "";
      if(!date) continue;
      const amount = Number(inv.totalWithVat || inv.total || inv.importo || inv.amount || 0);
      const note = [name, inv.description || inv.invoiceNumber].filter(Boolean).join(" – ");
      const speseId = `supplier_${supplierId}_${inv.id}`;
      promises.push(
        setDoc(doc(db,"spese",speseId),{
          date,
          amount,
          note,
          category: inv.category || "fornitori",
          source: "supplier_invoice",
          supplierId,
          invoiceId: inv.id,
          syncedAt: new Date().toISOString()
        },{ merge: true }).catch(e => console.warn(`Sync inv ${inv.id}:`, e))
      );
    }
  }
  await Promise.all(promises);
}

async function loadOrdersHistory(){
  const list = document.getElementById('ordersHistoryList');
  if(!list) return;
  try{
    const snap = await getDocs(collection(db,'suppliers'));
    ordersHistory = {};
    await Promise.all(snap.docs.map(async suppDoc => {
      const name = String(suppDoc.data().name||'Senza nome');
      // Non usare orderBy('dateISO') perché le fatture da supplier.js usano il campo 'date'
      const ordersSnap = await getDocs(collection(db,'suppliers',suppDoc.id,'invoices'));
      const orders = ordersSnap.docs
        .map(d=>({id:d.id,...d.data()}))
        .sort((a,b)=>{
          const da = a.dateISO || a.invoiceDate || a.date || '';
          const db_ = b.dateISO || b.invoiceDate || b.date || '';
          return db_.localeCompare(da);
        });
      ordersHistory[suppDoc.id] = { name, orders };
    }));
    renderOrdersHistory();
    populateSupplierSelect();
    // Sincronizza tutte le fatture di tutti i fornitori → spese (idempotente, in background)
    syncAllInvoicesToSpese().catch(e => console.warn("Sync globale fatture→spese:", e));
  }catch(e){
    console.warn('loadOrdersHistory',e);
    if(list) list.innerHTML='<div style="color:#dc2626;padding:8px">Errore caricamento storico ordini.</div>';
  }
}

function renderOrdersHistory(){
  const list = document.getElementById('ordersHistoryList');
  if(!list) return;
  renderMonthlyOrdersChart();
  const entries = Object.entries(ordersHistory).filter(([,v])=>v.orders.length>0);
  if(!entries.length){
    list.innerHTML='<div style="color:#9ca3af;font-style:italic;padding:12px 0;">Nessun ordine registrato. Usa il pulsante <strong>＋ Nuovo ordine</strong> per iniziare.</div>';
    return;
  }
  list.innerHTML = entries.map(([supplierId,{name,orders}])=>{
    const total = orders.reduce((s,o)=>s+Number(o.totalWithVat||o.total||o.importo||o.amount||0),0);
    const rows = orders.slice(0,5).map(o=>{
      const date = o.dateISO||o.invoiceDate||o.date||'—';
      const amount = Number(o.totalWithVat||o.total||o.importo||o.amount||0);
      const desc = String(o.description||o.desc||o.note||'—').slice(0,40);
      const photoBtn = o.photoUrl ? `<a href="${o.photoUrl}" target="_blank" style="font-size:11px;color:#1f4fd8;text-decoration:none;font-weight:700;">📷 Foto</a>` : '';
      return `<div style="display:flex;align-items:center;gap:10px;padding:7px 12px;border-bottom:1px solid #f1f5f9;font-size:13px;">
        <span style="min-width:86px;color:#374151;font-weight:600;">${date}</span>
        <span style="flex:1;color:#475569;">${desc}</span>
        <span style="font-weight:800;color:#1f4fd8;white-space:nowrap;">${eurFmt(amount)}</span>
        ${photoBtn}
      </div>`;
    }).join('');
    const moreCount = orders.length > 5 ? `<div style="padding:6px 12px;font-size:12px;color:#6b7280;font-style:italic;">+ altri ${orders.length-5} ordini → <a href="supplier.html?supplierId=${encodeURIComponent(supplierId)}" style="color:#1f4fd8;text-decoration:none;font-weight:700;">Apri scheda fornitore</a></div>` : '';
    return `<div style="background:#fff;border:1px solid #e5e7eb;border-radius:16px;overflow:hidden;box-shadow:0 4px 12px rgba(0,0,0,.05);">
      <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 14px;background:#f8fafc;border-bottom:1px solid #e5e7eb;">
        <div>
          <div style="font-weight:900;font-size:15px;color:#0f172a;">${name}</div>
          <div style="font-size:12px;color:#6b7280;margin-top:2px;">${orders.length} ordini registrati</div>
        </div>
        <div style="display:flex;align-items:center;gap:10px;">
          <span style="font-weight:900;font-size:16px;color:#1f4fd8;">${eurFmt(total)}</span>
          <a href="supplier.html?supplierId=${encodeURIComponent(supplierId)}" style="font-size:12px;background:#eef2ff;color:#1f4fd8;border-radius:8px;padding:5px 10px;text-decoration:none;font-weight:700;">Apri →</a>
        </div>
      </div>
      ${rows}
      ${moreCount}
    </div>`;
  }).join('');
}

function populateSupplierSelect(){
  const sel = document.getElementById('qoSupplier');
  if(!sel) return;
  sel.innerHTML = '<option value="">— Seleziona fornitore —</option>' +
    Object.entries(ordersHistory).map(([id,{name}])=>`<option value="${id}">${name}</option>`).join('');
}

// Quick order form
const addOrderGlobalBtn = document.getElementById('addOrderGlobalBtn');
const quickOrderForm = document.getElementById('quickOrderForm');
const qoCancelBtn = document.getElementById('qoCancelBtn');
const qoSaveBtn = document.getElementById('qoSaveBtn');
const qoPhotoInput = document.getElementById('qoPhotoInput');

if(addOrderGlobalBtn){
  addOrderGlobalBtn.addEventListener('click',()=>{
    quickOrderForm.style.display = quickOrderForm.style.display==='none' ? 'block' : 'none';
    // set today as default date
    const dateEl = document.getElementById('qoDate');
    if(dateEl && !dateEl.value) dateEl.value = new Date().toISOString().slice(0,10);
  });
}
if(qoCancelBtn){
  qoCancelBtn.addEventListener('click',()=>{
    quickOrderForm.style.display='none';
    document.getElementById('qoSupplier').value='';
    document.getElementById('qoDate').value='';
    document.getElementById('qoAmount').value='';
    document.getElementById('qoDesc').value='';
    document.getElementById('qoPhotoInput').value='';
    document.getElementById('qoPhotoPreview').style.display='none';
    document.getElementById('qoPhotoPlaceholder').style.display='block';
  });
}

if(qoPhotoInput){
  qoPhotoInput.addEventListener('change',()=>{
    const file = qoPhotoInput.files[0];
    if(!file) return;
    const preview = document.getElementById('qoPhotoPreview');
    const placeholder = document.getElementById('qoPhotoPlaceholder');
    const img = document.getElementById('qoPhotoImg');
    const name = document.getElementById('qoPhotoName');
    name.textContent = file.name;
    if(file.type.startsWith('image/')){
      const reader = new FileReader();
      reader.onload = e => { img.src=e.target.result; img.style.display='block'; };
      reader.readAsDataURL(file);
    } else {
      img.style.display='none';
    }
    preview.style.display='block';
    placeholder.style.display='none';
  });
}

if(qoSaveBtn){
  qoSaveBtn.addEventListener('click', async ()=>{
    const supplierId = document.getElementById('qoSupplier').value;
    const dateVal = document.getElementById('qoDate').value;
    const amount = parseFloat(document.getElementById('qoAmount').value||'0');
    const desc = document.getElementById('qoDesc').value.trim();
    if(!supplierId){ alert('Seleziona un fornitore'); return; }
    if(!dateVal){ alert('Inserisci la data'); return; }
    if(!amount || amount<=0){ alert('Inserisci un importo valido'); return; }

    qoSaveBtn.disabled = true;
    qoSaveBtn.textContent = 'Salvataggio…';
    try{
      let photoUrl = null;
      const file = qoPhotoInput ? qoPhotoInput.files[0] : null;
      if(file){
        const ext = file.name.split('.').pop();
        const path = `suppliers/${supplierId}/orders/${Date.now()}.${ext}`;
        const sRef = storageRef(storage, path);
        const snap = await uploadBytes(sRef, file);
        photoUrl = await getDownloadURL(snap.ref);
      }
      await addDoc(collection(db,'suppliers',supplierId,'invoices'),{
        dateISO: dateVal,
        description: desc||'Ordine fornitore',
        total: amount,
        totalWithVat: amount,
        invoiceDate: dateVal,
        status: 'da-pagare',
        photoUrl: photoUrl||null,
        createdAt: serverTimestamp()
      });
      alert('✅ Ordine salvato');
      quickOrderForm.style.display='none';
      document.getElementById('qoSupplier').value='';
      document.getElementById('qoDate').value='';
      document.getElementById('qoAmount').value='';
      document.getElementById('qoDesc').value='';
      if(qoPhotoInput) qoPhotoInput.value='';
      document.getElementById('qoPhotoPreview').style.display='none';
      document.getElementById('qoPhotoPlaceholder').style.display='block';
      await loadOrdersHistory();
    }catch(err){
      console.error('qoSave error',err);
      alert('❌ Errore: '+(err.message||err));
    }finally{
      qoSaveBtn.disabled=false;
      qoSaveBtn.textContent='💾 Salva ordine';
    }
  });
}

loadOrdersHistory();
