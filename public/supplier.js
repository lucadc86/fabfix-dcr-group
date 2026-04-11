import { db } from "./firebase.js";
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  addDoc,
  deleteDoc,
  collection,
  getDocs,
  query,
  orderBy
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import {
  getStorage,
  ref as storageRef,
  uploadBytes,
  getDownloadURL
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js";

const storage = getStorage();

const params = new URLSearchParams(window.location.search);
let supplierId = params.get("supplierId") || null;

/* ── DOM refs ─────────────────────────────────────────── */
const supplierNameTitle = document.getElementById("supplierNameTitle");
const supplierVatBadge  = document.getElementById("supplierVatBadge");
const nameInput   = document.getElementById("name");
const emailInput  = document.getElementById("email");
const phoneInput  = document.getElementById("phone");
const cityInput   = document.getElementById("city");
const vatInput    = document.getElementById("vat");
const saveSupplierBtn = document.getElementById("saveSupplier");

const statFattureAnno = document.getElementById("statFattureAnno");
const statTotaleAnno  = document.getElementById("statTotaleAnno");
const statDaPagare    = document.getElementById("statDaPagare");
const statScadute     = document.getElementById("statScadute");

const urgentBlock  = document.getElementById("urgentBlock");
const urgentList   = document.getElementById("urgentList");

const addInvoiceBtn    = document.getElementById("addInvoiceBtn");
const invoiceForm      = document.getElementById("invoiceForm");
const saveInvoiceBtn   = document.getElementById("saveInvoiceBtn");
const cancelInvoiceBtn = document.getElementById("cancelInvoiceBtn");
const uploadProgress   = document.getElementById("uploadProgress");
const currentPhotoHint = document.getElementById("currentPhotoHint");

const invoiceNumeroInput    = document.getElementById("invoiceNumero");
const invoiceDateInput      = document.getElementById("invoiceDate");
const invoiceScadenzaInput  = document.getElementById("invoiceScadenza");
const invoiceImponibileInput= document.getElementById("invoiceImponibile");
const invoiceIvaInput       = document.getElementById("invoiceIva");
const invoiceAmountInput    = document.getElementById("invoiceAmount");
const invoiceDescrizioneInput = document.getElementById("invoiceDescrizione");
const invCategoriaInput     = document.getElementById("invoiceCategoria");
const invoiceStatoInput     = document.getElementById("invoiceStato");
const invoiceNoteInput      = document.getElementById("invoiceNote");
const invoicePhotoInput     = document.getElementById("invoicePhoto");

const searchInvoiceInput    = document.getElementById("searchInvoice");
const filterTabsEl          = document.getElementById("filterTabs");
const invoiceTableBody      = document.getElementById("invoiceTableBody");
const emptyMsg              = document.getElementById("emptyMsg");

const photoModal     = document.getElementById("photoModal");
const closePhotoModal= document.getElementById("closePhotoModal");
const closePhotoModalBtn = document.getElementById("closePhotoModalBtn");
const photoModalImg  = document.getElementById("photoModalImg");
const photoModalPdf  = document.getElementById("photoModalPdf");

let editingInvoiceId = null;
let editingFotoUrl   = null;
let allInvoices      = [];
let activeFilter     = "all";
let searchQuery      = "";

/* ── Helpers ──────────────────────────────────────────── */
const MS_PER_DAY = 86400000;

function eur(n){
  return new Intl.NumberFormat("it-IT",{style:"currency",currency:"EUR"}).format(Number(n)||0);
}

function todayISO(){
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

function effectiveStatus(inv){
  if(inv.stato === "pagata") return "pagata";
  const today = todayISO();
  const scad = inv.scadenza || "";
  if(!scad) return "da_pagare";
  if(scad < today) return "scaduta";
  // entro 7 giorni
  const d = new Date(scad);
  const diff = (d - new Date(today)) / MS_PER_DAY;
  if(diff <= 7) return "in_scadenza";
  return "da_pagare";
}

function statusLabel(s){
  return {da_pagare:"Da pagare", in_scadenza:"In scadenza", scaduta:"Scaduta", pagata:"Pagata"}[s] || s;
}

/* ── Auto-calc totale ─────────────────────────────────── */
function recalcTotal(){
  const imponibile = parseFloat(invoiceImponibileInput.value) || 0;
  const iva = parseFloat(invoiceIvaInput.value) || 0;
  invoiceAmountInput.value = (imponibile * (1 + iva / 100)).toFixed(2);
}
invoiceImponibileInput?.addEventListener("input", recalcTotal);
invoiceIvaInput?.addEventListener("input", recalcTotal);

/* ── Supplier load/save ───────────────────────────────── */
async function loadSupplier(){
  if(!supplierId){
    supplierNameTitle.textContent = "Nuovo fornitore";
    return;
  }
  const snap = await getDoc(doc(db, "suppliers", supplierId));
  if(!snap.exists()){ supplierNameTitle.textContent = "Fornitore"; return; }
  const s = snap.data();
  supplierNameTitle.textContent = (s.name || "Fornitore").toUpperCase();
  if(supplierVatBadge && s.vat) supplierVatBadge.textContent = `P.IVA ${s.vat}`;
  nameInput.value  = s.name  || "";
  emailInput.value = s.email || "";
  phoneInput.value = s.phone || "";
  cityInput.value  = s.city  || "";
  vatInput.value   = s.vat   || "";
}

saveSupplierBtn.addEventListener("click", async () => {
  const data = {
    name:  nameInput.value.trim(),
    email: emailInput.value.trim(),
    phone: phoneInput.value.trim(),
    city:  cityInput.value.trim(),
    vat:   vatInput.value.trim()
  };
  if(!data.name){ alert("Inserisci nome fornitore"); return; }
  if(supplierId){
    await updateDoc(doc(db,"suppliers",supplierId), data);
    supplierNameTitle.textContent = data.name.toUpperCase();
    if(supplierVatBadge) supplierVatBadge.textContent = data.vat ? `P.IVA ${data.vat}` : "";
    alert("Fornitore aggiornato");
  } else {
    const ref = await addDoc(collection(db,"suppliers"),{...data,total:0});
    supplierId = ref.id;
    window.location.href = `supplier.html?supplierId=${encodeURIComponent(supplierId)}`;
  }
});

function requireSupplierSaved(){
  if(!supplierId){ alert("Prima salva il fornitore, poi puoi aggiungere le fatture."); return false; }
  return true;
}

/* ── Invoice form open/close ──────────────────────────── */
function setFormVisible(visible){
  invoiceForm.classList.toggle("hidden", !visible);
}

function resetForm(){
  editingInvoiceId = null;
  editingFotoUrl   = null;
  invoiceNumeroInput.value    = "";
  invoiceDateInput.value      = todayISO();
  invoiceScadenzaInput.value  = "";
  invoiceImponibileInput.value= "";
  invoiceIvaInput.value       = "22";
  invoiceAmountInput.value    = "";
  invoiceDescrizioneInput.value = "";
  invCategoriaInput.value     = "";
  invoiceStatoInput.value     = "da_pagare";
  invoiceNoteInput.value      = "";
  invoicePhotoInput.value     = "";
  currentPhotoHint.classList.add("hidden");
  uploadProgress.classList.add("hidden");
}

addInvoiceBtn?.addEventListener("click", () => {
  if(!requireSupplierSaved()) return;
  resetForm();
  setFormVisible(true);
  invoiceForm.scrollIntoView({behavior:"smooth",block:"start"});
});

cancelInvoiceBtn?.addEventListener("click", () => {
  setFormVisible(false);
  resetForm();
});

/* ── Save invoice ─────────────────────────────────────── */
saveInvoiceBtn?.addEventListener("click", async () => {
  if(!requireSupplierSaved()) return;

  const date      = invoiceDateInput.value;
  const imponibile= parseFloat(invoiceImponibileInput.value) || 0;
  const iva       = parseFloat(invoiceIvaInput.value) || 0;
  const amount    = parseFloat(invoiceAmountInput.value) || (imponibile * (1 + iva / 100));

  if(!date){ alert("Inserisci la data fattura"); return; }
  if(!(amount > 0)){ alert("Inserisci importo valido"); return; }

  let fotoUrl = editingFotoUrl || null;

  const file = invoicePhotoInput.files?.[0];
  if(file){
    if(file.size > 10 * 1024 * 1024){ alert("File troppo grande. Massimo 10 MB."); return; }
    uploadProgress.classList.remove("hidden");
    try {
      const path = `suppliers/${supplierId}/invoices/${Date.now()}_${file.name}`;
      const sref = storageRef(storage, path);
      await uploadBytes(sref, file);
      fotoUrl = await getDownloadURL(sref);
    } catch(e){
      console.error("Upload foto fallito:", e);
      alert("Errore caricamento foto: " + e.message);
      uploadProgress.classList.add("hidden");
      return;
    }
    uploadProgress.classList.add("hidden");
  }

  const data = {
    numero:      invoiceNumeroInput.value.trim(),
    date,
    scadenza:    invoiceScadenzaInput.value || "",
    imponibile,
    iva,
    amount:      parseFloat(amount.toFixed(2)),
    descrizione: invoiceDescrizioneInput.value.trim(),
    categoria:   invCategoriaInput.value,
    stato:       invoiceStatoInput.value,
    note:        invoiceNoteInput.value.trim(),
    fotoUrl
  };

  const ref = collection(db,"suppliers",supplierId,"invoices");
  if(editingInvoiceId){
    await updateDoc(doc(ref, editingInvoiceId), data);
  } else {
    await addDoc(ref, data);
  }

  setFormVisible(false);
  resetForm();
  await loadInvoices();
});

/* ── Load & render invoices ───────────────────────────── */
async function loadInvoices(){
  if(!supplierId){ updateStats([]); return; }

  const ref = collection(db,"suppliers",supplierId,"invoices");
  const q   = query(ref, orderBy("date","desc"));
  const snap= await getDocs(q);

  allInvoices = [];
  snap.forEach(d => allInvoices.push({id:d.id,...d.data()}));

  updateStats(allInvoices);
  renderUrgent(allInvoices);
  renderTable(allInvoices);

  // aggiorna totale sul documento fornitore
  const total = allInvoices.reduce((s,i)=>s+(Number(i.amount)||0),0);
  if(supplierId) await updateDoc(doc(db,"suppliers",supplierId),{total});
}

function updateStats(invoices){
  const year = new Date().getFullYear();
  const thisYear = invoices.filter(i=>(i.date||"").startsWith(String(year)));
  statFattureAnno.textContent = thisYear.length;
  statTotaleAnno.textContent  = eur(thisYear.reduce((s,i)=>s+(Number(i.amount)||0),0));

  const unpaid = invoices.filter(i=>effectiveStatus(i)!=="pagata");
  statDaPagare.textContent = eur(unpaid.reduce((s,i)=>s+(Number(i.amount)||0),0));

  const scadute = invoices.filter(i=>effectiveStatus(i)==="scaduta");
  statScadute.textContent = scadute.length;
}

function renderUrgent(invoices){
  const urgent = invoices.filter(i=>{ const s=effectiveStatus(i); return s==="scaduta"||s==="in_scadenza"; });
  if(!urgent.length){ urgentBlock.classList.add("hidden"); return; }
  urgentBlock.classList.remove("hidden");
  urgentList.innerHTML = urgent.map(inv=>{
    const s = effectiveStatus(inv);
    return `<div class="urgent-row">
      <span class="urgent-num">${inv.numero||"—"}</span>
      <span class="urgent-desc">${inv.descrizione||""}</span>
      <span class="urgent-scad">${s==="scaduta"?"⛔ Scaduta il":"⚠️ Scade il"} ${inv.scadenza||"—"}</span>
      <span>${eur(inv.amount)}</span>
    </div>`;
  }).join("");
}

function filterInvoices(invoices){
  let list = invoices;
  if(activeFilter !== "all"){
    list = list.filter(i=>effectiveStatus(i)===activeFilter);
  }
  if(searchQuery){
    const q = searchQuery.toLowerCase();
    list = list.filter(i=>
      (i.numero||"").toLowerCase().includes(q) ||
      (i.descrizione||"").toLowerCase().includes(q) ||
      (i.date||"").includes(q)
    );
  }
  return list;
}

function renderTable(invoices){
  const filtered = filterInvoices(invoices);
  invoiceTableBody.innerHTML = "";
  if(!filtered.length){
    emptyMsg.classList.remove("hidden");
    return;
  }
  emptyMsg.classList.add("hidden");

  filtered.forEach(inv=>{
    const status = effectiveStatus(inv);
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td data-label="N° Fattura"><strong>${inv.numero||"—"}</strong></td>
      <td data-label="Descrizione">${inv.descrizione||"—"}</td>
      <td data-label="Data">${inv.date||"—"}</td>
      <td data-label="Scadenza">${inv.scadenza||"—"}</td>
      <td data-label="Importo"><strong>${eur(inv.amount)}</strong></td>
      <td data-label="Stato"><span class="status-badge ${status}">${statusLabel(status)}</span></td>
      <td data-label="Azioni">
        <div class="inv-actions">
          ${inv.fotoUrl ? `<button class="icon-btn view-photo-btn" title="Vedi foto">📎</button>` : ""}
          ${status !== "pagata" ? `<button class="icon-btn pay-btn" title="Segna come pagata">✅ Pagata</button>` : ""}
          <button class="icon-btn edit-btn" title="Modifica">✏️</button>
          <button class="icon-btn delete-btn" title="Elimina">🗑️</button>
        </div>
      </td>
    `;

    tr.querySelector(".edit-btn")?.addEventListener("click", (e)=>{
      e.stopPropagation();
      startEdit(inv);
    });

    tr.querySelector(".delete-btn")?.addEventListener("click", async (e)=>{
      e.stopPropagation();
      if(!confirm("Eliminare fattura?")) return;
      await deleteDoc(doc(collection(db,"suppliers",supplierId,"invoices"), inv.id));
      await loadInvoices();
    });

    tr.querySelector(".pay-btn")?.addEventListener("click", async (e)=>{
      e.stopPropagation();
      if(!confirm("Segna come pagata?")) return;
      await updateDoc(doc(collection(db,"suppliers",supplierId,"invoices"), inv.id),{stato:"pagata"});
      await loadInvoices();
    });

    tr.querySelector(".view-photo-btn")?.addEventListener("click", (e)=>{
      e.stopPropagation();
      openPhotoModal(inv.fotoUrl);
    });

    invoiceTableBody.appendChild(tr);
  });
}

function startEdit(inv){
  editingInvoiceId = inv.id;
  editingFotoUrl   = inv.fotoUrl || null;
  invoiceNumeroInput.value    = inv.numero    || "";
  invoiceDateInput.value      = inv.date      || todayISO();
  invoiceScadenzaInput.value  = inv.scadenza  || "";
  invoiceImponibileInput.value= inv.imponibile ?? "";
  invoiceIvaInput.value       = inv.iva       ?? "22";
  invoiceAmountInput.value    = inv.amount    != null ? Number(inv.amount).toFixed(2) : "";
  invoiceDescrizioneInput.value = inv.descrizione || "";
  invCategoriaInput.value     = inv.categoria || "";
  invoiceStatoInput.value     = inv.stato     || "da_pagare";
  invoiceNoteInput.value      = inv.note      || "";
  invoicePhotoInput.value     = "";
  currentPhotoHint.classList.toggle("hidden", !editingFotoUrl);
  setFormVisible(true);
  invoiceForm.scrollIntoView({behavior:"smooth",block:"start"});
}

/* ── Filters ──────────────────────────────────────────── */
filterTabsEl?.addEventListener("click", (e)=>{
  const tab = e.target.closest(".filter-tab");
  if(!tab) return;
  filterTabsEl.querySelectorAll(".filter-tab").forEach(t=>t.classList.remove("active"));
  tab.classList.add("active");
  activeFilter = tab.dataset.filter;
  renderTable(allInvoices);
});

searchInvoiceInput?.addEventListener("input", ()=>{
  searchQuery = searchInvoiceInput.value.trim();
  renderTable(allInvoices);
});

/* ── Photo modal ──────────────────────────────────────── */
function openPhotoModal(url){
  if(!url) return;
  const isPdf = url.toLowerCase().includes(".pdf") || (url.includes("%2F") && url.toLowerCase().includes("pdf"));
  photoModalImg.classList.add("hidden");
  photoModalPdf.classList.add("hidden");
  if(isPdf){
    photoModalPdf.src = url;
    photoModalPdf.classList.remove("hidden");
  } else {
    photoModalImg.src = url;
    photoModalImg.classList.remove("hidden");
  }
  photoModal.classList.remove("hidden");
}

function closeModal(){
  photoModal.classList.add("hidden");
  photoModalImg.src = "";
  photoModalPdf.src = "";
}

closePhotoModal?.addEventListener("click", closeModal);
closePhotoModalBtn?.addEventListener("click", closeModal);

/* ── Init ─────────────────────────────────────────────── */
await loadSupplier();
await loadInvoices();
