import { firestoreService as fs } from "./services/firestoreService.js";
import { listExpenses } from "./services/expenseService.js";
import { auth } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import {
  getCalendarByMonth,
  getOutstandingTotal,
  getYearlyMonthlySeries,
  getNormalizedIncomesAndOrders,
  listIncomesByDay,
  listIncomesByMonth,
  getManualDaySnapshot,
  parseEntriesFromFreeText,
} from "./services/incomeService.js?v=69fix";
import { getIncassiKpis } from "./services/kpiService.js";

const MONTHS = ["Gen","Feb","Mar","Apr","Mag","Giu","Lug","Ago","Set","Ott","Nov","Dic"];
const MONTHS_LONG = ["Gennaio","Febbraio","Marzo","Aprile","Maggio","Giugno","Luglio","Agosto","Settembre","Ottobre","Novembre","Dicembre"];
const euro = (n) => new Intl.NumberFormat("it-IT", { style:"currency", currency:"EUR" }).format(Number(n)||0);
const $ = (id) => document.getElementById(id);
const todayISO = () => new Date().toISOString().slice(0,10);
const escapeHtml = (s) => String(s ?? "").replace(/[&<>"]/g, (m)=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;"}[m]));
const fmtDate = (iso) => new Date(`${iso}T00:00:00`).toLocaleDateString('it-IT');
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


const els = {
  kpiOggi: $("kpiOggi"), kpiMese: $("kpiMese"), kpiIncAnno: $("kpiIncAnno"), kpiFattMese: $("kpiFattMese"),
  kpiRestante: $("kpiRestante"), kpiMedia30: $("kpiMedia30"), saldoVal: $("saldoVal"),
  miniIncassiMese: $("miniIncassiMese"), miniSpeseMese: $("miniSpeseMese"), sideMonthTitle: $("sideMonthTitle"),
  sidePrevMonth: $("sidePrevMonth"), sideNextMonth: $("sideNextMonth"), sideCalList: $("sideCalList"),
  statusText: $("statusText"), statIncassiCount: $("statIncassiCount"), statOrdersCount: $("statOrdersCount"),
  btnApriCalendarioTop: $("btnApriCalendarioTop"), btnNuovoIncasso: $("btnNuovoIncasso"), popup: $("popup"),
  popupDate: $("popupDate"), closeBtn: $("closeBtn"), saveBtn: $("saveBtn"), deleteBtn: $("deleteBtn"),
  note: $("note"), amount: $("amount"), manualClient: $("manualClient"), clientsDatalist: $("clientsDatalist"),
  listModal: $("listModal"), listModalTitle: $("listModalTitle"), listModalBody: $("listModalBody"), listModalClose: $("listModalClose"),
};

let sideCursor = new Date(); sideCursor.setDate(1); sideCursor.setHours(0,0,0,0);
let popupAutoTotal = 0;

let chartMain = null;
let cache = { incomes: [], orders: [], expenses: [], clients: [] };

function openListModal(title, html) {
  els.listModalTitle.textContent = title;
  els.listModalBody.innerHTML = html || "<div class='empty-chart'>Nessun dato.</div>";
  els.listModal.classList.remove("hidden");
}
function closeListModal() { els.listModal.classList.add("hidden"); }
els.listModalClose?.addEventListener("click", closeListModal);
els.listModal?.addEventListener("click", (e)=>{ if(e.target === els.listModal) closeListModal(); });

function renderIncomeRows(rows) {
  return rows.map((r) => `
    <div class="modal-row">
      <div class="meta">${fmtDate(r.dateISO)}</div>
      <div class="name">${escapeHtml(r.clientName || "Incasso")}${r.note ? `<div class="note">${escapeHtml(r.note)}</div>` : ""}</div>
      <div class="amt">${euro(r.amount)}</div>
    </div>`).join("");
}


function resolveOrderClientName(o){
  const fromId = cache.clients.find((c)=>c.id === o.clientId);
  return String(
    o.clientName || o.clienteNome || o.cliente || o.nomeCliente || fromId?.name || fromId?.nome || 'Cliente'
  ).trim();
}

function renderOutstandingRows(rows) {
  if (!rows.length) return "<div class='empty-chart'>Nessun residuo da incassare.</div>";
  return rows.map((o) => {
    const total = Number(o.total || 0);
    const deposit = Number(o.deposit || 0);
    const residual = Number.isFinite(Number(o.residual)) && Number(o.residual) > 0
      ? Number(o.residual)
      : Math.max(0, total - deposit);
    const dateISO = String(o.createdAtISO || '').slice(0,10);
    return `
      <div class="modal-row">
        <div style="min-width:0;">
          <div style="font-weight:900;">${escapeHtml(resolveOrderClientName(o) || 'Cliente')}</div>
          <div class="meta">${dateISO ? fmtDate(dateISO) : ''} • Totale ${euro(total)} • Acconto ${euro(deposit)}</div>
        </div>
        <div class="amt">${euro(residual)}</div>
      </div>`;
  }).join('');
}

async function refreshClients(){
  cache.clients = await fs.getAll("clients");
  els.clientsDatalist.innerHTML = cache.clients.map((c)=>`<option value="${escapeHtml(c.name || c.nome || "")}"></option>`).join("");
}

async function loadData() {
  const [norm, expenses, rawIncassi] = await Promise.all([getNormalizedIncomesAndOrders(), listExpenses(), fs.getAll('incassi')]);
  cache.incomes = norm.incomes;
  cache.orders = norm.orders;
  cache.expenses = expenses;
  cache.clients = norm.clients || [];
  cache.rawIncassi = rawIncassi || [];
}

function computeAutoAmount(){
  const entries = parseEntriesFromFreeText(els.note?.value || '', cache.clients || []);
  const manualFromNotes = Number(entries.reduce((s, x) => s + (Number(x.amount)||0), 0).toFixed(2));
  const manualTyped = parseLocaleAmount(els.manualAmount?.value || '');
  const manualTotal = manualFromNotes > 0 ? manualFromNotes : manualTyped;
  if (els.manualAmount && manualFromNotes > 0) {
    els.manualAmount.value = formatInputAmount(manualFromNotes);
  }
  const totalDay = Number((popupAutoTotal + manualTotal).toFixed(2));
  if (els.amount) els.amount.value = formatInputAmount(totalDay);
  return { entries, manualTotal: Number(manualTotal.toFixed(2)), totalDay };
}

els.manualAmount = $('manualAmount');
els.note?.addEventListener('input', computeAutoAmount);
els.manualAmount?.addEventListener('input', computeAutoAmount);

async function openDayPopup(dayISO){
  els.popup.dataset.day = dayISO;
  els.popupDate.textContent = dayISO;
  els.manualClient.value = "";
  const [snap, allEntries] = await Promise.all([getManualDaySnapshot(dayISO), listIncomesByDay(dayISO)]);
  els.note.value = snap.noteText || "";
  if (els.manualAmount) els.manualAmount.value = formatInputAmount(snap.total || 0);
  renderAutoEntries(allEntries);
  computeAutoAmount();
  els.popup.classList.add("show");
}
function kindLabel(v){
  const k = String(v || '').toLowerCase();
  if(k === 'acconto') return 'Acconto';
  if(k === 'saldo' || k === 'incassato' || k === 'incasso') return 'Saldo';
  return 'Incasso';
}
function renderAutoEntries(entries = []){
  const autoSummary = $('autoSummary');
  const autoEntries = $('autoEntries');
  if(!autoEntries || !autoSummary) return;
  const autoOnly = entries.filter((e)=>String(e.source||'').toLowerCase()==='ordine' || e.orderId);
  popupAutoTotal = Number(autoOnly.reduce((s,e)=>s+(Number(e.amount)||0),0).toFixed(2));
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

function closeDayPopup(){ els.popup.classList.remove("show"); popupAutoTotal = 0; delete els.popup.dataset.day; }

function openBlankDayPopup(dayISO){
  els.popup.dataset.day = dayISO;
  els.popupDate.textContent = dayISO;
  els.manualClient.value = "";
  els.note.value = "";
  if (els.manualAmount) els.manualAmount.value = "";
  popupAutoTotal = 0;
  renderAutoEntries([]);
  computeAutoAmount();
  els.popup.classList.add("show");
}
els.closeBtn?.addEventListener("click", closeDayPopup);
els.popup?.addEventListener("click", (e)=>{ if(e.target===els.popup) closeDayPopup(); });

async function renderKpis() {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth() + 1;
  const kpis = await getIncassiKpis(todayISO());
  const monthExpenses = cache.expenses.filter((e)=>String(e.dateISO||"").startsWith(`${y}-${String(m).padStart(2,"0")}-`)).reduce((s,e)=>s+(Number(e.amount)||0),0);
  const outstanding = await getOutstandingTotal(y);
  let annoTot = 0, meseTot = 0, oggiTot = 0;
  for (let mm=1; mm<=12; mm++) {
    const cal = await getCalendarByMonth(y, mm);
    for (const [iso, amountRaw] of cal.entries()) {
      const amount = amountRaw || 0;
      annoTot += amount;
      if (mm === m) meseTot += amount;
      if (iso === todayISO()) oggiTot += amount;
    }
  }
  annoTot = Number(annoTot.toFixed(2));
  meseTot = Number(meseTot.toFixed(2));
  oggiTot = Number(oggiTot.toFixed(2));

  els.kpiOggi.textContent = euro(oggiTot);
  els.kpiMese.textContent = euro(meseTot);
  els.kpiIncAnno.textContent = euro(annoTot);
  els.kpiFattMese.textContent = euro(kpis.fatturatoMese);
  els.kpiRestante.textContent = euro(outstanding);
  els.kpiMedia30.textContent = euro(kpis.mediaIncasso30);
  els.miniIncassiMese.textContent = euro(meseTot);
  els.miniSpeseMese.textContent = euro(monthExpenses);
  els.saldoVal.textContent = euro(meseTot - monthExpenses);
  els.statusText.textContent = "OK (SAFE: incassi normalizzati + clienti riconosciuti)";
  els.statIncassiCount.textContent = String(cache.incomes.length);
  els.statOrdersCount.textContent = String(cache.orders.length);
}

async function renderSideCalendar() {
  const y = sideCursor.getFullYear();
  const m = sideCursor.getMonth()+1;
  els.sideMonthTitle.textContent = `${MONTHS_LONG[m-1]} ${y}`;
  const cal = await getCalendarByMonth(y,m);
  const days = new Date(y,m,0).getDate();
  els.sideCalList.innerHTML = Array.from({length:days}, (_,i)=>{
    const day = i+1;
    const iso = `${y}-${String(m).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
    const amount = cal.get(iso) || 0;
    return `<button class="day-row" type="button" data-day="${iso}"><span class="day-left-inline">${String(day).padStart(2,'0')}/${String(m).padStart(2,'0')}</span><b class="day-right-inline">${euro(amount)}</b></button>`;
  }).join("");
  els.sideCalList.querySelectorAll('.day-row').forEach((btn)=>btn.addEventListener('click', ()=>openDayPopup(btn.dataset.day)));
}

async function renderChart() {
  const year = new Date().getFullYear();
  const series = await getYearlyMonthlySeries(year);
  const canvas = $("chartMain");
  if (!canvas || !window.Chart) return;
  try { chartMain?.destroy(); } catch {}
  chartMain = new Chart(canvas, {
    type: 'bar',
    data: { labels: MONTHS, datasets: [{ label:'Incassi', data: series.values, borderWidth:1 }] },
    options: {
      responsive:true, maintainAspectRatio:false,
      plugins:{
        legend:{ display:false },
        tooltip:{ callbacks:{ label:(ctx)=>euro(ctx.parsed.y || 0) } },
      },
      scales:{ y:{ beginAtZero:true, ticks:{ callback:(v)=>euro(v) } } }
    },
    plugins:[{ id:'value-labels', afterDatasetsDraw(chart){ const {ctx} = chart; ctx.save(); ctx.font='12px sans-serif'; ctx.fillStyle='#233'; ctx.textAlign='center'; const meta = chart.getDatasetMeta(0); meta.data.forEach((bar, idx)=>{ const v = series.values[idx]; if(!v) return; ctx.fillText(euro(v), bar.x, bar.y - 8); }); ctx.restore(); }}]
  });
}

async function boot() {
  await loadData();
  await refreshClients();
  await renderKpis();
  await renderSideCalendar();
  await renderChart();
}

async function saveManualIncome() {
  const dayISO = els.popup.dataset.day;
  if (!dayISO) return;
  const parsed = computeAutoAmount();
  let entries = parsed.entries;
  let manualTotal = Number(parsed.manualTotal || 0);
  const clientName = String(els.manualClient.value || '').trim();
  const amount = parseLocaleAmount((els.manualAmount || els.amount).value || '');

  if (!entries.length && clientName && amount > 0) {
    entries = [{ clientName, clientId:'', amount, note: `${clientName} ${amount}` }];
    manualTotal = amount;
  }

  const hasManualData = entries.length > 0 || manualTotal > 0 || clientName.length > 0 || String(els.note.value || '').trim().length > 0;

  if (!hasManualData) {
    closeDayPopup();
    await boot();
    return;
  }

  if (!entries.length || !(manualTotal > 0)) {
    alert('Inserisci almeno una riga nel dettaglio oppure cliente + importo.');
    return;
  }

  const note = entries.map((e)=>`${e.clientName} ${String(e.amount).replace('.', ',')}`).join('\n');
  await fs.set('incassi', dayISO, { date: dayISO, note, amount: manualTotal, entries, source:'manuale', updatedAt: fs.serverTimestamp() }, { merge:true });
  await fs.add('incassiHistory', { action:'SAVE_MANUALE_DAY', day: dayISO, entries, amount: manualTotal, at: fs.serverTimestamp() });
  closeDayPopup();
  await boot();
}

async function deleteManualIncome() {
  const dayISO = els.popup.dataset.day;
  if (!dayISO) return;
  await fs.set('incassi', dayISO, { note:'', amount:0, entries:[], updatedAt: fs.serverTimestamp() }, { merge:true });
  await fs.add('incassiHistory', { action:'CLEAR_MANUALE_DAY', day: dayISO, at: fs.serverTimestamp() });
  closeDayPopup();
  await boot();
}

els.saveBtn?.addEventListener('click', saveManualIncome);
els.deleteBtn?.addEventListener('click', deleteManualIncome);
els.sidePrevMonth?.addEventListener('click', async ()=>{ sideCursor.setMonth(sideCursor.getMonth()-1); await renderSideCalendar(); });
els.sideNextMonth?.addEventListener('click', async ()=>{ sideCursor.setMonth(sideCursor.getMonth()+1); await renderSideCalendar(); });
els.btnApriCalendarioTop?.addEventListener('click', ()=>{ location.href='incassi-calendario.html'; });
els.btnNuovoIncasso?.addEventListener('click', ()=> openBlankDayPopup(todayISO()));

$("cardKpiOggi")?.addEventListener('click', async ()=> openListModal('Incassi di oggi', renderIncomeRows(await listIncomesByDay(todayISO()))));

$("kpiRestante")?.closest('.incassi-card')?.addEventListener('click', async ()=> {
  const rows = (cache.orders || [])
    .filter((o)=>{
      const residual = Number(o?.residual);
      if (Number.isFinite(residual) && residual > 0) return true;
      const total = Number(o?.total) || 0;
      const deposit = Number(o?.deposit) || 0;
      const status = String(o?.status || '').toLowerCase();
      return (status === 'da_incassare' && total > 0) || (deposit > 0 && total > deposit);
    })
    .sort((a,b)=> String(b.createdAtISO || '').localeCompare(String(a.createdAtISO || '')));
  openListModal('Dettaglio restante da incassare', renderOutstandingRows(rows));
});

$("cardKpiMese")?.addEventListener('click', async ()=> { const d=new Date(); openListModal('Incassi del mese', renderIncomeRows(await listIncomesByMonth(d.getFullYear(), d.getMonth()+1))); });
// KPI anno solo visuale: non cliccabile
$("cardKpiFattMese")?.addEventListener('click', async ()=> {
  const d = new Date();
  const rows = cache.orders.filter((o)=>String(o.createdAtISO||'').startsWith(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-`));
  const html = rows.map((o)=>`<div class="modal-row"><div><div style="font-weight:900;">${escapeHtml(resolveOrderClientName(o) || 'Cliente')}</div><div class="meta">${fmtDate(o.createdAtISO)}</div></div><div class="amt">${euro(o.total)}</div></div>`).join('');
  openListModal('Ordini del mese', html);
});

function waitForAuth() {
  return new Promise(resolve => {
    const unsub = onAuthStateChanged(auth, user => { unsub(); resolve(user); });
  });
}

waitForAuth().then(() => {
  boot().catch((e) => { console.error(e); alert('Errore nel caricamento incassi.'); });
});
