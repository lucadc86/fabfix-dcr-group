import { firestoreService as fs } from "./services/firestoreService.js";
import { getCalendarByMonth, getYearlyIncomesTotal, getManualDaySnapshot, parseEntriesFromFreeText, listIncomesByDay } from "./services/incomeService.js";
import { auth } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

const euro = (n) => new Intl.NumberFormat("it-IT", { style:"currency", currency:"EUR" }).format(Number(n)||0);
const $ = (id) => document.getElementById(id);
const title = $("monthTitle");
const prevBtn = $("prevMonth");
const nextBtn = $("nextMonth");
const dayList = $("dayList");
const totMese = $("totMese");
const totAnno = $("totAnno");
const popup = $("popup");
const popupDate = $("popupDate");
const noteEl = $("note");
const amountEl = $("amount");
const manualAmountEl = $("manualAmount");
const clientEl = $("manualClient");
const clientsDatalist = $("clientsDatalist");
const closeBtn = $("closeBtn");
const saveBtn = $("saveBtn");
const deleteBtn = $("deleteBtn");
const autoSummary = $("autoSummary");
const autoEntries = $("autoEntries");
let clients = [];
let popupAutoTotal = 0;

let cursor = new Date(); cursor.setDate(1); cursor.setHours(0,0,0,0);

function iso(y,m,d){ return `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`; }
function monthLabel(d){ return d.toLocaleDateString('it-IT', { month:'long', year:'numeric' }).toUpperCase(); }

function parseLocaleAmount(value){
  const raw = String(value ?? '').trim();
  if (!raw) return 0;
  const normalized = raw.replace(/\./g, '').replace(',', '.').replace(/[^0-9.-]/g, '');
  const n = Number(normalized);
  return Number.isFinite(n) ? n : 0;
}

function formatInputAmount(value){
  const n = Number(value || 0);
  if (!(n > 0)) return '';
  return String(Number(n.toFixed(2))).replace('.', ',');
}

function kindLabel(v){
  const k = String(v || '').toLowerCase();
  if(k === 'acconto') return 'Acconto';
  if(k === 'saldo' || k === 'incassato' || k === 'incasso') return 'Saldo';
  return 'Incasso';
}

function renderAutoEntries(entries = []){
  if(!autoEntries || !autoSummary) return;
  const autoOnly = entries.filter((e)=>String(e.source||'').toLowerCase()==='ordine' || e.orderId);
  popupAutoTotal = Number(autoOnly.reduce((sum,e)=>sum+(Number(e.amount)||0),0).toFixed(2));
  if(!autoOnly.length){
    autoSummary.textContent = 'Nessun incasso automatico registrato.';
    autoEntries.innerHTML = '';
    return;
  }
  autoSummary.textContent = `Totale automatico del giorno: ${euro(popupAutoTotal)}`;
  autoEntries.innerHTML = autoOnly.map((e)=>{
    const label = kindLabel(e.paymentType || e.kind);
    return `<div class="auto-entry">
      <div class="auto-entry-main">
        <div class="auto-entry-name">${e.clientName || 'Cliente'}</div>
        <div class="auto-entry-meta">
          <span class="kind-pill ${String(e.paymentType || e.kind || '').toLowerCase()}">${label}</span>
          ${e.orderId ? `<span class="auto-order">Ordine ${e.orderId}</span>` : ''}
        </div>
      </div>
      <div class="auto-entry-amt">${euro(e.amount)}</div>
    </div>`;
  }).join('');
}

function closePopup(){
  popup.classList.remove('show');
  popupAutoTotal = 0;
  delete popup.dataset.day;
}

function computeAutoAmount(){
  const entries = parseEntriesFromFreeText(noteEl?.value || '', clients);
  const manualFromNotes = Number(entries.reduce((s, x) => s + (Number(x.amount)||0), 0).toFixed(2));
  const manualTyped = parseLocaleAmount(manualAmountEl?.value || '');
  const manualTotal = manualFromNotes > 0 ? manualFromNotes : manualTyped;
  if (manualAmountEl && manualFromNotes > 0) {
    manualAmountEl.value = formatInputAmount(manualFromNotes);
  }
  const totalDay = Number((popupAutoTotal + manualTotal).toFixed(2));
  if (amountEl) amountEl.value = formatInputAmount(totalDay);
  return { entries, manualTotal: Number(manualTotal.toFixed(2)), totalDay };
}

noteEl?.addEventListener('input', computeAutoAmount);
manualAmountEl?.addEventListener('input', computeAutoAmount);

async function openPopup(day){
  popup.dataset.day = day;
  popupDate.textContent = day;
  clientEl.value='';
  const [snap, allEntries] = await Promise.all([
    getManualDaySnapshot(day),
    listIncomesByDay(day)
  ]);
  noteEl.value = snap.noteText || '';
  if (manualAmountEl) manualAmountEl.value = formatInputAmount(snap.total || 0);
  renderAutoEntries(allEntries);
  computeAutoAmount();
  popup.classList.add('show');
}
closeBtn?.addEventListener('click', closePopup);
popup?.addEventListener('click', (e)=>{ if(e.target===popup) closePopup(); });

async function loadClients(){
  clients = await fs.getAll('clients');
  clientsDatalist.innerHTML = clients.map(c=>`<option value="${String(c.name || c.nome || '').replace(/"/g,'&quot;')}"></option>`).join('');
}

async function renderMonth(){
  const y = cursor.getFullYear();
  const m = cursor.getMonth()+1;
  title.textContent = monthLabel(cursor);
  const cal = await getCalendarByMonth(y,m);
  const dim = new Date(y,m,0).getDate();
  let monthSum = 0;
  dayList.innerHTML = Array.from({length:dim}, (_,i)=>{
    const day = i+1;
    const dayIso = iso(y,m,day);
    const amount = cal.get(dayIso) || 0;
    monthSum += amount;
    const weekday = new Date(y,m-1,day).toLocaleDateString('it-IT', { weekday:'short' });
    return `<div class="day-row" data-day="${dayIso}"><div class="day-left"><div class="day-date">${String(day).padStart(2,'0')}/${String(m).padStart(2,'0')}/${y}</div><div class="day-sub">${weekday}</div></div><div class="day-amt">${euro(amount)}</div></div>`;
  }).join('');
  totMese.textContent = euro(monthSum);
  totAnno.textContent = euro(await getYearlyIncomesTotal(y));
  dayList.querySelectorAll('.day-row').forEach((row)=>row.addEventListener('click', ()=>openPopup(row.dataset.day)));
}

async function saveManual(){
  const day = popup.dataset.day;
  if(!day) return;
  let { entries, manualTotal } = computeAutoAmount();
  const clientName = String(clientEl.value || '').trim();
  const amount = parseLocaleAmount((manualAmountEl || amountEl).value || '');

  if (!entries.length && clientName && amount > 0) {
    entries = [{ clientName, clientId:'', amount, note:`${clientName} ${amount}` }];
    manualTotal = amount;
  }

  const hasManualData = entries.length > 0 || manualTotal > 0 || clientName.length > 0 || String(noteEl?.value || '').trim().length > 0;

  if (!hasManualData) {
    closePopup();
    await renderMonth();
    return;
  }

  if (!entries.length || !(manualTotal > 0)) {
    alert('Inserisci almeno una riga nel dettaglio oppure cliente + importo.');
    return;
  }

  const note = entries.map((e)=>`${e.clientName} ${String(e.amount).replace('.', ',')}`).join('\n');
  await fs.set('incassi', day, { date: day, note, amount: manualTotal, entries, source:'manuale', updatedAt: fs.serverTimestamp() }, { merge:true });
  await fs.add('incassiHistory', { action:'SAVE_MANUALE_DAY', day, amount: manualTotal, entries, at: fs.serverTimestamp() });
  closePopup();
  await renderMonth();
}

async function deleteManual(){
  const day = popup.dataset.day;
  if(!day) return;
  await fs.set('incassi', day, { note:'', amount:0, entries:[], updatedAt: fs.serverTimestamp() }, { merge:true });
  await fs.add('incassiHistory', { action:'CLEAR_MANUALE_DAY', day, at: fs.serverTimestamp() });
  closePopup();
  await renderMonth();
}

saveBtn?.addEventListener('click', saveManual);
deleteBtn?.addEventListener('click', deleteManual);
prevBtn?.addEventListener('click', ()=>{ cursor.setMonth(cursor.getMonth()-1); renderMonth(); });
nextBtn?.addEventListener('click', ()=>{ cursor.setMonth(cursor.getMonth()+1); renderMonth(); });

function waitForAuth() {
  return new Promise(resolve => {
    const unsub = onAuthStateChanged(auth, user => { unsub(); resolve(user); });
  });
}

waitForAuth().then(() => {
  loadClients().then(renderMonth).catch((e) => { console.error(e); alert('Errore caricamento calendario incassi.'); });
});
