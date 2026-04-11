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
  orderBy,
  writeBatch
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import {
  getStorage,
  ref as storageRef,
  uploadBytes,
  getDownloadURL,
  deleteObject
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js";

const params = new URLSearchParams(window.location.search);
let supplierId = params.get("supplierId") || null;

// ── DOM refs ─────────────────────────────────────────
const supplierNameTitle   = document.getElementById("supplierNameTitle");
const supplierVatBadge    = document.getElementById("supplierVatBadge");
const nameInput           = document.getElementById("name");
const emailInput          = document.getElementById("email");
const phoneInput          = document.getElementById("phone");
const cityInput           = document.getElementById("city");
const vatInput            = document.getElementById("vat");
const supplierCategory    = document.getElementById("supplierCategory");
const saveSupplierBtn     = document.getElementById("saveSupplier");
const toggleSupplierFormBtn = document.getElementById("toggleSupplierFormBtn");
const supplierFormCard    = document.getElementById("supplierFormCard");

const invStatsGrid        = document.getElementById("invStatsGrid");
const statCountYear       = document.getElementById("statCountYear");
const statTotalYear       = document.getElementById("statTotalYear");
const statDaPagare        = document.getElementById("statDaPagare");
const statScadute         = document.getElementById("statScadute");

const urgentSection       = document.getElementById("urgentSection");
const urgentList          = document.getElementById("urgentList");

const addInvoiceBtn       = document.getElementById("addInvoiceBtn");
const addPhotoInvoiceBtn  = document.getElementById("addPhotoInvoiceBtn");
const invoiceForm         = document.getElementById("invoiceForm");
const invoiceFormTitle    = document.getElementById("invoiceFormTitle");
const saveInvoiceBtn      = document.getElementById("saveInvoiceBtn");
const cancelInvoiceBtn    = document.getElementById("cancelInvoiceBtn");

const invoiceNumberInput  = document.getElementById("invoiceNumber");
const invoiceDateInput    = document.getElementById("invoiceDate");
const invoiceDueDateInput = document.getElementById("invoiceDueDate");
const invoiceAmountInput  = document.getElementById("invoiceAmount");
const invoiceVatInput     = document.getElementById("invoiceVat");
const invoiceTotalDisplay = document.getElementById("invoiceTotalDisplay");
const invoiceDescInput    = document.getElementById("invoiceDesc");
const invoiceCategoryInput= document.getElementById("invoiceCategory");
const invoiceStatusInput  = document.getElementById("invoiceStatus");
const invoiceNotesInput   = document.getElementById("invoiceNotes");

const photoFileInput      = document.getElementById("photoFileInput");
const triggerPhotoBtn     = document.getElementById("triggerPhotoBtn");
const photoUploadInner    = document.getElementById("photoUploadInner");
const photoPreviewInner   = document.getElementById("photoPreviewInner");
const photoPreviewImg     = document.getElementById("photoPreviewImg");
const photoPreviewName    = document.getElementById("photoPreviewName");
const removePhotoBtn      = document.getElementById("removePhotoBtn");

const invSearch           = document.getElementById("invSearch");
const filterPills         = document.querySelectorAll(".filter-pill");
const invoiceTableWrap    = document.getElementById("invoiceTableWrap");
const invoiceList         = document.getElementById("invoiceList");
const invoiceEmptyState   = document.getElementById("invoiceEmptyState");

const photoModal          = document.getElementById("photoModal");
const photoModalBackdrop  = document.getElementById("photoModalBackdrop");
const photoModalClose     = document.getElementById("photoModalClose");
const photoModalImg       = document.getElementById("photoModalImg");

const ocrOverlay          = document.getElementById("ocrOverlay");
const ordersHistorySection= document.getElementById("ordersHistorySection");
const ordersHistoryBody   = document.getElementById("ordersHistoryBody");
const toggleOrdersBtn     = document.getElementById("toggleOrdersBtn");
const markAllPaidBtn      = document.getElementById("markAllPaidBtn");
const ordersList          = document.getElementById("ordersList");
const ordersEmptyState    = document.getElementById("ordersEmptyState");

let editingInvoiceId = null;
let allInvoices = [];
let activeFilter = "all";
let photoFile = null;
let existingPhotoUrl = null;

const storage = getStorage();

// ── Helpers ───────────────────────────────────────────
function eur(n){ return new Intl.NumberFormat("it-IT",{style:"currency",currency:"EUR"}).format(Number(n)||0); }
function todayISO(){ const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; }
function formatDate(iso){ if(!iso) return "—"; const [y,m,d]=iso.split("-"); return `${d}/${m}/${y}`; }
function daysDiff(isoDate){ const t=new Date(isoDate+" 00:00:00").getTime(); return Math.round((t-Date.now())/(1000*60*60*24)); }
function invTotal(inv){ return Number(inv.total || inv.amount || 0); }

const MOBILE_BREAKPOINT = 640;

function getStatusInfo(inv){
  const s = inv.status || "da-pagare";
  if(s === "pagata") return { label:"✅ Pagata", cls:"pagata" };
  if(s === "pagata-parz") return { label:"⚡ Parz.", cls:"pagata-parz" };
  if(!inv.dueDate) return { label:"🔵 Da pagare", cls:"da-pagare" };
  const diff = daysDiff(inv.dueDate);
  if(diff < 0) return { label:"🔴 Scaduta", cls:"scaduta" };
  if(diff <= 14) return { label:"🟡 In scadenza", cls:"in-scadenza" };
  return { label:"🔵 Da pagare", cls:"da-pagare" };
}

function getDueCls(dueDate){
  if(!dueDate) return "none";
  const diff = daysDiff(dueDate);
  if(diff < 0) return "overdue";
  if(diff <= 14) return "soon";
  return "ok";
}

// ── Toggle fornitore form ─────────────────────────────
toggleSupplierFormBtn?.addEventListener("click", () => {
  const hidden = supplierFormCard.classList.toggle("hidden");
  toggleSupplierFormBtn.textContent = hidden ? "Modifica" : "Chiudi";
});

// ── Supplier CRUD ─────────────────────────────────────
async function loadSupplier(){
  if(!supplierId){
    supplierNameTitle.textContent = "Nuovo fornitore";
    if(supplierFormCard) supplierFormCard.classList.remove("hidden");
    return;
  }
  const snap = await getDoc(doc(db, "suppliers", supplierId));
  if(!snap.exists()){ supplierNameTitle.textContent = "Fornitore"; return; }
  const s = snap.data();
  supplierNameTitle.textContent = (s.name || "Fornitore").toUpperCase();
  if(supplierVatBadge) supplierVatBadge.textContent = s.vat || "";
  nameInput.value  = s.name  || "";
  emailInput.value = s.email || "";
  phoneInput.value = s.phone || "";
  cityInput.value  = s.city  || "";
  vatInput.value   = s.vat   || "";
  if(supplierCategory) supplierCategory.value = s.category || "";
  // collapse form on load if already saved
  if(supplierFormCard) supplierFormCard.classList.add("hidden");
  if(toggleSupplierFormBtn) toggleSupplierFormBtn.textContent = "Modifica";
}

saveSupplierBtn?.addEventListener("click", async () => {
  const data = {
    name:     nameInput.value.trim(),
    email:    emailInput.value.trim(),
    phone:    phoneInput.value.trim(),
    city:     cityInput.value.trim(),
    vat:      vatInput.value.trim(),
    category: supplierCategory?.value || ""
  };
  if(!data.name){ alert("Inserisci nome fornitore"); return; }
  if(supplierId){
    await updateDoc(doc(db, "suppliers", supplierId), data);
    supplierNameTitle.textContent = data.name.toUpperCase();
    if(supplierVatBadge) supplierVatBadge.textContent = data.vat;
    if(supplierFormCard) supplierFormCard.classList.add("hidden");
    if(toggleSupplierFormBtn) toggleSupplierFormBtn.textContent = "Modifica";
  } else {
    const ref = await addDoc(collection(db, "suppliers"), { ...data, total: 0 });
    supplierId = ref.id;
    window.location.href = `supplier.html?supplierId=${encodeURIComponent(supplierId)}`;
  }
});

// ── Photo upload logic ────────────────────────────────
triggerPhotoBtn?.addEventListener("click", () => photoFileInput?.click());
removePhotoBtn?.addEventListener("click", () => {
  photoFile = null;
  existingPhotoUrl = null;
  photoFileInput.value = "";
  photoUploadInner?.classList.remove("hidden");
  photoPreviewInner?.classList.add("hidden");
});

photoFileInput?.addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  if(!file) return;
  // Enforce 10 MB limit
  if(file.size > 10 * 1024 * 1024){ alert("File troppo grande. Dimensione massima consentita: 10 MB."); photoFileInput.value = ""; return; }
  photoFile = file;
  photoPreviewName.textContent = file.name;
  if(file.type.startsWith("image/")){
    const reader = new FileReader();
    reader.onload = (ev) => { photoPreviewImg.src = ev.target.result; };
    reader.readAsDataURL(file);
  } else {
    photoPreviewImg.src = "";
    photoPreviewImg.alt = "PDF allegato";
  }
  photoUploadInner?.classList.add("hidden");
  photoPreviewInner?.classList.remove("hidden");

  // Auto-fill form via OCR only for images
  if(file.type.startsWith("image/")){
    await runOcrAutoFill(file);
  }
});

// ── OCR auto-fill ─────────────────────────────────────
async function runOcrAutoFill(file){
  if(ocrOverlay) ocrOverlay.classList.remove("hidden");
  let fieldsFilledCount = 0;
  try {
    const base64 = await fileToBase64(file);
    const res = await fetch("/api/analyze-invoice", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ imageBase64: base64, mimeType: file.type })
    });
    if(!res.ok) throw new Error(`Risposta server non valida (${res.status}): impossibile analizzare la fattura`);
    const data = await res.json();
    if(data.invoiceNumber && !invoiceNumberInput.value)  { invoiceNumberInput.value  = data.invoiceNumber; fieldsFilledCount++; }
    if(data.date          && !invoiceDateInput.value)    { invoiceDateInput.value    = data.date; fieldsFilledCount++; }
    if(data.dueDate       && !invoiceDueDateInput.value) { invoiceDueDateInput.value = data.dueDate; fieldsFilledCount++; }
    if(data.amount != null && !(parseFloat(invoiceAmountInput.value) > 0)){
      invoiceAmountInput.value = String(data.amount);
      computeInvoiceTotal();
      fieldsFilledCount++;
    }
    if(data.vat != null){
      const vatStr = String(data.vat);
      const opt = invoiceVatInput?.querySelector(`option[value="${vatStr}"]`);
      if(opt){ invoiceVatInput.value = vatStr; computeInvoiceTotal(); fieldsFilledCount++; }
    }
    if(data.description && !invoiceDescInput.value) { invoiceDescInput.value = data.description; fieldsFilledCount++; }
    if(fieldsFilledCount === 0){
      console.warn("OCR: nessun campo riconosciuto dalla fattura.");
    }
  } catch(err){
    console.warn("OCR fallito:", err);
    alert("⚠️ Lettura automatica fattura non riuscita. Compila i campi manualmente.\n\nDettaglio: " + (err?.message || err));
  } finally {
    if(ocrOverlay) ocrOverlay.classList.add("hidden");
  }
}

function fileToBase64(file){
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      // result is "data:image/jpeg;base64,XXXX" – extract only the base64 part
      const b64 = result.split(",")[1] || "";
      resolve(b64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function uploadPhotoFile(suppId, invId){
  if(!photoFile) return existingPhotoUrl || null;
  const ext = photoFile.name.split(".").pop();
  const path = `suppliers/${suppId}/invoices/${invId}/fattura.${ext}`;
  const sRef = storageRef(storage, path);
  await uploadBytes(sRef, photoFile);
  return await getDownloadURL(sRef);
}

// ── Invoice form controls ─────────────────────────────
function computeInvoiceTotal(){
  const base = parseFloat(invoiceAmountInput?.value) || 0;
  const vat  = parseFloat(invoiceVatInput?.value) || 0;
  const total = base * (1 + vat / 100);
  if(invoiceTotalDisplay) invoiceTotalDisplay.value = total > 0 ? `€ ${total.toFixed(2).replace(".",",")}` : "";
}
invoiceAmountInput?.addEventListener("input", computeInvoiceTotal);
invoiceVatInput?.addEventListener("change", computeInvoiceTotal);

function resetForm(){
  editingInvoiceId = null;
  photoFile = null;
  existingPhotoUrl = null;
  if(invoiceFormTitle) invoiceFormTitle.textContent = "✏️ Nuova fattura fornitore";
  invoiceNumberInput.value = "";
  invoiceDateInput.value = todayISO();
  invoiceDueDateInput.value = "";
  invoiceAmountInput.value = "";
  invoiceVatInput.value = "22";
  invoiceTotalDisplay.value = "";
  invoiceDescInput.value = "";
  if(invoiceCategoryInput) invoiceCategoryInput.value = "";
  invoiceStatusInput.value = "da-pagare";
  invoiceNotesInput.value = "";
  if(photoFileInput) photoFileInput.value = "";
  photoUploadInner?.classList.remove("hidden");
  photoPreviewInner?.classList.add("hidden");
}

function openForm(scrollTo = true){
  if(!requireSupplierSaved()) return;
  invoiceForm.classList.remove("hidden");
  if(scrollTo) invoiceForm.scrollIntoView({ behavior:"smooth", block:"start" });
}

function requireSupplierSaved(){
  if(!supplierId){ alert("Prima salva il fornitore, poi puoi aggiungere le fatture."); return false; }
  return true;
}

addInvoiceBtn?.addEventListener("click", () => { resetForm(); openForm(); });
addPhotoInvoiceBtn?.addEventListener("click", () => {
  resetForm(); openForm();
  setTimeout(() => photoFileInput?.click(), 400);
});
cancelInvoiceBtn?.addEventListener("click", () => invoiceForm.classList.add("hidden"));

saveInvoiceBtn?.addEventListener("click", async () => {
  if(!requireSupplierSaved()) return;
  const date   = invoiceDateInput.value;
  const amount = parseFloat(invoiceAmountInput.value);
  if(!date || Number.isNaN(amount) || amount <= 0){ alert("Compila data e importo validi."); return; }

  const vat     = parseFloat(invoiceVatInput?.value) || 0;
  const total   = parseFloat((amount * (1 + vat / 100)).toFixed(2));
  const payload = {
    invoiceNumber: invoiceNumberInput?.value.trim() || "",
    date,
    dueDate:       invoiceDueDateInput?.value || "",
    amount,
    vat,
    total,
    description:   invoiceDescInput?.value.trim() || "",
    category:      invoiceCategoryInput?.value || "",
    status:        invoiceStatusInput?.value || "da-pagare",
    notes:         invoiceNotesInput?.value.trim() || "",
    photoUrl:      existingPhotoUrl || null,
    updatedAt:     new Date().toISOString()
  };

  const ref = collection(db, "suppliers", supplierId, "invoices");
  let invId = editingInvoiceId;

  if(invId){
    await updateDoc(doc(ref, invId), payload);
  } else {
    const newRef = await addDoc(ref, { ...payload, createdAt: new Date().toISOString() });
    invId = newRef.id;
  }

  // upload photo if present
  if(photoFile){
    try {
      const url = await uploadPhotoFile(supplierId, invId);
      payload.photoUrl = url;
      await updateDoc(doc(ref, invId), { photoUrl: url });
    } catch(e){ console.warn("Foto non caricata:", e); }
  }

  invoiceForm.classList.add("hidden");
  editingInvoiceId = null;
  await loadInvoices();
});

// ── Filters ───────────────────────────────────────────
filterPills.forEach(pill => {
  pill.addEventListener("click", () => {
    filterPills.forEach(p => p.classList.remove("active"));
    pill.classList.add("active");
    activeFilter = pill.dataset.filter || "all";
    renderInvoiceTable();
  });
});
invSearch?.addEventListener("input", renderInvoiceTable);

// ── Photo modal ───────────────────────────────────────
function openPhotoModal(url){
  if(!photoModal || !url) return;
  photoModalImg.src = url;
  photoModal.classList.remove("hidden");
}
photoModalClose?.addEventListener("click", () => photoModal.classList.add("hidden"));
photoModalBackdrop?.addEventListener("click", () => photoModal.classList.add("hidden"));

// ── Render invoice table ──────────────────────────────
function renderInvoiceTable(){
  const search = (invSearch?.value || "").toLowerCase().trim();
  const filtered = allInvoices.filter(inv => {
    const { cls } = getStatusInfo(inv);
    const matchFilter = activeFilter === "all" || cls === activeFilter;
    const matchSearch = !search
      || (inv.invoiceNumber||"").toLowerCase().includes(search)
      || (inv.description||"").toLowerCase().includes(search);
    return matchFilter && matchSearch;
  });

  invoiceList.innerHTML = "";
  if(!filtered.length){
    invoiceEmptyState?.classList.remove("hidden");
    return;
  }
  invoiceEmptyState?.classList.add("hidden");

  filtered.forEach(inv => {
    const { label: statusLabel, cls: statusCls } = getStatusInfo(inv);
    const dueCls = getDueCls(inv.dueDate);
    const dueText = inv.dueDate ? formatDate(inv.dueDate) : "—";

    const row = document.createElement("div");
    row.className = "inv-row";
    row.innerHTML = `
      <span class="inv-num">${inv.invoiceNumber ? `#${inv.invoiceNumber}` : "—"}</span>
      <div class="inv-info">
        <div class="inv-desc">${inv.description || "Fattura del "+formatDate(inv.date)}</div>
        <div class="inv-supplier-sub">${inv.category ? `📂 ${inv.category}` : ""}</div>
        <div class="inv-status-mobile"><span class="status-pill ${statusCls}">${statusLabel}</span></div>
      </div>
      <span class="inv-date">${formatDate(inv.date)}</span>
      <span class="inv-due ${dueCls}">${dueText}</span>
      <span class="inv-amt">${eur(invTotal(inv))}</span>
      <!-- inv.total is the VAT-inclusive total for new invoices; inv.amount is kept for backward compatibility with old invoices that only stored the base amount -->
      <span class="status-pill ${statusCls}">${statusLabel}</span>
      <div class="inv-actions-cell">
        ${inv.photoUrl ? `<button class="act-btn photo-btn-sm" title="Visualizza foto" data-photo="${inv.photoUrl}">📷</button>` : ""}
        <button class="act-btn" title="Modifica" data-edit="${inv.id}">✏️</button>
        ${statusCls !== "pagata" ? `<button class="act-btn pay-btn" title="Segna come pagata" data-pay="${inv.id}">✅</button>` : ""}
        <button class="act-btn del-btn" title="Elimina" data-del="${inv.id}">🗑️</button>
      </div>
      <!-- Mobile: compact action row always visible on small screens -->
      <div class="inv-actions-mobile">
        <span class="inv-amt-mobile">${eur(invTotal(inv))}</span>
        <button class="act-btn" title="Modifica" data-edit-m="${inv.id}">✏️</button>
        ${statusCls !== "pagata" ? `<button class="act-btn pay-btn" title="Segna come pagata" data-pay-m="${inv.id}">✅</button>` : ""}
        <button class="act-btn del-btn" title="Elimina" data-del-m="${inv.id}">🗑️</button>
      </div>
    `;

    row.querySelector("[data-photo]")?.addEventListener("click", (e) => {
      e.stopPropagation();
      openPhotoModal(e.currentTarget.dataset.photo);
    });
    row.querySelector("[data-edit]")?.addEventListener("click", (e) => {
      e.stopPropagation();
      startEdit(inv);
    });
    row.querySelector("[data-pay]")?.addEventListener("click", async (e) => {
      e.stopPropagation();
      if(!confirm("Segna questa fattura come pagata?")) return;
      await updateDoc(doc(collection(db,"suppliers",supplierId,"invoices"), inv.id), { status:"pagata" });
      await loadInvoices();
    });
    row.querySelector("[data-del]")?.addEventListener("click", async (e) => {
      e.stopPropagation();
      if(!confirm("Eliminare questa fattura?")) return;
      await deleteDoc(doc(collection(db,"suppliers",supplierId,"invoices"), inv.id));
      await loadInvoices();
    });

    row.querySelector("[data-edit-m]")?.addEventListener("click", (e) => {
      e.stopPropagation(); startEdit(inv);
    });
    row.querySelector("[data-pay-m]")?.addEventListener("click", async (e) => {
      e.stopPropagation();
      if(!confirm("Segna questa fattura come pagata?")) return;
      await updateDoc(doc(collection(db,"suppliers",supplierId,"invoices"), inv.id), { status:"pagata" });
      await loadInvoices();
    });
    row.querySelector("[data-del-m]")?.addEventListener("click", async (e) => {
      e.stopPropagation();
      if(!confirm("Eliminare questa fattura?")) return;
      await deleteDoc(doc(collection(db,"suppliers",supplierId,"invoices"), inv.id));
      await loadInvoices();
    });

    invoiceList.appendChild(row);
  });
}

function startEdit(inv){
  if(!requireSupplierSaved()) return;
  editingInvoiceId = inv.id;
  existingPhotoUrl = inv.photoUrl || null;
  if(invoiceFormTitle) invoiceFormTitle.textContent = "✏️ Modifica fattura";
  invoiceNumberInput.value  = inv.invoiceNumber || "";
  invoiceDateInput.value    = inv.date || todayISO();
  invoiceDueDateInput.value = inv.dueDate || "";
  invoiceAmountInput.value  = inv.amount || ""; // base amount (imponibile); total is recalculated via computeInvoiceTotal()
  invoiceVatInput.value     = String(inv.vat ?? 22);
  invoiceDescInput.value    = inv.description || "";
  if(invoiceCategoryInput) invoiceCategoryInput.value = inv.category || "";
  invoiceStatusInput.value  = inv.status || "da-pagare";
  invoiceNotesInput.value   = inv.notes || "";
  computeInvoiceTotal();
  photoFile = null;
  if(inv.photoUrl){
    photoPreviewImg.src = inv.photoUrl;
    photoPreviewName.textContent = "Foto allegata";
    photoUploadInner?.classList.add("hidden");
    photoPreviewInner?.classList.remove("hidden");
  } else {
    photoUploadInner?.classList.remove("hidden");
    photoPreviewInner?.classList.add("hidden");
  }
  openForm();
}

// ── Load & stats ──────────────────────────────────────
async function loadInvoices(){
  invoiceList.innerHTML = "";
  if(!supplierId){ return; }

  const ref = collection(db, "suppliers", supplierId, "invoices");
  const q   = query(ref, orderBy("date","desc"));
  let snap;
  try { snap = await getDocs(q); } catch(e){ console.warn("Fatture non caricate:", e); renderInvoiceTable(); return; }

  const currentYear = new Date().getFullYear().toString();
  let totalYear = 0, countYear = 0, daPagare = 0, scadute = 0;
  const urgent = [];

  allInvoices = [];
  snap.forEach(docSnap => {
    const inv = { id: docSnap.id, ...docSnap.data() };
    allInvoices.push(inv);
    const amount = invTotal(inv);
    if((inv.date||"").startsWith(currentYear)){
      totalYear += amount; countYear++;
    }
    const { cls } = getStatusInfo(inv);
    if(cls === "da-pagare" || cls === "in-scadenza" || cls === "pagata-parz") daPagare += amount;
    if(cls === "scaduta"){ scadute += amount; urgent.push(inv); }
    else if(cls === "in-scadenza"){ urgent.push(inv); }
  });

  // Stats
  if(allInvoices.length){
    invStatsGrid?.style.setProperty("display","grid");
  }
  if(statCountYear)  statCountYear.textContent  = countYear;
  if(statTotalYear)  statTotalYear.textContent   = eur(totalYear);
  if(statDaPagare)   statDaPagare.textContent    = eur(daPagare);
  if(statScadute)    statScadute.textContent     = eur(scadute);

  // Urgent
  if(urgent.length){
    urgentSection?.style.setProperty("display","block");
    urgentList.innerHTML = `<div class="scad-head">⚠️ Pagamenti in scadenza o scaduti</div>`;
    urgent.forEach(inv => {
      const { cls } = getStatusInfo(inv);
      const diff = inv.dueDate ? daysDiff(inv.dueDate) : null;
      const dueLabel = diff !== null
        ? (diff < 0 ? `Scaduta il ${formatDate(inv.dueDate)}` : `Scade il ${formatDate(inv.dueDate)}`)
        : `Fattura del ${formatDate(inv.date)}`;
      const dueCls = cls === "scaduta" ? "overdue" : "soon";
      const row = document.createElement("div");
      row.className = "scad-row";
      row.innerHTML = `
        <div class="scad-info">
          <div class="scad-supplier">${inv.description || (inv.invoiceNumber ? `#${inv.invoiceNumber}` : "Fattura")}</div>
          <div class="scad-detail">${inv.invoiceNumber ? `Fattura #${inv.invoiceNumber} · ` : ""}${formatDate(inv.date)}</div>
        </div>
        <div class="scad-right">
          <div class="scad-due ${dueCls}">${dueLabel}</div>
          <div class="scad-amt">${eur(invTotal(inv))}</div>
        </div>`;
      urgentList.appendChild(row);
    });
  } else {
    if(urgentSection) urgentSection.style.display = "none";
  }

  // update supplier total
  try { await updateDoc(doc(db,"suppliers",supplierId), { total: totalYear }); } catch(e){ console.warn("Aggiornamento totale fornitore fallito:", e); }

  renderInvoiceTable();
}

/* Init */
await loadSupplier();
await loadInvoices();
await loadOrders();

// ── Toggle storico ordini ─────────────────────────────
toggleOrdersBtn?.addEventListener("click", () => {
  const hidden = ordersHistoryBody?.classList.toggle("hidden");
  if(toggleOrdersBtn) toggleOrdersBtn.textContent = hidden ? "Mostra" : "Nascondi";
});

markAllPaidBtn?.addEventListener("click", markAllOrdersPaid);

// ── Mark all supplier orders as paid ─────────────────
async function markAllOrdersPaid(){
  if(!supplierId) return;
  if(!confirm("Segna TUTTI gli ordini di questo fornitore come pagati e saldati?")) return;
  const ordersRef = collection(db, "suppliers", supplierId, "orders");
  const snap = await getDocs(ordersRef);
  const batch = writeBatch(db);
  let count = 0;
  snap.forEach(docSnap => {
    const d = docSnap.data();
    if(!d.pagato || !d.saldato){
      batch.update(doc(ordersRef, docSnap.id), { pagato: true, saldato: true });
      count++;
    }
  });
  if(count === 0){ alert("Tutti gli ordini sono già segnati come pagati."); return; }
  await batch.commit();
  alert(`✅ ${count} ordine/i segnato/i come pagato e saldato.`);
  await loadOrders();
}

// ── Load historical orders ────────────────────────────
async function loadOrders(){
  if(!supplierId || !ordersHistorySection) return;
  ordersHistorySection.style.display = "block";

  const ordersRef  = collection(db, "suppliers", supplierId, "orders");
  const invRef     = collection(db, "suppliers", supplierId, "invoices");
  const ordersQ    = query(ordersRef, orderBy("data", "desc"));
  const invQ       = query(invRef, orderBy("date", "desc"));

  let ordersSnap, invSnap;
  try {
    [ordersSnap, invSnap] = await Promise.all([getDocs(ordersQ), getDocs(invQ)]);
  } catch(e){
    console.warn("Storico non caricato:", e);
    ordersEmptyState?.classList.remove("hidden");
    return;
  }

  // Build combined entries list (orders + invoices with photo)
  const entries = [];

  ordersSnap.forEach(docSnap => {
    const o = docSnap.data();
    const dateVal = o.data?.toDate ? o.data.toDate() : (o.data ? new Date(o.data) : null);
    entries.push({ id: docSnap.id, type: "order", dateVal, data: o });
  });

  invSnap.forEach(docSnap => {
    const inv = docSnap.data();
    if(!inv.photoUrl) return; // only photo-invoices appear in orders history
    const dateVal = inv.date ? new Date(inv.date + "T00:00:00") : null;
    entries.push({ id: docSnap.id, type: "invoice", dateVal, data: inv });
  });

  // Sort descending by date
  entries.sort((a, b) => (b.dateVal?.getTime() || 0) - (a.dateVal?.getTime() || 0));

  if(!ordersList) return;
  ordersList.innerHTML = "";

  if(entries.length === 0){
    ordersEmptyState?.classList.remove("hidden");
    if(markAllPaidBtn) markAllPaidBtn.style.display = "none";
    return;
  }
  ordersEmptyState?.classList.add("hidden");

  // Show "mark all paid" button only when there are unpaid orders
  const hasUnpaid = ordersSnap.docs.some(d => !d.data().pagato);
  if(markAllPaidBtn) markAllPaidBtn.style.display = hasUnpaid ? "inline-flex" : "none";

  entries.forEach(entry => {
    const dateVal = entry.dateVal;
    const dateStr = dateVal
      ? `${String(dateVal.getDate()).padStart(2,"0")}/${String(dateVal.getMonth()+1).padStart(2,"0")}/${dateVal.getFullYear()}`
      : "—";

    const row = document.createElement("div");
    row.className = "order-row";

    if(entry.type === "order"){
      const o = entry.data;
      const righe = Array.isArray(o.righe) ? o.righe : [];
      const itemsHtml = righe.length
        ? righe.map(r => {
            const prodotto = (r.prodotto || "—").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
            return `${prodotto} × ${r.quantita ?? 1} (${eur(r.totale || 0)})`;
          }).join("<br>")
        : "—";
      const totale  = Number(o.totale || 0);
      const pagato  = o.pagato === true;
      const saldato = o.saldato === true;
      const statusLabel = (pagato && saldato) ? "✅ Pagato e saldato" : pagato ? "✅ Pagato" : "⏳ Da saldare";
      const statusCls   = (pagato || saldato) ? "pagato" : "in-attesa";

      row.innerHTML = `
        <span class="order-date">${dateStr}</span>
        <div class="order-items">
          ${itemsHtml}
          <div class="order-items-status" style="display:none;margin-top:4px;">
            <span class="order-status-pill ${statusCls}">${statusLabel}</span>
          </div>
        </div>
        <span class="order-total">${eur(totale)}</span>
        <div class="order-status-cell">
          <span class="order-status-pill ${statusCls}">${statusLabel}</span>
        </div>
        <div class="order-actions-cell">
          ${!pagato ? `<button class="act-btn pay-btn" title="Segna come pagato e saldato" data-order-pay="${entry.id}">✅</button>` : ""}
        </div>
      `;
      row.querySelector("[data-order-pay]")?.addEventListener("click", async (e) => {
        e.stopPropagation();
        if(!confirm("Segna questo ordine come pagato e saldato?")) return;
        await updateDoc(doc(ordersRef, entry.id), { pagato: true, saldato: true });
        await loadOrders();
      });

    } else {
      // Fattura con foto
      const inv  = entry.data;
      const { label: statusLabel, cls: statusCls } = getStatusInfo(inv);
      const totale = invTotal(inv);
      const numLabel = inv.invoiceNumber ? `Fattura #${inv.invoiceNumber}` : "Fattura";

      row.innerHTML = `
        <span class="order-date">${dateStr}</span>
        <div class="order-items">
          <strong>🧾 ${numLabel.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")}</strong>
          ${inv.description ? `<br>${inv.description.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")}` : ""}
          <br><button class="act-btn photo-btn-sm" style="margin-top:4px;width:auto;padding:0 8px;height:26px;font-size:11px;" data-photo="${inv.photoUrl}" title="Visualizza foto fattura">📷 Vedi foto</button>
          <div class="order-items-status" style="display:none;margin-top:4px;">
            <span class="status-pill ${statusCls}">${statusLabel}</span>
          </div>
        </div>
        <span class="order-total">${eur(totale)}</span>
        <div class="order-status-cell">
          <span class="status-pill ${statusCls}">${statusLabel}</span>
        </div>
        <div class="order-actions-cell"></div>
      `;
      row.querySelector("[data-photo]")?.addEventListener("click", (e) => {
        e.stopPropagation();
        openPhotoModal(e.currentTarget.dataset.photo);
      });
    }

    ordersList.appendChild(row);
  });

  // On mobile, show status inline inside items
  if(window.innerWidth <= MOBILE_BREAKPOINT){
    ordersList.querySelectorAll(".order-items-status").forEach(el => el.style.display = "flex");
  }
}