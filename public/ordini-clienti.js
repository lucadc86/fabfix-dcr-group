// Preventivo semplice (offline) con esportazione PDF/Immagine e invio WhatsApp.

import { db } from "./firebase.js";
import {
  collection, doc, getDoc, setDoc, runTransaction, addDoc, serverTimestamp,
  query, orderBy, limit, getDocs, deleteDoc
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const STORAGE_KEY = "dcr_preventivo_v1";

const rowsEl = document.getElementById("rows");
const clientNameEl = document.getElementById("clientName");
const quoteDateEl = document.getElementById("quoteDate");
const grandTotalEl = document.getElementById("grandTotal");

const addRowBtn = document.getElementById("addRow");
const saveBtn = document.getElementById("save");
const resetBtn = document.getElementById("reset");
const shareWhatsBtn = document.getElementById("shareWhats");
const exportPdfBtn = document.getElementById("exportPdf");
const exportImgBtn = document.getElementById("exportImg");

const historyBodyEl = document.getElementById("historyBody");
const PREVENTIVI_COLLECTION = "preventivi";
const COUNTER_DOC = { col: "counters", id: "preventivi" };

// iOS/iPad Safari: a volte i click su elementi dentro layout complessi vengono "persi"
// (overlay/scroll container). Usiamo un binding "tap" robusto (touchend + click)
// con guard per evitare doppie esecuzioni.
function bindTap(el, handler){
  if (!el) return;
  let locked = false;
  const run = async (ev) => {
    try{
      // Evita che un parent/scroll intercetti il tap
      if (ev && typeof ev.preventDefault === "function") ev.preventDefault();
      if (ev && typeof ev.stopPropagation === "function") ev.stopPropagation();
    }catch{}
    if (locked) return;
    locked = true;
    try{
      await handler(ev);
    } finally {
      // rilascio veloce, ma evita doppio trigger touchend+click
      setTimeout(() => { locked = false; }, 450);
    }
  };
  el.addEventListener("touchend", run, { passive: false });
  el.addEventListener("click", run);
}

// ✅ FIX DEFINITIVO iOS/iPad: se un layer (scroll/overlay) intercetta il tap,
// il target dell'evento NON è il bottone e quindi i listener non partono.
// Qui rileviamo la coordinata del tap e forziamo il click sul bottone più vicino.
function installIOSHardTapFix(buttons){
  const isTouch = "ontouchstart" in window || navigator.maxTouchPoints > 0;
  if (!isTouch) return;

  let moved = false;
  document.addEventListener("touchstart", () => { moved = false; }, { capture:true, passive:true });
  document.addEventListener("touchmove", () => { moved = true; }, { capture:true, passive:true });

  document.addEventListener("touchend", (ev) => {
    try{
      if (moved) return; // era scroll
      const t = ev.changedTouches && ev.changedTouches[0];
      if (!t) return;
      const x = t.clientX, y = t.clientY;

      // Se il tap è già su un bottone, lascia fare al normale handler
      const direct = document.elementFromPoint(x, y);
      if (direct && direct.closest && direct.closest("button")) return;

      for (const b of buttons){
        if (!b) continue;
        const r = b.getBoundingClientRect();
        if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom){
          // Forza click sul bottone giusto
          b.click();
          break;
        }
      }
    }catch{}
  }, { capture:true, passive:false });
}

function formatPrevNum(n){
  const s = String(Number(n||0)).padStart(4, "0");
  return `PREV-${s}`;
}


function euro(n){
  const v = Number.isFinite(n) ? n : 0;
  return v.toLocaleString("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function parseNum(v){
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const s = String(v ?? "").trim();
  if (!s) return 0;
  let c = s.replace(/[^0-9,.-]/g, "");
  if (c.includes(",")) c = c.replace(/\./g, "").replace(",", ".");
  const n = Number(c);
  return Number.isFinite(n) ? n : 0;
}

function todayISO(){
  const d = new Date();
  const pad = (x) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
}

function defaultModel(){
  return {
    clientName: "",
    date: todayISO(),
    rows: [ { desc: "", qty: 1, price: 0 } ]
  };
}

function load(){
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultModel();
    const obj = JSON.parse(raw);
    if (!obj || !Array.isArray(obj.rows)) return defaultModel();
    if (!obj.rows.length) obj.rows = defaultModel().rows;
    if (!obj.date) obj.date = todayISO();
    return obj;
  } catch {
    return defaultModel();
  }
}

function save(model){
  localStorage.setItem(STORAGE_KEY, JSON.stringify(model));
}

let model = load();

function render(){
  clientNameEl.value = model.clientName || "";
  quoteDateEl.value = model.date || todayISO();
  rowsEl.innerHTML = "";

  const isMobile = window.matchMedia && window.matchMedia('(max-width: 600px)').matches;
  const rowsMobile = document.getElementById('rowsMobile');
  if(rowsMobile) rowsMobile.innerHTML = "";

  model.rows.forEach((r, idx) => {
    // =====================
    // iPhone: layout a barra unica
    // =====================
    if(isMobile && rowsMobile){
      const wrap = document.createElement('div');
      wrap.className = 'pv-row';

      const desc = document.createElement('input');
      desc.className = 'pv-desc';
      desc.placeholder = 'Descrizione prodotto';
      desc.value = r.desc || '';
      desc.addEventListener('input', () => {
        model.rows[idx].desc = desc.value;
        autoSave();
      });

      const line = document.createElement('div');
      line.className = 'pv-line';

      const qty = document.createElement('input');
      qty.className = 'pv-mini';
      qty.type = 'number';
      qty.min = '0';
      qty.step = '1';
      qty.value = r.qty ?? 1;
      qty.addEventListener('input', () => {
        model.rows[idx].qty = parseNum(qty.value);
        updateTotals();
        autoSave();
      });

      const price = document.createElement('input');
      price.className = 'pv-mini';
      price.type = 'number';
      price.min = '0';
      price.step = '0.01';
      price.value = r.price ?? 0;
      price.addEventListener('input', () => {
        model.rows[idx].price = parseNum(price.value);
        updateTotals();
        autoSave();
      });

      const total = document.createElement('div');
      total.className = 'pv-total';
      total.dataset.role = 'rowTotalMobile';
      total.dataset.idx = String(idx);

      const del = document.createElement('button');
      del.className = 'danger pv-del';
      del.type = 'button';
      del.textContent = '✕';
      del.title = 'Rimuovi';
      bindTap(del, async () => {
        model.rows.splice(idx, 1);
        if (!model.rows.length) model.rows.push({ desc:"", qty:1, price:0 });
        render();
        autoSave();
      });

      line.appendChild(qty);
      line.appendChild(price);
      line.appendChild(total);
      line.appendChild(del);

      wrap.appendChild(desc);
      wrap.appendChild(line);
      rowsMobile.appendChild(wrap);
      return;
    }

    const tr = document.createElement("tr");

    const tdDesc = document.createElement("td");
    tdDesc.setAttribute("data-label", "Descrizione prodotto");
    const desc = document.createElement("input");
    desc.placeholder = "Es: Shampoo 10L";
    desc.value = r.desc || "";
    desc.addEventListener("input", () => {
      model.rows[idx].desc = desc.value;
      autoSave();
    });
    tdDesc.appendChild(desc);

    const tdQty = document.createElement("td");
    tdQty.setAttribute("data-label", "Quantità");
    const qty = document.createElement("input");
    qty.type = "number";
    qty.min = "0";
    qty.step = "1";
    qty.value = r.qty ?? 1;
    qty.addEventListener("input", () => {
      model.rows[idx].qty = parseNum(qty.value);
      updateTotals();
      autoSave();
    });
    tdQty.appendChild(qty);

    const tdPrice = document.createElement("td");
    tdPrice.setAttribute("data-label", "Costo (€)");
    const price = document.createElement("input");
    price.type = "number";
    price.min = "0";
    price.step = "0.01";
    price.value = r.price ?? 0;
    price.addEventListener("input", () => {
      model.rows[idx].price = parseNum(price.value);
      updateTotals();
      autoSave();
    });
    tdPrice.appendChild(price);

    const tdTot = document.createElement("td");
    tdTot.setAttribute("data-label", "Totale (€)");
    tdTot.style.fontWeight = "900";
    tdTot.dataset.role = "rowTotal";
    tdTot.dataset.idx = String(idx);

    const tdDel = document.createElement("td");
    tdDel.setAttribute("data-label", "");
    const del = document.createElement("button");
    del.className = "danger";
    del.textContent = "✕";
    del.title = "Rimuovi";
    bindTap(del, async () => {
      model.rows.splice(idx, 1);
      if (!model.rows.length) model.rows.push({ desc:"", qty:1, price:0 });
      render();
      autoSave();
    });
    tdDel.appendChild(del);

    tr.appendChild(tdDesc);
    tr.appendChild(tdQty);
    tr.appendChild(tdPrice);
    tr.appendChild(tdTot);
    tr.appendChild(tdDel);

    rowsEl.appendChild(tr);
  });

  updateTotals();
}

// installa subito il fix hard-tap (prima che l'utente tocchi)
installIOSHardTapFix([addRowBtn, saveBtn, resetBtn, shareWhatsBtn, exportPdfBtn, exportImgBtn]);

function getGrandTotalNumber(m){
  let total = 0;
  (m.rows || []).forEach(r => { total += parseNum(r.qty) * parseNum(r.price); });
  return Number(total || 0);
}

function updateTotals(){
  let total = 0;
  model.rows.forEach((r, idx) => {
    const rowTot = parseNum(r.qty) * parseNum(r.price);
    total += rowTot;
    const td = rowsEl.querySelector(`td[data-role="rowTotal"][data-idx="${idx}"]`);
    if (td) td.textContent = `${euro(rowTot)} €`;
    const div = document.querySelector(`div[data-role="rowTotalMobile"][data-idx="${idx}"]`);
    if (div) div.textContent = `${euro(rowTot)} €`;
  });
  grandTotalEl.textContent = `${euro(total)} €`;
}

let saveTimer = null;
function autoSave(){
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    model.clientName = clientNameEl.value;
    model.date = quoteDateEl.value;
    save(model);
  }, 150);
}

bindTap(addRowBtn, async () => {
  model.rows.push({ desc:"", qty:1, price:0 });
  render();
  autoSave();
});

bindTap(saveBtn, async () => {
  model.clientName = clientNameEl.value;
  model.date = quoteDateEl.value;
  save(model); // salva bozza locale

  try{
    await savePreventivoToFirestore(model);
    await loadHistory();
    alert("Preventivo salvato nello storico.");
  }catch(err){
    console.error(err);
    alert("Errore salvataggio preventivo. Controlla la connessione.");
  }
});

bindTap(resetBtn, async () => {
  if (!confirm("Vuoi svuotare il preventivo?")) return;
  model = defaultModel();
  save(model);
  render();
});

clientNameEl.addEventListener("input", autoSave);
quoteDateEl.addEventListener("change", autoSave);

async function nextPreventivoNumber(){
  const counterRef = doc(db, COUNTER_DOC.col, COUNTER_DOC.id);
  let number = 1;
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(counterRef);
    let next = 1;
    if (snap.exists()){
      const d = snap.data() || {};
      next = Number(d.next || 1);
    }
    number = next;
    tx.set(counterRef, { next: next + 1 }, { merge: true });
  });
  return number;
}

async function savePreventivoToFirestore(m){
  const number = await nextPreventivoNumber();
  const payload = {
    number,
    numberLabel: formatPrevNum(number),
    clientName: String(m.clientName || "").trim(),
    date: String(m.date || todayISO()),
    rows: (m.rows || []).map(r => ({
      desc: String(r.desc || "").trim(),
      qty: Number(r.qty || 0),
      price: Number(r.price || 0),
      total: Number((Number(r.qty||0) * Number(r.price||0)) || 0),
    })),
    total: getGrandTotalNumber(m),
    createdAt: serverTimestamp(),
  };
  const ref = await addDoc(collection(db, PREVENTIVI_COLLECTION), payload);
  return ref.id;
}

async function loadHistory(){
  if (!historyBodyEl) return;
  historyBodyEl.innerHTML = `<tr><td colspan="5" class="muted">Caricamento...</td></tr>`;
  try{
    const qy = query(collection(db, PREVENTIVI_COLLECTION), orderBy("createdAt","desc"), limit(200));
    const snap = await getDocs(qy);
    if (snap.empty){
      historyBodyEl.innerHTML = `<tr><td colspan="5" class="muted">Nessun preventivo salvato.</td></tr>`;
      return;
    }
    const allRows = [];
    snap.forEach(docu => {
      const d = docu.data() || {};
      const num = d.numberLabel || formatPrevNum(d.number);
      const date = d.date || "";
      const client = d.clientName || "";
      const tot = Number(d.total || 0);
      allRows.push({ id: docu.id, num, date, client, tot });
    });

    const searchEl = document.getElementById("historySearch");
    const term = (searchEl?.value || "").toLowerCase().trim();
    const rows = term ? allRows.filter(r => r.client.toLowerCase().includes(term)) : allRows;

    if(rows.length === 0){
      historyBodyEl.innerHTML = `<tr><td colspan="5" class="muted">Nessun preventivo trovato.</td></tr>`;
      return;
    }

    historyBodyEl.innerHTML = rows.map(r => `
      <tr>
        <td>${r.num}</td>
        <td>${r.date}</td>
        <td>${escapeHtml(r.client)}</td>
        <td style="text-align:right">${euro(r.tot)} €</td>
        <td>
          <button class="btn small" data-act="open" data-id="${r.id}">Apri</button>
          <button class="btn small" data-act="pdf" data-id="${r.id}">PDF</button>
          <button class="btn small" data-act="wa" data-id="${r.id}">WhatsApp</button>
          <button class="btn small danger" data-act="del" data-id="${r.id}">Elimina</button>
        </td>
      </tr>
    `).join("");

  }catch(err){
    console.error(err);
    historyBodyEl.innerHTML = `<tr><td colspan="5" class="muted">Errore caricamento storico.</td></tr>`;
  }
}

function escapeHtml(s){
  return String(s||"").replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
}

async function getPreventivo(id){
  const ref = doc(db, PREVENTIVI_COLLECTION, id);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error("Preventivo non trovato");
  return { id: snap.id, ...(snap.data()||{}) };
}

async function openPreventivo(id){
  const p = await getPreventivo(id);
  model.clientName = p.clientName || "";
  model.date = p.date || todayISO();
  model.rows = Array.isArray(p.rows) && p.rows.length ? p.rows.map(r=>({ desc:r.desc||"", qty:Number(r.qty||1), price:Number(r.price||0)})) : defaultModel().rows;
  save(model);
  render();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function deletePreventivoForever(id){
  if (!confirm("Eliminare definitivamente questo preventivo?")) return;
  await deleteDoc(doc(db, PREVENTIVI_COLLECTION, id));
  await loadHistory();
}

async function exportPreventivoPdfById(id){
  await openPreventivo(id);
  // usa le funzioni esistenti (PDF/Share) basate sul model corrente
  exportPdfBtn.click();
}

async function sharePreventivoWhatsAppById(id){
  await openPreventivo(id);
  shareWhatsBtn.click();
}

if (historyBodyEl){
  historyBodyEl.addEventListener("click", async (e)=>{
    const btn = e.target.closest("button[data-act]");
    if (!btn) return;
    const act = btn.dataset.act;
    const id = btn.dataset.id;
    try{
      if (act === "open") await openPreventivo(id);
      else if (act === "del") await deletePreventivoForever(id);
      else if (act === "pdf") await exportPreventivoPdfById(id);
      else if (act === "wa") await sharePreventivoWhatsAppById(id);
    }catch(err){
      console.error(err);
      alert("Operazione non riuscita.");
    }
  });
}

// History search filter
const historySearchEl = document.getElementById("historySearch");
if(historySearchEl){
  let _historyDebounce;
  historySearchEl.addEventListener("input", ()=>{
    clearTimeout(_historyDebounce);
    _historyDebounce = setTimeout(loadHistory, 200);
  });
}

// --------- Ricevuta (HTML) per export ---------
async function buildReceiptElement(){
  const wrap = document.createElement("div");
  wrap.style.cssText = "width:720px;background:#fff;padding:24px;font-family:Arial;border:1px solid rgba(0,0,0,.12);";
  const logoUrl = "./img/logo.png";

  const header = document.createElement("div");
  header.style.cssText = "display:flex;align-items:center;gap:14px;margin-bottom:12px;";
  header.innerHTML = `
    <img src="${logoUrl}" style="height:80px;width:auto;object-fit:contain" />
    <div>
      <div style="font-size:18px;font-weight:900">DCR GROUP</div>
      <div style="font-size:12px;opacity:.85">di Di Caro Luca • +39 3337377008</div>
      <div style="margin-top:6px;font-size:22px;font-weight:900">PREVENTIVO</div>
      <div style="font-size:13px;opacity:.8">Cliente: <strong>${escapeHtml(model.clientName||"")}</strong> — Data: <strong>${escapeHtml(model.date||"")}</strong></div>
    </div>
  `;

  const table = document.createElement("table");
  table.style.cssText = "width:100%;border-collapse:collapse;margin-top:10px;font-size:14px";
  table.innerHTML = `
    <thead>
      <tr>
        <th style="text-align:left;border-bottom:2px solid #111;padding:8px">Descrizione</th>
        <th style="text-align:right;border-bottom:2px solid #111;padding:8px">Q.tà</th>
        <th style="text-align:right;border-bottom:2px solid #111;padding:8px">Prezzo</th>
        <th style="text-align:right;border-bottom:2px solid #111;padding:8px">Totale</th>
      </tr>
    </thead>
    <tbody></tbody>
  `;
  const tbody = table.querySelector("tbody");

  let tot = 0;
  model.rows.forEach((r) => {
    if (!String(r.desc || "").trim()) return;
    const qty = parseNum(r.qty);
    const price = parseNum(r.price);
    const rowTot = qty * price;
    tot += rowTot;
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td style="padding:8px;border-bottom:1px solid rgba(0,0,0,.12)">${escapeHtml(r.desc || "")}</td>
      <td style="padding:8px;border-bottom:1px solid rgba(0,0,0,.12);text-align:right">${euro(qty)}</td>
      <td style="padding:8px;border-bottom:1px solid rgba(0,0,0,.12);text-align:right">${euro(price)} €</td>
      <td style="padding:8px;border-bottom:1px solid rgba(0,0,0,.12);text-align:right;font-weight:900">${euro(rowTot)} €</td>
    `;
    tbody.appendChild(tr);
  });

  const footer = document.createElement("div");
  footer.style.cssText = "margin-top:12px;display:flex;justify-content:flex-end";
  footer.innerHTML = `<div style="font-size:18px;font-weight:900">Totale: ${euro(tot)} €</div>`;

  wrap.appendChild(header);
  wrap.appendChild(table);
  wrap.appendChild(footer);

  // IMPORTANTISSIMO: deve essere nel DOM per permettere a html2canvas di renderizzare le immagini.
  wrap.style.position = "fixed";
  wrap.style.left = "-99999px";
  wrap.style.top = "0";
  document.body.appendChild(wrap);

  // aspetta che il logo venga caricato
  await waitForImages(wrap);
  return wrap;
}

// NOTE: escapeHtml è già definita più sopra.
// Una doppia dichiarazione blocca tutto lo script (e quindi i pulsanti non funzionano).
// Manteniamo una sola definizione per evitare l'errore:
// "Identifier 'escapeHtml' has already been declared".

function waitForImages(root){
  const imgs = [...root.querySelectorAll("img")];
  return Promise.all(imgs.map(img => new Promise(res => {
    if (img.complete) return res();
    img.onload = () => res();
    img.onerror = () => res();
  })));
}

async function receiptToPng(){
  const el = await buildReceiptElement();
  try {
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    const canvas = await html2canvas(el, {
      scale: isIOS ? 1.5 : 2,
      useCORS: true,
      backgroundColor: "#ffffff"
    });

    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    if (blob) return blob;

    // Fallback (Safari a volte ritorna null da toBlob)
    const dataUrl = canvas.toDataURL("image/png");
    const resp = await fetch(dataUrl);
    return await resp.blob();
  } finally {
    el.remove();
  }
}

async function receiptToPdfBlob(){
  const pngBlob = await receiptToPng();
  const arrayBuf = await pngBlob.arrayBuffer();
  const uint8 = new Uint8Array(arrayBuf);
  // Convertiamo blob->dataURL
  const dataUrl = await new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.readAsDataURL(new Blob([uint8], { type: "image/png" }));
  });

  if (!window.jspdf || !window.jspdf.jsPDF) {
    throw new Error("jsPDF non caricato");
  }
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({ orientation: "p", unit: "pt", format: "a4" });
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();

  // Inseriamo l'immagine mantenendo le proporzioni
  const imgProps = pdf.getImageProperties(dataUrl);
  const ratio = Math.min(pageW / imgProps.width, pageH / imgProps.height);
  const w = imgProps.width * ratio;
  const h = imgProps.height * ratio;
  const x = (pageW - w) / 2;
  const y = 36;

  pdf.addImage(dataUrl, "PNG", x, y, w, h);
  return pdf.output("blob");
}

async function shareBlob(blob, filename){
  const file = new File([blob], filename, { type: blob.type || "application/octet-stream" });

  if (navigator.share && (!navigator.canShare || navigator.canShare({ files: [file] }))) {
    await navigator.share({ files: [file], title: filename });
    return;
  }

  // fallback download
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function shareWhatsText(){
  // WhatsApp non accetta allegati via URL. Usiamo Web Share su iPhone, o in alternativa testo.
  const txt = `PREVENTIVO\nCliente: ${clientNameEl.value || "-"}\nData: ${quoteDateEl.value || "-"}\nTotale: ${grandTotalEl.textContent}`;
  const wa = `https://api.whatsapp.com/send?text=${encodeURIComponent(txt)}`;
  window.open(wa, "_blank");
}

bindTap(shareWhatsBtn, async () => {
  try {
    const img = await receiptToPng();
    // Proviamo a condividere l'immagine (iOS: scegliere WhatsApp dalla condivisione)
    await shareBlob(img, "preventivo.png");
  } catch (e) {
    console.error(e);
    // fallback testo
    await shareWhatsText();
  }
});

bindTap(exportImgBtn, async () => {
  try {
    const img = await receiptToPng();
    await shareBlob(img, "preventivo.png");
  } catch (e) {
    console.error(e);
    alert("Errore generazione immagine");
  }
});

bindTap(exportPdfBtn, async () => {
  try {
    const pdf = await receiptToPdfBlob();
    await shareBlob(pdf, "preventivo.pdf");
  } catch (e) {
    console.error(e);
    alert("Errore generazione PDF");
  }
});

// Init
render();
loadHistory();