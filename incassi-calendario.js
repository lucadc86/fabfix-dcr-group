import { firestoreService as fs } from "./services/firestoreService.js";
import { getCalendarByMonth, getYearlyIncomesTotal, getManualDaySnapshot, listIncomesByDay } from "./services/incomeService.js";
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
const amountEl = $("amount");
const manualAmountEl = $("manualAmount");
const clientsDatalist = $("clientsDatalist");
const manualEntriesTable = $("manualEntriesTable");
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

  const autoEmpty = document.getElementById('autoEmpty');
  const autoBoxTotalRow = document.getElementById('autoBoxTotalRow');

  if(!autoOnly.length){
    autoSummary.textContent = '—';
    autoEntries.innerHTML = '';
    if(autoEmpty) autoEmpty.style.display = '';
    if(autoBoxTotalRow) autoBoxTotalRow.style.display = 'none';
    return;
  }
  if(autoEmpty) autoEmpty.style.display = 'none';
  if(autoBoxTotalRow) autoBoxTotalRow.style.display = '';
  autoSummary.textContent = `${euro(popupAutoTotal)}`;
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

// ── Structured manual-entries table ─────────────────────────────────────────

function createEntryRow(clientName, amount) {
  const row = document.createElement('div');
  row.className = 'entry-row';

  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.className = 'entry-name';
  nameInput.placeholder = 'Nome cliente…';
  nameInput.setAttribute('list', 'clientsDatalist');
  nameInput.autocomplete = 'off';
  nameInput.value = clientName || '';

  const amtInput = document.createElement('input');
  amtInput.type = 'text';
  amtInput.inputMode = 'decimal';
  amtInput.className = 'entry-amt';
  amtInput.placeholder = '0,00';
  amtInput.value = amount ? formatInputAmount(amount) : '';

  const delBtn = document.createElement('button');
  delBtn.type = 'button';
  delBtn.className = 'entry-del';
  delBtn.textContent = '×';
  delBtn.addEventListener('click', () => { row.remove(); computeAutoAmount(); });

  nameInput.addEventListener('input', computeAutoAmount);
  amtInput.addEventListener('input', computeAutoAmount);

  row.appendChild(nameInput);
  row.appendChild(amtInput);
  row.appendChild(delBtn);
  return row;
}

function addEntryRow(clientName, amount) {
  if (!manualEntriesTable) return;
  manualEntriesTable.appendChild(createEntryRow(clientName, amount));
}

function clearEntryTable() {
  if (manualEntriesTable) manualEntriesTable.innerHTML = '';
}

function getTableEntries() {
  if (!manualEntriesTable) return [];
  const rows = manualEntriesTable.querySelectorAll('.entry-row');
  const entries = [];
  rows.forEach((row) => {
    const clientName = String(row.querySelector('.entry-name')?.value || '').trim();
    const amount = parseLocaleAmount(row.querySelector('.entry-amt')?.value || '');
    if (clientName && amount > 0) {
      entries.push({ clientName, clientId: '', amount: Number(amount.toFixed(2)), note: `${clientName} ${amount}` });
    }
  });
  return entries;
}

function computeAutoAmount(){
  const entries = getTableEntries();
  const manualTotal = Number(entries.reduce((s, x) => s + (Number(x.amount) || 0), 0).toFixed(2));
  if (manualAmountEl) manualAmountEl.value = manualTotal > 0 ? formatInputAmount(manualTotal) : '';
  const totalDay = Number((popupAutoTotal + manualTotal).toFixed(2));
  if (amountEl) amountEl.value = formatInputAmount(totalDay);

  // update display labels
  const manualDisplay = document.getElementById('manualAmountDisplay');
  const totalDisplay = document.getElementById('totalDayDisplay');
  if(manualDisplay) manualDisplay.textContent = `€ ${manualTotal > 0 ? formatInputAmount(manualTotal) : '0,00'}`;
  if(totalDisplay) totalDisplay.textContent = `€ ${formatInputAmount(totalDay) || '0,00'}`;

  return { entries, manualTotal: Number(manualTotal.toFixed(2)), totalDay };
}

$('addEntryBtn')?.addEventListener('click', () => { addEntryRow('', ''); });

async function openPopup(day){
  popup.dataset.day = day;
  popupDate.textContent = day;
  clearEntryTable();
  const [snap, allEntries] = await Promise.all([
    getManualDaySnapshot(day),
    listIncomesByDay(day)
  ]);
  if (snap.rows && snap.rows.length) {
    snap.rows.forEach((r) => addEntryRow(r.clientName || '', r.amount || 0));
  } else {
    addEntryRow('', '');
  }
  renderAutoEntries(allEntries);
  computeAutoAmount();
  popup.classList.add('show');
}
closeBtn?.addEventListener('click', closePopup);
popup?.addEventListener('click', (e)=>{ if(e.target===popup) closePopup(); });

async function loadClients(){
  clients = await fs.getAll('clients');
  if (clientsDatalist) {
    clientsDatalist.innerHTML = clients.map(c=>`<option value="${String(c.name || c.nome || '').replace(/"/g,'&quot;')}"></option>`).join('');
  }
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
  const { entries, manualTotal } = computeAutoAmount();
  const validEntries = entries.filter((e) => e.clientName || e.amount > 0);

  if (!validEntries.length) {
    alert('Inserisci almeno una riga con nome cliente e importo.');
    return;
  }

  if (!(manualTotal > 0)) {
    alert('Inserisci almeno un importo valido.');
    return;
  }

  const note = validEntries.map((e)=>`${e.clientName} ${String(e.amount).replace('.', ',')}`).join('\n');
  await fs.set('incassi', day, { date: day, note, amount: manualTotal, entries: validEntries, source:'manuale', updatedAt: fs.serverTimestamp() }, { merge:true });
  await fs.add('incassiHistory', { action:'SAVE_MANUALE_DAY', day, amount: manualTotal, entries: validEntries, at: fs.serverTimestamp() });
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

