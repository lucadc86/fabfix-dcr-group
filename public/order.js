
function euro(v){
  if(v === null || v === undefined || Number.isNaN(v)) return "€ 0,00";
  return new Intl.NumberFormat('it-IT', { style:'currency', currency:'EUR' }).format(v);
}

function getTotalFromUI(){
  const v = Number(String(grandTotalEl?.textContent || "0").replace(/[^0-9.,-]/g,"").replace(",","."));
  return Number.isFinite(v) ? v : 0;
}

function updatePaymentUI(){
  if(!paymentStatusEl) return;
  const status = paymentStatusEl.value;
  if(status === "acconto"){
    depositBoxEl?.classList.remove("hidden");
  }else{
    depositBoxEl?.classList.add("hidden");
    if(depositAmountEl) depositAmountEl.value = "";
  }

  const total = getTotalFromUI();
  let deposit = Number(String(depositAmountEl?.value || "0").replace(",","."));
  if(!Number.isFinite(deposit) || deposit < 0) deposit = 0;

  let residual = total;

  if(status === "incassato"){
    deposit = total;
    residual = 0;
  }else if(status === "da_incassare"){
    deposit = 0;
    residual = total;
  }else if(status === "acconto"){
    if(deposit > total) deposit = total;
    residual = Math.max(0, total - deposit);
  }

  if(payTotalEl) payTotalEl.textContent = euro(total);
  if(payResidualEl) payResidualEl.textContent = euro(residual);

  return { status, deposit, residual, total };
}

import { db, auth } from "./firebase.js";
import {
  collection,
  addDoc,
  setDoc,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  deleteDoc,
  updateDoc,
  runTransaction
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

// ===============================
// INCASSI: sync automatico da ordine
// ===============================
function toDateKey(isoDate){
  if(!isoDate) return null;
  if(isoDate instanceof Date && !Number.isNaN(isoDate.getTime())){
    return isoDate.toISOString().split("T")[0];
  }
  const s = String(isoDate);
  // Supporto per formati italiani (dd/mm/yyyy oppure dd-mm-yyyy)
  const it = s.match(/^\s*(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})\s*$/);
  if(it){
    const dd = String(it[1]).padStart(2,"0");
    const mm = String(it[2]).padStart(2,"0");
    const yyyy = it[3];
    return `${yyyy}-${mm}-${dd}`;
  }
  if(/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  if(!Number.isNaN(d.getTime())) return d.toISOString().split("T")[0];
  return null;
}

function parseEuroLike(v){
  const s = String(v ?? "0").trim();
  const cleaned = s.replace(/[^0-9,.-]/g,"").replace(/\.(?=\d{3}(\D|$))/g,"");
  const n = Number(cleaned.replace(",","."));
  return Number.isFinite(n) ? n : 0;
}

async function getClientNameSafe(id){
  if(!id) return "";
  try{
    const cSnap = await getDoc(doc(db, "clients", id));
    if(cSnap.exists()) { const d=cSnap.data()||{}; return String(d.name || d.nome || d.ragioneSociale || d.businessName || '').trim(); }
  }catch(e){}
  return "";
}

async function removeIncassiForOrder({ orderId }){
  if(!orderId) return;

  const deletions = [];
  deletions.push(deleteDoc(doc(db, "incassi", `${orderId}_incasso`)));
  deletions.push(deleteDoc(doc(db, "incassi", `${orderId}_acconto`)));
  deletions.push(deleteDoc(doc(db, "incassi", `${orderId}_incasso_totale`)));
  deletions.push(deleteDoc(doc(db, "incassi", `${orderId}__saldo`)));
  deletions.push(deleteDoc(doc(db, "incassi", `${orderId}__incasso`)));
  deletions.push(deleteDoc(doc(db, "incassi", `${orderId}__acconto`)));

  try{
    const q = query(collection(db, "incassi"), where("orderId", "==", orderId));
    const snap = await getDocs(q);
    snap.forEach(d => deletions.push(deleteDoc(doc(db, "incassi", d.id))));
  }catch(e){
    console.warn("removeIncassiForOrder query failed:", e);
  }

  await Promise.allSettled(deletions);
}

async function createIncassoRecord({ orderId, clientId, dateKey, amount, kind, note }){
  if(!orderId) return;
  const date = dateKey || toDateKey(new Date());
  const payload = {
    date,
    note: String(note || "").trim(),
    amount: Number(amount) || 0,
    source: "order",
    orderId,
    clientId: clientId || null,
    kind: kind || null
  };
  // Scrittura deterministica (NO query / NO indici richiesti):
  // così l'incasso appare sempre e non può duplicarsi.
  const incassoId = `${orderId}_${kind || "incasso"}`;
  await setDoc(doc(db, "incassi", incassoId), payload, { merge: true });

  // Verifica immediata: se per qualsiasi motivo non viene scritto, facciamo fallire
  // per mostrarlo chiaramente (anziché "silenzio" e popup vuoto).
  const check = await getDoc(doc(db, "incassi", incassoId));
  if(!check.exists()){
    throw new Error("Incasso non scritto su Firestore (verifica permessi/regole)." );
  }
}

async function syncIncassiFromOrder({ orderId, clientId, payments, paymentStatus, total, deposit, dateKey }){
  if(!orderId) return;

  const dayKey = dateKey || toDateKey(new Date());
  const clientName = await getClientNameSafe(clientId);

  // Rimuove tutti gli incassi precedenti dell'ordine
  await removeIncassiForOrder({ orderId });

  // ---- Nuovo formato multi-pagamento (array esplicito con almeno un pagamento) ----
  // IMPORTANTE: il controllo payments.length > 0 è necessario per permettere al
  // fallback legacy (sotto) di gestire ordini con paymentStatus = "incassato"/"acconto"
  // quando nessun pagamento è stato aggiunto tramite il modal multi-pagamento.
  // Senza questa condizione, un array vuoto [] entrerebbe nel ramo, cancellerebbe
  // tutti gli incassi dell'ordine e uscirebbe senza crearne di nuovi.
  if(Array.isArray(payments) && payments.length > 0){
    for(let i = 0; i < payments.length; i++){
      const pay = payments[i];
      const amt = Number(pay.amount) || 0;
      if(amt <= 0) continue;
      const incassoId = `${orderId}__pay_${i}`;
      await setDoc(doc(db, "incassi", incassoId), {
        date: pay.date || dayKey,
        source: "ordine",
        orderId,
        clientId: clientId || null,
        clientName: clientName || null,
        kind: pay.type || "acconto",
        paymentType: pay.type || "acconto",
        amount: amt,
        method: pay.method || null,
        reference: pay.reference || null,
        note: `${clientName || 'Cliente'} • ${euro(amt)} • ${pay.type || 'acconto'}`,
        updatedAt: new Date()
      }, { merge: true });
    }
    return;
  }

  // ---- Fallback legacy (mono-pagamento) ----
  const status = paymentStatus || "da_incassare";
  const base = {
    date: dayKey,
    source: "ordine",
    orderId,
    clientId: clientId || null,
    clientName: clientName || null,
    updatedAt: new Date()
  };

  if(status === "incassato"){
    const amount = Number(total) || 0;
    await setDoc(doc(db, "incassi", `${orderId}__saldo`), {
      ...base,
      kind: "saldo",
      paymentType: "saldo",
      amount,
      note: `${clientName || 'Cliente'} • ${euro(amount)} • saldo`
    }, { merge:true });
  }else if(status === "acconto"){
    const dep = Number(deposit) || 0;
    if(dep > 0){
      await setDoc(doc(db, "incassi", `${orderId}__acconto`), {
        ...base,
        kind: "acconto",
        paymentType: "acconto",
        amount: dep,
        note: `${clientName || 'Cliente'} • ${euro(dep)} • acconto`
      }, { merge:true });
    }
  }
}

async function syncDeadlinesToScadenze(orderId, deadlines){
  if(!orderId || !Array.isArray(deadlines) || !deadlines.length) return;

  // Soft-delete delle scadenze precedenti collegate a questo ordine
  try{
    const q = query(collection(db, "scadenze"), where("orderId", "==", orderId));
    const snap = await getDocs(q);
    await Promise.allSettled(
      snap.docs.map(d => setDoc(doc(db, "scadenze", d.id), { isDeleted: true }, { merge: true }))
    );
  }catch(e){ console.warn("cleanup scadenze for order failed:", e); }

  // Crea le nuove scadenze
  for(let i = 0; i < deadlines.length; i++){
    const due = deadlines[i];
    if(!due.date || !(Number(due.amount) > 0)) continue;
    const scadenzaId = `${orderId}__due_${i}`;
    await setDoc(doc(db, "scadenze", scadenzaId), {
      date: due.date,
      amount: Number(due.amount),
      note: due.note || "",
      orderId,
      isDeleted: false,
      updatedAt: new Date()
    }, { merge: true });
  }
}



// ===============================
// PARAMETRI URL

// ===============================
const params = new URLSearchParams(window.location.search);
let clientId = params.get("clientId");
const orderId = params.get("orderId") || params.get("id");
if (!clientId && !orderId) {
  alert("❌ Parametri mancanti");
  throw new Error("ClientId / OrderId mancante");
}

// ===============================
// ELEMENTI DOM
// ===============================
const rowsBody = document.getElementById("rows");
const addRowBtn = document.getElementById("addRowBtn");
const subTotalEl = document.getElementById("subTotal");
const grandTotalEl = document.getElementById("grandTotal");

const discountPercentEl = document.getElementById("discountPercent");
const totalDiscountTextEl = document.getElementById("totalDiscount");

const paymentStatusEl = document.getElementById("paymentStatus");
const depositBoxEl = document.getElementById("depositBox");
const depositAmountEl = document.getElementById("depositAmount");
const payTotalEl = document.getElementById("payTotal");
const payResidualEl = document.getElementById("payResidual");

const ivaCheck = document.getElementById("ivaCheck");
const ivaRateEl = document.getElementById("ivaRate");
const netAmountEl = document.getElementById("netAmount");
const vatAmountEl = document.getElementById("vatAmount");

const saveBtn = document.getElementById("saveOrderBtn");
const shareBtn = document.getElementById("shareReceiptBtn");
const sharePdfBtn = document.getElementById("shareReceiptPdfBtn");
const shareImgBtn = document.getElementById("shareReceiptImgBtn");

function openWhatsAppWithText(text){
  const url = `https://wa.me/?text=${encodeURIComponent(text)}`;
  // su iPhone/Android apriamo direttamente l’app (o la pagina WhatsApp)
  window.location.href = url;
}

async function getOrderAndClient({ orderId, clientId }){
  const oSnap = await getDoc(doc(db, "orders", orderId));
  if(!oSnap.exists()) throw new Error("Ordine non trovato");
  const o = oSnap.data() || {};

  let clientName = "";
  try{
    if(clientId){
      const cSnap = await getDoc(doc(db, "clients", clientId));
      if(cSnap.exists()) clientName = (cSnap.data()?.name || "").trim();
    }
  }catch(e){}

  const dt = o.createdAt?.toDate ? o.createdAt.toDate() : (o.createdAt instanceof Date ? o.createdAt : null);
  const dateStr = dt ? dt.toLocaleDateString("it-IT") : (document.getElementById("orderDate")?.value || "");

  const total = (typeof o.total === "number") ? o.total : (typeof o.grandTotal === "number" ? o.grandTotal : getTotalFromUI());
  const status = o.paymentStatus || paymentStatusEl?.value || "";
  const deposit = (typeof o.depositAmount === "number") ? o.depositAmount : Number(String(depositAmountEl?.value||"0").replace(",","."));
  const residual = (typeof o.residual === "number") ? o.residual : Math.max(0, total - (Number.isFinite(deposit)?deposit:0));

  const statusLabel = {
    "incassato": "Incassato",
    "acconto": "Acconto",
    "da_incassare": "Da incassare"
  }[status] || status;

  const rows = Array.isArray(o.rows) ? o.rows : [];
  return { o, clientName, dateStr, total, status, statusLabel, deposit, residual, rows };
}

async function shareFileOnDevice({ blob, filename, mime }){
  // iPhone/Android: apre lo share-sheet (WhatsApp incluso). Desktop: download.
  // Evita errori su browser che non supportano bene File()/canShare().
  const makeFile = () => {
    try{
      return new File([blob], filename, { type: mime });
    }catch(_){
      return null;
    }
  };

  const fileObj = makeFile();

  if(fileObj && navigator.share && navigator.canShare && navigator.canShare({ files: [fileObj] })){
    await navigator.share({ files: [fileObj], title: filename });
    return;
  }

  // Fallback: download
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(()=>URL.revokeObjectURL(url), 1500);
}

function buildReceiptHtml({ clientName, dateStr, total, statusLabel, deposit, residual /* rows ignored */ }){
  const esc = (s)=>String(s||"").replace(/[&<>"\']/g, (c)=>({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;" }[c]));
  const eur = (n)=> new Intl.NumberFormat("it-IT",{style:"currency",currency:"EUR"}).format(Number(n||0));

  const payExtra = (statusLabel === "Acconto")
    ? `<div style="margin-top:8px;">Acconto: <strong>${eur(deposit)}</strong> — Residuo: <strong>${eur(residual)}</strong></div>`
    : "";

  const logoUrl = "./img/logo.png";

  return `
  <div id="__receipt" style="
    width: 360px;
    background:#fff;
    color:#111;
    font-family: -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;
    border:1px solid rgba(0,0,0,.12);
    border-radius:14px;
    padding:16px;
  ">
    <div style="display:flex;gap:12px;align-items:center;">
      <img src="${logoUrl}" alt="DCR GROUP" style="height:72px;width:auto;object-fit:contain" />
      <div>
        <div style="font-size:16px;font-weight:900;line-height:1.15;">DCR GROUP</div>
        <div style="font-size:12px;opacity:.85;line-height:1.15;">di Di Caro Luca • +39 3337377008</div>
        <div style="margin-top:6px;font-size:14px;font-weight:800;">RICEVUTA</div>
      </div>
    </div>

    <hr style="border:none;border-top:1px solid rgba(0,0,0,.12);margin:12px 0" />

    <div style="font-size:13px;line-height:1.35;">
      <div>Cliente: <strong>${esc(clientName)}</strong></div>
      <div>Data: <strong>${esc(dateStr)}</strong></div>
      <div>Pagamento: <strong>${esc(statusLabel)}</strong></div>
      ${payExtra}
    </div>

    <div style="margin-top:12px;padding:10px 12px;background:rgba(0,0,0,.04);border-radius:12px;display:flex;justify-content:space-between;align-items:center;">
      <div style="font-weight:800;">Totale</div>
      <div style="font-size:18px;font-weight:900;">${eur(total)}</div>
    </div>
  </div>
  `;
}
async function buildOrderReceiptText({ orderId, clientId }){
  const oSnap = await getDoc(doc(db, "orders", orderId));
  if(!oSnap.exists()) throw new Error("Ordine non trovato");
  const o = oSnap.data() || {};

  let clientName = "";
  try{
    if(clientId){
      const cSnap = await getDoc(doc(db, "clients", clientId));
      if(cSnap.exists()) clientName = (cSnap.data()?.name || "").trim();
    }
  }catch(e){}

  const dt = o.createdAt?.toDate ? o.createdAt.toDate() : (o.createdAt instanceof Date ? o.createdAt : null);
  const dateStr = dt ? dt.toLocaleDateString('it-IT') : (document.getElementById('orderDate')?.value || "");

  const total = (typeof o.total === 'number') ? o.total : (typeof o.grandTotal === 'number' ? o.grandTotal : getTotalFromUI());

  // Usa array pagamenti se disponibili
  const paymentsArr = Array.isArray(o.payments) ? o.payments : [];
  const totalPaid = paymentsArr.reduce((s, p) => s + (Number(p.amount) || 0), 0);
  const residualAmt = Math.max(0, total - totalPaid);

  const lines = [
    "RICEVUTA",
    clientName ? `Cliente: ${clientName}` : null,
    dateStr ? `Data: ${dateStr}` : null,
    `Totale ordine: ${euro(total)}`,
  ].filter(Boolean);

  if(paymentsArr.length > 0){
    lines.push(`Pagato: ${euro(totalPaid)}`);
    paymentsArr.forEach((p, i) => {
      const dStr = p.date ? new Date(p.date + 'T00:00:00').toLocaleDateString('it-IT') : '';
      lines.push(`  ${i+1}. ${p.method || ''} ${euro(p.amount)} ${dStr ? `(${dStr})` : ''} — ${p.type || ''}`.trim());
    });
    if(residualAmt > 0) lines.push(`Residuo: ${euro(residualAmt)}`);
  }else{
    const status = o.paymentStatus || "";
    const deposit = (typeof o.depositAmount === 'number') ? o.depositAmount : Number(String(depositAmountEl?.value||"0").replace(",","."));
    const residual = (typeof o.residual === 'number') ? o.residual : Math.max(0, total - (Number.isFinite(deposit)?deposit:0));
    const statusLabel = { "incassato": "Incassato", "acconto": "Acconto", "da_incassare": "Da incassare" }[status] || status;
    if(statusLabel) lines.push(`Stato pagamento: ${statusLabel}`);
    if(status === 'acconto') lines.push(`Acconto: ${euro(deposit)}\nResiduo: ${euro(residual)}`);
    if(status === 'da_incassare') lines.push(`Da incassare: ${euro(total)}`);
    if(status === 'incassato') lines.push(`Pagato: ${euro(total)}`);
  }

  return lines.join("\n");
}
const orderDateInput = document.getElementById("orderDate");

// Nuovi riferimenti UI (ordine versione UI avanzata)
const clientNameInput = document.getElementById("clientName");
const clientNameMiniInput = document.getElementById("clientNameMini");
const orderNumberInput = document.getElementById("orderNumber");
const orderNumberLabel = document.getElementById("orderNumberLabel");

function setOrderNumberUI(num) {
  try {
    if (orderNumberInput) orderNumberInput.value = num || "";
    // UI iPhone: mostra solo il numero; se non disponibile, nasconde la riga per non "tagliare" inutilmente
    if (orderNumberLabel) {
      orderNumberLabel.textContent = num ? `${num}` : "";
      const wrap = orderNumberLabel.closest('.order-number');
      if (wrap) wrap.classList.toggle('hidden', !num);
    }
  } catch (e) {}
}

const dueDateInput = document.getElementById("dueDate");
const dueAmountInput = document.getElementById("dueAmount");
const registerIncassoBtn = document.getElementById("registerIncassoBtn");

// ===============================
// SICUREZZA DOM
// ===============================
if (!rowsBody || !subTotalEl || !grandTotalEl) {
  console.error("Elementi DOM mancanti in order.html");
}

// ===============================
// PRE-CARICA CLIENTE/ORDINE
// ===============================
async function preloadClientAndOrderInfo() {
  try {
    // Se clientId è noto, mostriamo il nome
    if (clientId && clientNameInput) {
      const name = await getClientNameSafe(clientId);
      if (name) clientNameInput.value = name;
      if (name && clientNameMiniInput) clientNameMiniInput.value = name;
    }
    // Se orderId è noto, possiamo mostrare un numero ordine leggibile (ad esempio ultime 5 cifre)
    if (orderId && orderNumberInput) {
      // Mostriamo solo una porzione dell'ID per evitare stringhe lunghissime
      const year = new Date().getFullYear();
      const suffix5 = String(orderId).slice(-5).padStart(5, "0");
      const num = `${year}-${suffix5}`;
      setOrderNumberUI(num);
    }
  } catch (e) {
    console.warn("preloadClientAndOrderInfo failed", e);
  }
}

// Mirror del cliente nel mini-campo (solo UI)
if (clientNameInput && clientNameMiniInput) {
  const sync = () => { clientNameMiniInput.value = clientNameInput.value || ""; };
  clientNameInput.addEventListener("input", sync);
  clientNameInput.addEventListener("change", sync);
  sync();
}

// Rende il campo nome cliente cliccabile come link alla scheda cliente (il collegamento)
if (clientNameInput) {
  clientNameInput.style.cursor = "pointer";
  clientNameInput.title = "Apri scheda cliente";
  clientNameInput.addEventListener("click", () => {
    if (clientId) window.location.href = `/client.html?clientId=${encodeURIComponent(clientId)}`;
  });
}

// Avviamo preload non appena possibile (in background, non blocca la UI)
preloadClientAndOrderInfo();


const PRODUCT_DB_KEY = "fabfix:products:db:v1";
const PRICE_LIST_SOURCES = [
  { name: "LISAP", type: "json", url: "./assets/lisap_index.json" },
  { name: "DCM DIAPASON", type: "html", url: "./dcm-diapason.html" },
  { name: "ALFAPARF YELLOW", type: "html", url: "./alfaparf-yellow.html" },
  { name: "EUROCOSMETICS DENARO", type: "html", url: "./eurocosmetics-denaro.html" },
  { name: "SEI.0", type: "html", url: "./SEI.0.html" },
  { name: "LE VIE DELLA TERRA", type: "html", url: "./viedellaterra.html" },
];
let PRODUCT_SUGGESTIONS = [];
let PRODUCT_SUGGESTIONS_READY = false;

function normalizeProductName(v){
  return String(v || "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
function loadProductDb(){ try{ return JSON.parse(localStorage.getItem(PRODUCT_DB_KEY) || '[]'); }catch{ return []; } }
function saveProductDb(list){ localStorage.setItem(PRODUCT_DB_KEY, JSON.stringify(list || [])); }
function pickPriceValue(it){
  const candidates = [it.price, it.prezzo, it.prezzo_unita, it.prezzo_unitario, it.importo];
  for (const c of candidates){
    if (typeof c === 'number' && Number.isFinite(c)) return c;
    if (typeof c === 'string' && c.trim()){
      const n = Number(c.replace(/[^0-9,.-]/g,'').replace(/\./g,'').replace(',', '.'));
      if (Number.isFinite(n)) return n;
    }
  }
  return 0;
}
function pickProductName(it){
  return String(it.name || it.descrizione || it.prodotto || it.nome || it.articolo || it.titolo || '').trim();
}
function pickProductCode(it){ return String(it.code || it.codice || '').trim(); }
function pickProductLine(it){ return String(it.line || it.linea || '').trim(); }
function extractItemsFromHtmlText(htmlText) {
  const patterns = [
    /const\s+ITEMS\s*=\s*(\[[\s\S]*?\])\s*;/,
    /window\.ITEMS\s*=\s*(\[[\s\S]*?\])\s*;/,
    /ITEMS\s*=\s*(\[[\s\S]*?\])\s*;/,
  ];
  for (const rx of patterns){
    const m = htmlText.match(rx);
    if (!m) continue;
    try { return JSON.parse(m[1]); } catch(_){}
  }
  return [];
}
function mergeSuggestions(priceListItems, dbItems){
  const map = new Map();
  [...priceListItems, ...dbItems].forEach((item)=>{
    const key = normalizeProductName(item.name);
    if (!key) return;
    if (!map.has(key)) map.set(key, { ...item, normalizedName: key });
    else {
      const prev = map.get(key);
      if ((!prev.price || prev.price === 0) && item.price) prev.price = item.price;
      if (!prev.source && item.source) prev.source = item.source;
      if (!prev.listino && item.listino) prev.listino = item.listino;
      prev.soldQty = Math.max(prev.soldQty || 0, item.soldQty || 0);
      prev.salesCount = Math.max(prev.salesCount || 0, item.salesCount || 0);
    }
  });
  PRODUCT_SUGGESTIONS = Array.from(map.values()).sort((a,b)=> (b.salesCount||0) - (a.salesCount||0) || a.name.localeCompare(b.name));
  PRODUCT_SUGGESTIONS_READY = true;
}
async function preloadProductSuggestions(){
  try{
    const all = [];
    for (const src of PRICE_LIST_SOURCES){
      try{
        const res = await fetch(src.url, { cache:'no-store' });
        if (!res.ok) continue;
        let items = [];
        if (src.type === 'json') {
          items = await res.json();
        } else {
          items = extractItemsFromHtmlText(await res.text());
        }
        items.forEach((it)=>{
          const name = pickProductName(it);
          if (!name) return;
          all.push({
            name,
            code: pickProductCode(it),
            line: pickProductLine(it),
            price: pickPriceValue(it),
            listino: src.name,
            source: 'listino',
          });
        });
      }catch(e){ console.warn('suggest source fail', src.name, e); }
    }
    mergeSuggestions(all, loadProductDb());
  }catch(e){
    console.warn('preload suggestions failed', e);
    mergeSuggestions([], loadProductDb());
  }
}
function updateProductDatabaseFromRows(rows){
  const db = loadProductDb();
  const map = new Map(db.map((x)=>[normalizeProductName(x.name), x]));
  rows.forEach((r)=>{
    const key = normalizeProductName(r.product);
    if (!key) return;
    const prev = map.get(key) || { name: r.product, normalizedName: key, salesCount: 0, soldQty: 0, source: 'manuale' };
    prev.name = prev.name || r.product;
    prev.price = Number(r.price || prev.price || 0);
    prev.lastPrice = Number(r.price || prev.lastPrice || 0);
    prev.salesCount = Number(prev.salesCount || 0) + 1;
    prev.soldQty = Number(prev.soldQty || 0) + Number(r.qty || 0);
    prev.updatedAtISO = new Date().toISOString();
    map.set(key, prev);
  });
  const out = Array.from(map.values());
  saveProductDb(out);
  mergeSuggestions(PRODUCT_SUGGESTIONS.filter((x)=>x.source === 'listino'), out);
}
function renderSuggestions(dropdown, matches){
  if (!dropdown) return;
  if (!matches.length) { dropdown.innerHTML = ''; dropdown.classList.remove('show'); return; }
  dropdown.innerHTML = matches.map((m)=>`<div class="product-suggest-item" data-name="${m.name.replace(/"/g,'&quot;')}" data-price="${Number(m.price || 0)}"><div class="product-suggest-name">${m.name}</div><div class="product-suggest-meta">${[m.listino || m.source || 'banca dati', m.code || m.line || '', m.price ? euro(m.price) : ''].filter(Boolean).join(' • ')}</div></div>`).join('');
  dropdown.classList.add('show');
}
function attachProductAutocomplete(row){
  const input = row.querySelector('.product');
  const priceInput = row.querySelector('.price');
  const dropdown = row.querySelector('.product-suggest');
  if (!input || !dropdown) return;

  const update = async ()=>{
    const q = normalizeProductName(input.value);
    if (!q || q.length < 2) { renderSuggestions(dropdown, []); return; }
    if (!PRODUCT_SUGGESTIONS_READY) {
      try { await preloadProductSuggestions(); } catch(_){}
    }
    const pool = Array.isArray(PRODUCT_SUGGESTIONS) ? PRODUCT_SUGGESTIONS : [];
    const matches = pool.filter((item)=>{
      const hay = `${item.normalizedName || ''} ${normalizeProductName(item.code)} ${normalizeProductName(item.line)}`;
      return hay.includes(q);
    }).slice(0, 8);
    renderSuggestions(dropdown, matches);
  };

  input.addEventListener('input', update);
  input.addEventListener('focus', update);
  input.addEventListener('blur', ()=> setTimeout(()=> dropdown.classList.remove('show'), 150));
  dropdown.addEventListener('mousedown', (e)=>{
    const item = e.target.closest('.product-suggest-item');
    if (!item) return;
    input.value = item.dataset.name || '';
    if (priceInput && !(Number(priceInput.value) > 0)) priceInput.value = String(Number(item.dataset.price || 0).toFixed(2));
    dropdown.classList.remove('show');
    calculate();
  });
}

// ===============================
// DATA OGGI DEFAULT
// ===============================
if (!orderId && orderDateInput) {
  const today = new Date().toISOString().split("T")[0];
  orderDateInput.value = today;
}

// ===============================
// AGGIUNGI RIGA
// ===============================
function addRow(data = {}) {
  // RIGA RESPONSIVE (no tabella): descrizione larga + qty/prezzo stretti + totale riga
  const row = document.createElement("div");
  row.className = "ff-order-row";

  const product = String(data.product ?? "");
  const qty = Number.isFinite(Number(data.qty)) ? Number(data.qty) : (data.qty ? Number(data.qty) : 1);
  const price = Number.isFinite(Number(data.price)) ? Number(data.price) : (data.price ? Number(data.price) : 0);

  row.innerHTML = `
    <div class="ff-order-row-grid">
      <div class="order-field order-field--product">
        <label>Descrizione</label>
        <input type="text" class="product input" value="${product.replace(/"/g, '&quot;')}" placeholder="Inserisci descrizione prodotto" autocomplete="off" /><div class="product-suggest"></div>
      </div>

      <div class="order-field order-field--qty">
        <label>Q.tà</label>
        <input type="number" class="qty input" value="${Number.isFinite(qty) ? qty : 1}" min="1" />
      </div>

      <div class="order-field order-field--price">
        <label>Prezzo</label>
        <input type="number" class="price input" value="${Number.isFinite(price) ? price : 0}" step="0.01" min="0" />
      </div>

      <button type="button" class="icon-btn icon-btn--sm row-del" aria-label="Elimina riga">
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M6 7h12l-1 14H7L6 7Zm3-3h6l1 2H8l1-2Z"/></svg>
      </button>
    </div>

    <div class="ff-order-row-bottom">
      <div class="ff-order-row-total">
        <span>Totale riga</span>
        <strong class="row-total">0.00</strong>
      </div>
    </div>
  `;

  rowsBody.appendChild(row);
  attachProductAutocomplete(row);

  row.querySelectorAll("input").forEach(input => {
    input.addEventListener("input", calculate);
  });

  row.querySelector(".row-del")?.addEventListener("click", () => {
    row.remove();
    calculate();
  });

  calculate();
}

// ===============================
// CALCOLI TOTALI
// ===============================
function calculate() {
  let subtotal = 0;

  rowsBody.querySelectorAll(".ff-order-row").forEach(row => {
    const qty = Number(row.querySelector(".qty")?.value) || 0;
    const price = Number(row.querySelector(".price")?.value) || 0;
    const total = qty * price;

    const totEl = row.querySelector(".row-total");
    if (totEl) totEl.textContent = total.toFixed(2);
    subtotal += total;
  });

  subTotalEl.textContent = subtotal.toFixed(2);

// Sconto % (applicato sul totale IVA-inclusa)
let discountPct = 0;
if (discountPercentEl) {
  discountPct = Number(String(discountPercentEl.value || "0").replace(",", "."));
  if (!Number.isFinite(discountPct)) discountPct = 0;
  discountPct = Math.max(0, Math.min(100, discountPct));
  // normalizza UI
  discountPercentEl.value = String(discountPct);
}
if (totalDiscountTextEl) totalDiscountTextEl.textContent = String(discountPct);

const discountedTotal = subtotal * (1 - discountPct / 100);

// IVA opzionale: se attiva calcoliamo imponibile e IVA partendo dal totale (IVA inclusa)
let rate = 0;
if (ivaCheck && ivaCheck.checked) {
  const r = ivaRateEl ? parseFloat(ivaRateEl.value) : 0.22;
  rate = isNaN(r) ? 0.22 : r;
}

let net = discountedTotal;
let vat = 0;
if (rate > 0) {
  net = discountedTotal / (1 + rate);
  vat = discountedTotal - net;
}

if (netAmountEl) netAmountEl.textContent = net.toFixed(2);
if (vatAmountEl) vatAmountEl.textContent = vat.toFixed(2);

// Il totale ordine resta il totale IVA inclusa
grandTotalEl.textContent = discountedTotal.toFixed(2);
}

// ===============================
// CARICA ORDINE (MODIFICA)
// ===============================
async function loadOrderForEdit() {
  try {
    const snap = await getDoc(doc(db, "orders", orderId));
    if (!snap.exists()) return;

    const o = snap.data();

    ivaCheck.checked = !!o.iva;

    if (o.createdAt?.toDate && orderDateInput) {
      const d = o.createdAt.toDate().toISOString().split("T")[0];
      orderDateInput.value = d;
    }

    rowsBody.innerHTML = "";

    (o.rows || []).forEach(r => addRow(r));

    calculate();

    // --- Backward compat: mantieni i campi legacy per updatePaymentUI ---
    if (paymentStatusEl) {
      paymentStatusEl.value = o.paymentStatus || "da_incassare";
    }
    if (depositAmountEl) {
      const dep = Number(o.depositAmount ?? 0);
      depositAmountEl.value = Number.isFinite(dep) && dep > 0 ? String(dep) : "";
    }
    updatePaymentUI();

    // --- Nuovi campi (UI avanzata) ---
    if (clientNameInput && o.clientId) {
      try {
        const name = await getClientNameSafe(o.clientId);
        if (name) clientNameInput.value = name;
      } catch (e) {}
    }
    if (orderNumberInput) {
      const year = new Date().getFullYear();
      const suffix5 = String(orderId).slice(-5).padStart(5, "0");
      const num = `${year}-${suffix5}`;
      setOrderNumberUI(num);
    }

    // --- Multi-pagamento e multi-scadenza ---
    // Leggiamo l'array salvato (nuovo formato)
    let savedPayments = Array.isArray(o.payments) ? o.payments : [];
    let savedDeadlines = Array.isArray(o.deadlines) ? o.deadlines : [];

    // Backward compat: se payments vuoto, sintetizza dal vecchio formato
    if (!savedPayments.length && o.paymentStatus && o.paymentStatus !== "da_incassare") {
      const dep = Number(o.depositAmount ?? 0);
      const orderTotal = Number(o.total ?? 0);
      const orderDateISO = o.createdAt?.toDate
        ? o.createdAt.toDate().toISOString().split("T")[0]
        : (orderDateInput?.value || new Date().toISOString().split("T")[0]);
      if (o.paymentStatus === "incassato" && orderTotal > 0) {
        savedPayments = [{ id: "legacy", amount: orderTotal, method: "Bonifico Bancario", reference: "", date: orderDateISO, type: "incassato" }];
      } else if (o.paymentStatus === "acconto" && dep > 0) {
        savedPayments = [{ id: "legacy", amount: dep, method: "Bonifico Bancario", reference: "", date: orderDateISO, type: "acconto" }];
      }
    }

    // Backward compat: se deadlines vuoto, sintetizza dal vecchio formato
    if (!savedDeadlines.length && o.dueAmount > 0 && o.dueDate) {
      let dueDateISO = null;
      if (o.dueDate?.toDate) dueDateISO = o.dueDate.toDate().toISOString().split("T")[0];
      else if (o.dueDate instanceof Date) dueDateISO = o.dueDate.toISOString().split("T")[0];
      else if (typeof o.dueDate === 'string') dueDateISO = o.dueDate.slice(0, 10);
      if (dueDateISO) {
        savedDeadlines = [{ id: "legacy", amount: Number(o.dueAmount), date: dueDateISO, note: "" }];
      }
    }

    // Inizializza la UI multi-pagamento (order-ui.js potrebbe non essere ancora caricato,
    // ma poiché questo è async e order-ui.js è un modulo deferred, sarà pronto)
    if (window.__fabfix?.init) {
      window.__fabfix.init({ payments: savedPayments, deadlines: savedDeadlines });
    } else {
      // Fallback: salva i dati per l'init ritardato
      window.__fabfix_pending_init = { payments: savedPayments, deadlines: savedDeadlines };
    }

  } catch (err) {
    console.error("Errore caricamento ordine:", err);
    alert("Errore caricamento ordine");
  }
}

// ===============================
// SALVA ORDINE
// ===============================
saveBtn.addEventListener("click", async () => {
  const rows = [];

  rowsBody.querySelectorAll(".ff-order-row").forEach(row => {
    const product = (row.querySelector(".product")?.value || "").trim();
    const qty = Number(row.querySelector(".qty")?.value);
    const price = Number(row.querySelector(".price")?.value);
    const total = (Number.isFinite(qty) ? qty : 0) * (Number.isFinite(price) ? price : 0);

    if (product && qty > 0 && price >= 0) {
      rows.push({ product, qty, price, total });
    }
  });

  if (rows.length === 0) {
    alert("\u274c Inserisci almeno una riga valida");
    return;
  }

  if(!clientId){
    await ensureClientIdFromOrder();
  }
  if(!clientId){
    alert("\u274c Cliente non collegato. Apri l'ordine dalla scheda cliente (clientId mancante).");
    return;
  }

  // Leggi pagamenti e scadenze dalla UI multi
  const fab = window.__fabfix;
  const paymentsArr = fab?.getPayments() || [];
  const deadlinesArr = fab?.getDeadlines() || [];

  const orderTotal = parseEuroLike(grandTotalEl.textContent);

  // Calcola campi legacy per backward compat
  let paymentStatus = "da_incassare";
  let depositAmount = 0;
  let residual = orderTotal;
  if(paymentsArr.length > 0){
    const totalPaid = paymentsArr.reduce((s, p) => s + (Number(p.amount) || 0), 0);
    if(totalPaid >= orderTotal && orderTotal > 0){
      paymentStatus = "incassato";
      depositAmount = orderTotal;
      residual = 0;
    }else if(totalPaid > 0){
      paymentStatus = "acconto";
      depositAmount = totalPaid;
      residual = Math.max(0, orderTotal - totalPaid);
    }
  }else{
    const pay = updatePaymentUI() || { status: "da_incassare", deposit: 0, residual: orderTotal };
    paymentStatus = pay.status || "da_incassare";
    depositAmount = Number(pay.deposit || 0);
    residual = Number(pay.residual ?? orderTotal);
  }

  const uiClientName = String((clientNameInput?.value || clientNameMiniInput?.value || "").trim());
  const safeClientName = uiClientName || await getClientNameSafe(clientId);

  const orderData = {
    rows,
    subtotal: parseEuroLike(subTotalEl.textContent),
    total: orderTotal,
    iva: ivaCheck.checked,
    paymentStatus,
    depositAmount,
    residual,
    payments: paymentsArr,
    deadlines: deadlinesArr,
    clientName: safeClientName || ""
  };

  const dateKey = toDateKey(orderDateInput?.value);
  const createdAtDate = dateKey ? new Date(dateKey) : (orderDateInput?.value ? new Date(orderDateInput.value) : new Date());
  orderData.createdAt = createdAtDate;

  if (document.getElementById("orderNote")) {
    const noteVal = String(document.getElementById("orderNote").value || "").trim();
    if (noteVal) orderData.note = noteVal;
  }

  // Mantieni dueDate/dueAmount legacy (prende dalla prima scadenza)
  if(deadlinesArr.length > 0){
    const firstDue = deadlinesArr[0];
    if(firstDue.date) orderData.dueDate = new Date(firstDue.date);
    if(firstDue.amount > 0) orderData.dueAmount = firstDue.amount;
  }

  try {
    let savedOrderId = orderId;

    orderData.clientId = clientId;

    if (orderId) {
      await updateDoc(doc(db, "orders", orderId), { ...orderData });
    } else {
      const ref = await addDoc(collection(db, "orders"), orderData);
      savedOrderId = ref.id;
    }

    updateProductDatabaseFromRows(rows);

    // \u{1F525} Sync incassi (multi-pagamento)
    await ensureClientIdFromOrder();
    await syncIncassiFromOrder({
      orderId: savedOrderId,
      clientId,
      payments: paymentsArr,
      paymentStatus,
      total: orderTotal,
      deposit: depositAmount,
      dateKey: dateKey || toDateKey(createdAtDate)
    });

    // \u{1F4C5} Sync scadenze (multi-scadenza)
    try{
      await syncDeadlinesToScadenze(savedOrderId, deadlinesArr);
    }catch(e){ console.warn("syncDeadlinesToScadenze failed:", e); }

    // \u{1F514} Evento agenda per l'ordine
    try{
      await addDoc(collection(db, "agendaEvents"), {
        title: "Ordine cliente",
        start: createdAtDate,
        end: createdAtDate,
        allDay: true
      });
    }catch(e){ console.warn("agendaEvents add fail (order)", e); }

    // \u{1F514} Evento agenda per ogni scadenza
    try{
      for(const due of deadlinesArr){
        if(due.date){
          await addDoc(collection(db, "agendaEvents"), {
            title: "Scadenza ordine",
            start: new Date(due.date),
            end: new Date(due.date),
            allDay: true,
            orderId: savedOrderId,
            type: "dueDate"
          });
        }
      }
    }catch(e){ console.warn("agendaEvents deadlines fail", e); }

    alert(orderId ? "\u2705 Ordine aggiornato" : "\u2705 Ordine salvato");

    if(clientId && clientId !== "null" && clientId !== "undefined"){
      window.location.href = `client.html?clientId=${clientId}`;
    } else {
      window.location.href = "clients.html";
    }
  } catch (err) {
    console.error("Errore salvataggio ordine:", err);
    alert("\u274c Errore salvataggio ordine");
  }
})

// 📲 Condividi ricevuta su WhatsApp (iPhone/Android/Desktop)
if(shareBtn){
  const __shareReceiptHandler = async () => {
    try{
      // Se stiamo creando un ordine nuovo, prima va salvato (per avere un orderId)
      if(!orderId){
        alert("Prima salva l'ordine, poi puoi inviare la ricevuta su WhatsApp.");
        return;
      }
      await ensureClientIdFromOrder();
      const text = await buildOrderReceiptText({ orderId, clientId });
      openWhatsAppWithText(text);
    }catch(e){
      console.error("Errore condivisione ricevuta:", e);
      alert("❌ Impossibile generare la ricevuta");
    }
  };
  shareBtn.addEventListener("click", (e)=>{ e.preventDefault(); __shareReceiptHandler(); });
  shareBtn.addEventListener("touchend", (e)=>{ e.preventDefault(); __shareReceiptHandler(); });
}


// 📄 Condividi ricevuta come PDF (allegabile su WhatsApp con share-sheet iPhone)
if(sharePdfBtn){
  sharePdfBtn.addEventListener("click", async () => {
    try{
      if(!orderId){
        alert("Prima salva l'ordine, poi puoi generare la ricevuta.");
        return;
      }
      await ensureClientIdFromOrder();
      const data = await getOrderAndClient({ orderId, clientId });

      if(!window.jspdf || !window.jspdf.jsPDF){
        alert("Libreria PDF non caricata.");
        return;
      }
      const { jsPDF } = window.jspdf;
      const docPdf = new jsPDF({ unit: "pt", format: "a4" });

      // Logo (opzionale) in alto
      let startY = 60;
      try{
        const logoDataUrl = await loadLogoDataUrl();
        if(logoDataUrl){
          const maxW = 140;
          const maxH = 60;
          // Manteniamo proporzioni usando un canvas temporaneo (loadLogoDataUrl è già PNG)
          // In jsPDF le dimensioni sono in pt.
          docPdf.addImage(logoDataUrl, "PNG", 40, 25, maxW, maxH);
          startY = 110;
        }
      }catch(_e){
        // logo non disponibile: ignoriamo
      }

      const eur = (n)=> new Intl.NumberFormat("it-IT",{style:"currency",currency:"EUR"}).format(Number(n||0));
      const lines = [];
      lines.push("RICEVUTA");
      if(data.clientName) lines.push("Cliente: " + data.clientName);
      if(data.dateStr) lines.push("Data: " + data.dateStr);
      if(data.statusLabel) lines.push("Stato pagamento: " + data.statusLabel);
      if(data.status === "acconto"){
        lines.push("Acconto: " + eur(data.deposit));
        lines.push("Residuo: " + eur(data.residual));
      }
      lines.push("");
      lines.push("Righe:");
      if(data.rows.length){
        data.rows.forEach((r)=>{
          const p = (r.product || r.name || "");
          const q = Number(r.qty || 0);
          const pr = Number(r.price || 0);
          const t = Number(r.total || (q*pr) || 0);
          lines.push(`- ${p} | ${q} x ${eur(pr)} = ${eur(t)}`);
        });
      }else{
        lines.push("- (nessuna riga)");
      }
      lines.push("");
      lines.push("Totale: " + eur(data.total));

      const text = lines.join("\n");
      const margin = 40;
      const maxW = 515;
      const wrapped = docPdf.splitTextToSize(text, maxW);
      docPdf.setFont("helvetica", "normal");
      docPdf.setFontSize(12);
      docPdf.text(wrapped, margin, startY);

      const blob = docPdf.output("blob");
      const safeName = `ricevuta_${orderId}.pdf`;

      await shareFileOnDevice({ blob, filename: safeName, mime: "application/pdf" });
    }catch(e){
      console.error(e);
      alert("❌ Errore generazione PDF");
    }
  });
}

// 🖼️ Condividi ricevuta come immagine (PNG) (allegabile su WhatsApp con share-sheet iPhone)
if(shareImgBtn){
  shareImgBtn.addEventListener("click", async () => {
    try{
      if(!orderId){
        alert("Prima salva l'ordine, poi puoi generare la ricevuta.");
        return;
      }
      await ensureClientIdFromOrder();
      const data = await getOrderAndClient({ orderId, clientId });

      // iOS Safari è spesso instabile con html2canvas su pagine complesse.
      // Per evitare errori, generiamo una ricevuta "pulita" disegnata su canvas.
      const blob = await renderReceiptPngBlob(data);
      const safeName = `ricevuta_${orderId}.png`;

      await shareFileOnDevice({ blob, filename: safeName, mime: "image/png" });
    }catch(e){
      console.error(e);
      alert("❌ Errore generazione immagine");
    }
  });
}

// ===============================
// Scadenze: salva le scadenze dall'array UI sull'ordine e su Firestore
// ===============================
if(registerIncassoBtn){
  const handleSaveDue = async () => {
    try{
      if(!orderId){
        alert("Prima salva l'ordine, poi puoi memorizzare le scadenze.");
        return;
      }
      await ensureClientIdFromOrder();

      const deadlinesArr = window.__fabfix?.getDeadlines() || [];
      if(!deadlinesArr.length){
        alert("Aggiungi almeno una scadenza prima di salvare.");
        return;
      }

      // Mantieni dueDate/dueAmount legacy (prende dalla prima scadenza)
      const legacy = {};
      const firstDue = deadlinesArr[0];
      if(firstDue.date) legacy.dueDate = new Date(firstDue.date);
      if(firstDue.amount > 0) legacy.dueAmount = firstDue.amount;

      await updateDoc(doc(db, 'orders', orderId), {
        deadlines: deadlinesArr,
        ...legacy,
        updatedAt: new Date()
      });

      // Sync su scadenze collection
      await syncDeadlinesToScadenze(orderId, deadlinesArr);

      // Evento agenda per ogni scadenza (safe)
      try{
        for(const due of deadlinesArr){
          if(due.date){
            await addDoc(collection(db, 'agendaEvents'), {
              title: 'Scadenza ordine',
              start: new Date(due.date),
              end: new Date(due.date),
              allDay: true,
              orderId,
              type: 'dueDate'
            });
          }
        }
      }catch(e){ console.warn('agendaEvents dueDate add fail', e); }

      alert('✅ Scadenze salvate');
    }catch(e){
      console.error('Errore salvataggio scadenze', e);
      alert('❌ Errore salvataggio scadenze');
    }
  };
  registerIncassoBtn.addEventListener('click', (e)=>{ e.preventDefault(); handleSaveDue(); });
  registerIncassoBtn.addEventListener('touchend', (e)=>{ e.preventDefault(); handleSaveDue(); });
}

// ===============================
// Scadenze: Invia promemoria WhatsApp (multi-scadenza)
// ===============================
const sendReminderBtn = document.getElementById("sendReminderBtn");
if(sendReminderBtn){
  const handleSendReminder = async () => {
    try{
      const deadlinesArr = window.__fabfix?.getDeadlines() || [];
      if(!deadlinesArr.length){
        alert("Aggiungi prima almeno una scadenza.");
        return;
      }
      await ensureClientIdFromOrder();
      const clientName = (clientNameInput?.value || "").trim() || await getClientNameSafe(clientId);

      const lines = [
        "⏰ PROMEMORIA SCADENZE",
        clientName ? `Cliente: ${clientName}` : null,
        orderId ? `Rif. ordine: …${String(orderId).slice(-5).toUpperCase()}` : null,
        "",
      ].filter(v => v !== null);

      deadlinesArr.forEach((due, i) => {
        const dateStr = due.date ? new Date(due.date + "T00:00:00").toLocaleDateString("it-IT") : "N/D";
        lines.push(`${i + 1}. ${dateStr} — ${euro(due.amount)}${due.note ? ` (${due.note})` : ""}`);
      });

      openWhatsAppWithText(lines.join("\n"));
    }catch(e){
      console.error("Errore promemoria:", e);
      alert("❌ Impossibile inviare il promemoria");
    }
  };
  sendReminderBtn.addEventListener("click", (e)=>{ e.preventDefault(); handleSendReminder(); });
  sendReminderBtn.addEventListener("touchend", (e)=>{ e.preventDefault(); handleSendReminder(); });
}

// ===============================
// RICEVUTA: Canvas renderer (PNG)
// ===============================
async function renderReceiptPngBlob(data){
  // Canvas A4 @ 144dpi circa (più leggero di 2x html2canvas)
  const W = 1240;
  const H = 1754;
  const pad = 80;

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');

  // Background
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0,0,W,H);

  // Logo (opzionale). Puoi sostituire:
  // - /public/img/logo.png  (consigliato)
  // - /public/logo.png      (fallback)
  // Usiamo un cache-buster per evitare cache su iPhone/Chrome.
  const v = Date.now();
  const logo = await (async()=>{
    const candidates = [`./img/logo.png?v=${v}`, `./logo.png?v=${v}`];
    for(const src of candidates){
      const img = await tryLoadImage(src);
      if(img) return img;
    }
    return null;
  })();
  let y = pad;
  if(logo){
    const maxLogoW = 260;
    const scale = Math.min(1, maxLogoW / logo.width);
    const lw = Math.round(logo.width * scale);
    const lh = Math.round(logo.height * scale);
    ctx.drawImage(logo, pad, y, lw, lh);
  }

  // Titolo
  ctx.fillStyle = '#111827';
  ctx.font = 'bold 48px -apple-system, BlinkMacSystemFont, Segoe UI, Arial';
  ctx.textBaseline = 'top';
  const titleX = pad;
  y += logo ? 120 : 0;
  ctx.fillText('RICEVUTA', titleX, y);
  y += 70;

  const eur = (n)=> new Intl.NumberFormat('it-IT',{style:'currency',currency:'EUR'}).format(Number(n||0));
  const line = (label, value) => `${label}: ${value}`;

  ctx.font = '28px -apple-system, BlinkMacSystemFont, Segoe UI, Arial';
  const lines = [];
  if(data.clientName) lines.push(line('Cliente', data.clientName));
  if(data.dateStr) lines.push(line('Data', data.dateStr));
  if(data.statusLabel) lines.push(line('Stato pagamento', data.statusLabel));
  if(data.status === 'acconto'){
    lines.push(line('Acconto', eur(data.deposit)));
    lines.push(line('Residuo', eur(data.residual)));
  }
  lines.push('');
  lines.push('Righe:');
  if(data.rows && data.rows.length){
    data.rows.forEach(r=>{
      const p = (r.product || r.name || '').toString();
      const q = Number(r.qty || 0);
      const pr = Number(r.price || 0);
      const t = Number(r.total || (q*pr) || 0);
      lines.push(`• ${p}  (${q} x ${eur(pr)})  =  ${eur(t)}`);
    });
  }else{
    lines.push('• (nessuna riga)');
  }
  lines.push('');
  lines.push(line('Totale', eur(data.total)));

  // Stampa testo con wrapping
  const maxTextW = W - pad*2;
  const lh = 40;
  for(const raw of lines){
    if(raw === ''){ y += lh*0.6; continue; }
    const wrapped = wrapText(ctx, raw, maxTextW);
    for(const wLine of wrapped){
      // Se sforiamo pagina, riduciamo (non dovrebbe succedere con ricevute normali)
      if(y > H - pad - lh){
        break;
      }
      ctx.fillText(wLine, pad, y);
      y += lh;
    }
  }

  // Footer
  ctx.font = '20px -apple-system, BlinkMacSystemFont, Segoe UI, Arial';
  ctx.fillStyle = '#6b7280';
  ctx.fillText('Generato da Gestionale', pad, H - pad);

  const blob = await canvasToBlob(canvas, 'image/png');
  if(!blob) throw new Error('toBlob failed');
  return blob;
}

function wrapText(ctx, text, maxWidth){
  const words = String(text).split(' ');
  const out = [];
  let line = '';
  for(const w of words){
    const test = line ? (line + ' ' + w) : w;
    const width = ctx.measureText(test).width;
    if(width <= maxWidth){
      line = test;
    }else{
      if(line) out.push(line);
      line = w;
    }
  }
  if(line) out.push(line);
  return out;
}

async function canvasToBlob(canvas, type){
  return await new Promise((resolve)=>{
    if(canvas.toBlob){
      canvas.toBlob(async (b)=>{
        if(b){
          resolve(b);
          return;
        }
        // Fallback: alcuni Safari possono restituire null
        try{
          const dataUrl = canvas.toDataURL(type);
          const blob = await fetch(dataUrl).then(r=>r.blob());
          resolve(blob);
        }catch(_e){
          resolve(null);
        }
      }, type);
    } else {
      try{
        const dataUrl = canvas.toDataURL(type);
        fetch(dataUrl).then(r=>r.blob()).then(resolve).catch(()=>resolve(null));
      }catch(e){
        resolve(null);
      }
    }
  });
}

function getLogoUrl(){
  const v = Date.now();
  // Preferiamo /img/logo.png ma manteniamo compatibilità con /logo.png
  return `./img/logo.png?v=${v}`;
}

async function loadLogoDataUrl(){
  const v = Date.now();
  const candidates = [`./img/logo.png?v=${v}`, `./logo.png?v=${v}`];
  for(const src of candidates){
    const img = await tryLoadImage(src);
    if(img){
      const c = document.createElement("canvas");
      c.width = img.width;
      c.height = img.height;
      const ctx = c.getContext("2d");
      ctx.drawImage(img, 0, 0);
      try{
        return c.toDataURL("image/png");
      }catch(_e){
        return null;
      }
    }
  }
  return null;
}

async function tryLoadImage(src){
  try{
    const img = new Image();
    img.crossOrigin = 'anonymous';
    const p = new Promise((resolve, reject)=>{
      img.onload = ()=>resolve(img);
      img.onerror = ()=>resolve(null);
    });
    img.src = src;
    return await p;
  }catch(e){
    return null;
  }
}
// ===============================
// EVENTI
// ===============================
addRowBtn.addEventListener("click", () => addRow());

if(paymentStatusEl){
  paymentStatusEl.addEventListener("change", updatePaymentUI);
}
if(depositAmountEl){
  depositAmountEl.addEventListener("input", updatePaymentUI);
}

ivaCheck.addEventListener("change", calculate);
if(ivaRateEl){ ivaRateEl.addEventListener("change", calculate); }
if(discountPercentEl){ discountPercentEl.addEventListener("input", calculate); discountPercentEl.addEventListener("change", calculate); }

// ===============================
// AVVIO PAGINA
// ===============================
// ✅ Init
// 🔥 AVVIO SUGGERIMENTI DOPO INIZIALIZZAZIONE (FIX CRITICO)
setTimeout(() => {
  preloadProductSuggestions();
}, 0);
function waitForAuth() {
  return new Promise(resolve => {
    const unsub = onAuthStateChanged(auth, user => { unsub(); resolve(user); });
  });
}

waitForAuth().then(async () => {
  if (orderId) {
    await ensureClientIdFromOrder();
    loadOrderForEdit();
  } else {
    if(!clientId){
      alert("❌ Seleziona prima un cliente.");
      window.location.href = "clients.html";
      return;
    }
    // Popola il nome cliente ora che l'autenticazione è pronta
    try {
      const name = await getClientNameSafe(clientId);
      if (name && clientNameInput) clientNameInput.value = name;
      if (name && clientNameMiniInput) clientNameMiniInput.value = name;
    } catch(e) { /* ignoriamo */ }
    addRow();
  }
});
async function ensureClientIdFromOrder(){
  // Se l'URL non porta clientId (bug / link vecchio), proviamo a recuperarlo dall'ordine
  if (clientId || !orderId) return;
  try{
    const snap = await getDoc(doc(db, "orders", orderId));
    if(snap.exists()){
      const data = snap.data() || {};
      if(data.clientId) clientId = data.clientId;
    }
  }catch(e){
    // ignoriamo: se non riusciamo, useremo fallback su lista clienti
  }
}


