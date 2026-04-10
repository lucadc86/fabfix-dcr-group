import { firestoreService as fs } from "./services/firestoreService.js";
import { listDeadlines, upsertDeadline, softDeleteDeadline } from "./services/deadlineService.js";
import { auth } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

// =========================================================
// Utils
// =========================================================
const itMoney = (n) => {
  const v = Number(n) || 0;
  return new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" }).format(v);
};
const pad2 = (n) => String(n).padStart(2, "0");
const isoKey = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const ymKey = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;

function toNum(v){
  if(typeof v === 'number') return Number.isFinite(v) ? v : 0;
  const s = String(v ?? '').trim();
  if(!s) return 0;
  let cleaned = s.replace(/[^0-9,.-]/g,'');
  if(cleaned.includes(',')) cleaned = cleaned.replace(/\./g,'').replace(',', '.');
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

// =========================================================
// DOM
// =========================================================
const monthTitle = document.getElementById("monthTitle");
const prevBtn = document.getElementById("prevBtn");
const nextBtn = document.getElementById("nextBtn");
const backBtn = document.getElementById("backBtn");

const monthTotalEl = document.getElementById("monthTotal");
const yearTotalEl = document.getElementById("yearTotal");
const daysEl = document.getElementById("days");
const sideMonthEl = document.getElementById("sideMonth");
const sideYearEl = document.getElementById("sideYear");
const btnNew = document.getElementById("btnNew");

// Popup
const popup = document.getElementById("popup");
const popupDate = document.getElementById("popupDate");
const noteEl = document.getElementById("note");
const amountEl = document.getElementById("amount");
const saveBtn = document.getElementById("saveBtn");
const deleteBtn = document.getElementById("deleteBtn");
const closeBtn = document.getElementById("closeBtn");

// =========================================================
// State
// =========================================================
let cursor = new Date();
cursor.setDate(1);

let paymentsDocs = []; // {id, dateKey, amount, note}
let selectedKey = null;

// =========================================================
// Data
// =========================================================
async function loadPayments(){
  // Struttura reale: collection "scadenze" (docId = YYYY-MM-DD, campo amount)
  const list = await listDeadlines();
  paymentsDocs = list
    .map((x) => ({
      id: x.id,
      dateKey: String(x.dateISO || x.date || x.id || '').slice(0, 10),
      amount: toNum(x.amount ?? x.importo ?? x.totale ?? x.value ?? 0),
      note: String(x.note || x.descrizione || x.title || ""),
    }))
    .filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(x.dateKey));
}

function sumForMonth(baseDate){
  const key = ymKey(baseDate);
  return paymentsDocs
    .filter(x => String(x.dateKey||"").startsWith(key))
    .reduce((s,x)=> s + (Number(x.amount)||0), 0);
}

function sumForYear(year){
  const key = `${year}-`;
  return paymentsDocs
    .filter(x => String(x.dateKey||"").startsWith(key))
    .reduce((s,x)=> s + (Number(x.amount)||0), 0);
}

function sumByDayForMonth(baseDate){
  const key = ymKey(baseDate);
  const sums = {};
  for(const x of paymentsDocs){
    const dk = String(x.dateKey||"");
    if(!dk.startsWith(key)) continue;
    sums[dk] = (sums[dk]||0) + (Number(x.amount)||0);
  }
  return sums;
}

// =========================================================
// UI
// =========================================================
function openPopup(dayKey){
  selectedKey = dayKey;
  popupDate.textContent = dayKey;

  // Se esiste un doc con id uguale al giorno, lo carichiamo per modificare nota/importo.
  // Se ci sono più record nello stesso giorno (vecchi), mostriamo la somma come riferimento.
  const dayItems = paymentsDocs.filter(x => x.dateKey === dayKey);
  const sumDay = dayItems.reduce((s,x)=> s + (Number(x.amount)||0), 0);

  const byId = dayItems.find(x => x.id === dayKey);
  noteEl.value = byId ? (byId.note || "") : "";
  amountEl.value = byId ? String(toNum(byId.amount)) : "";
  amountEl.placeholder = sumDay ? String(sumDay.toFixed(2)) : "0.00";

  popup.classList.remove("hidden");
  popup.setAttribute("aria-hidden", "false");
}

function closePopup(){
  popup.classList.add("hidden");
  popup.setAttribute("aria-hidden", "true");
  selectedKey = null;
}

function render(){
  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const start = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0).getDate();

  monthTitle.textContent = start.toLocaleDateString("it-IT", { month:"long", year:"numeric" }).toUpperCase();

  const monthSum = sumForMonth(start);
  const yearSum = sumForYear(year);

  monthTotalEl.textContent = itMoney(monthSum);
  yearTotalEl.textContent = itMoney(yearSum);
  if(sideMonthEl) sideMonthEl.textContent = itMoney(monthSum);
  if(sideYearEl) sideYearEl.textContent = itMoney(yearSum);

  const sums = sumByDayForMonth(start);
  daysEl.innerHTML = "";

  for(let day = 1; day <= lastDay; day++){
    const d = new Date(year, month, day);
    const k = isoKey(d);
    const val = sums[k] || 0;

    const row = document.createElement("div");
    row.className = "scad-calendar-row";

    // nota: prendiamo la prima nota del giorno (se esiste) solo per anteprima
    const notePreview = (paymentsDocs.find(x => x.dateKey === k)?.note || "").trim();
    row.innerHTML = `
      <div>
        <div class="scad-date">${pad2(day)}/${pad2(month+1)}/${year}</div>
        <div class="scad-note">${notePreview ? notePreview.replace(/</g,'&lt;').replace(/>/g,'&gt;') : "—"}</div>
      </div>
      <div class="scad-amt">${itMoney(val)}</div>
    `;
    row.addEventListener("click", ()=> openPopup(k));
    daysEl.appendChild(row);
  }
}

async function boot(){
  try{
    await loadPayments();
    render();
  }catch(e){
    console.error(e);
    alert("Errore caricamento scadenze.");
  }
}

// =========================================================
// Events
// =========================================================
backBtn?.addEventListener("click", ()=> window.location.href = "index.html");
prevBtn?.addEventListener("click", ()=>{ cursor.setMonth(cursor.getMonth()-1); render(); });
nextBtn?.addEventListener("click", ()=>{ cursor.setMonth(cursor.getMonth()+1); render(); });

btnNew?.addEventListener("click", ()=>{
  // nuova scadenza sul giorno corrente del mese in visualizzazione
  const d = new Date(cursor);
  d.setDate(Math.min(new Date().getDate(), new Date(d.getFullYear(), d.getMonth()+1, 0).getDate()));
  openPopup(isoKey(d));
});

closeBtn?.addEventListener("click", closePopup);
popup?.addEventListener("click", (e)=>{ if(e.target === popup) closePopup(); });

saveBtn?.addEventListener("click", async ()=>{
  if(!selectedKey) return;
  const note = String(noteEl.value || "").trim();
  const amount = toNum(amountEl.value);
  const payload = {
    date: selectedKey,
    note,
    amount,
    updatedAt: fs.serverTimestamp()
  };
  await upsertDeadline(selectedKey, payload);
  try{
    await fs.add("scadenzeHistory", {
      action: "save",
      day: selectedKey,
      payload,
      at: fs.serverTimestamp()
    });
  }catch(_e){}
  closePopup();
  await boot();
});

deleteBtn?.addEventListener("click", async ()=>{
  if(!selectedKey) return;
  if(!confirm("Eliminare la scadenza del giorno selezionato?")) return;
  try{
    const snap = await fs.getDoc("scadenze", selectedKey);
    if(snap){
      await fs.add("scadenzeHistory", {
        action: "delete",
        day: selectedKey,
        payload: snap,
        at: fs.serverTimestamp()
      });
    }
  }catch(_e){}
  await softDeleteDeadline(selectedKey);
  closePopup();
  await boot();
});

function waitForAuth() {
  return new Promise(resolve => {
    const unsub = onAuthStateChanged(auth, user => { unsub(); resolve(user); });
  });
}

waitForAuth().then(() => { boot(); });
