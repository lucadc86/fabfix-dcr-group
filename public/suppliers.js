import { db } from "./firebase.js";
import {
  collection,
  getDocs,
  doc,
  query,
  orderBy,
  writeBatch
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

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
