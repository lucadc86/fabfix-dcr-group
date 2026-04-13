import { firestoreService as fs } from "./services/firestoreService.js?v=69fix";
import { listOrders } from "./services/orderService.js?v=69fix";
import { auth } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

// ===============================
// Helpers
// ===============================
function normName(v){
  return String(v ?? "").trim().toUpperCase().replace(/\s+/g, " ");
}

function parseEuroLike(v){
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const s = String(v ?? "").trim();
  if (!s) return 0;
  let cleaned = s.replace(/[^0-9,.-]/g, "");
  if (cleaned.includes(",")) {
    cleaned = cleaned.replace(/\./g, "").replace(",", ".");
  }
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

function toDateSafe(v){
  if (v && typeof v === 'object' && typeof v.toDate === 'function') return v.toDate();
  if (typeof v === 'string') {
    const d = new Date(v);
    if (!isNaN(d.getTime())) return d;
  }
  if (typeof v === 'number') {
    const d = new Date(v);
    if (!isNaN(d.getTime())) return d;
  }
  return null;
}

function startOfDay(d){
  const x = new Date(d);
  x.setHours(0,0,0,0);
  return x;
}

function startOfWeek(d){
  // ISO-like week: lunedì come inizio
  const x = startOfDay(d);
  const day = (x.getDay() + 6) % 7; // lun=0
  x.setDate(x.getDate() - day);
  return x;
}

function startOfMonth(d){
  const x = startOfDay(d);
  x.setDate(1);
  return x;
}

function startOfYear(d){
  const x = startOfDay(d);
  x.setMonth(0,1);
  return x;
}

function formatEUR(n){
  const num = Number(n || 0);
  return num.toLocaleString('it-IT', { style:'currency', currency:'EUR' });
}

const PRODUCT_DB_KEY = "fabfix:products:db:v1";
function loadProductDb(){
  try{
    const data = JSON.parse(localStorage.getItem(PRODUCT_DB_KEY) || '[]');
    return Array.isArray(data) ? data : [];
  }catch(_){ return []; }
}
function orderRows(raw){
  if (Array.isArray(raw?.rows)) return raw.rows;
  if (Array.isArray(raw?.items)) return raw.items;
  return [];
}
function buildProductDbFromOrders(orders){
  const map = new Map();
  (orders||[]).forEach((o)=>{
    orderRows(o).forEach((r)=>{
      const name = String(r.product || r.description || r.descrizione || r.name || '').trim();
      if(!name) return;
      const key = normName(name);
      const prev = map.get(key) || { name, normalizedName:key, soldQty:0, salesCount:0, lastPrice:0, updatedAtISO:null };
      prev.soldQty += Number(r.qty || r.quantita || 0);
      prev.salesCount += 1;
      prev.lastPrice = Number(r.price || r.prezzo || prev.lastPrice || 0);
      const d = orderDate(o);
      prev.updatedAtISO = d ? d.toISOString() : prev.updatedAtISO;
      map.set(key, prev);
    });
  });
  const list = Array.from(map.values());
  try{ localStorage.setItem(PRODUCT_DB_KEY, JSON.stringify(list)); }catch(_){}
  return list;
}
function fmtDateTime(v){
  const d = v ? new Date(v) : null;
  return d && !Number.isNaN(d.getTime()) ? d.toLocaleDateString('it-IT') : '—';
}
function ensureProductsBankSection(){
  if (document.getElementById('productsUniqueCount') && document.getElementById('tblProductsBank')) return;
  const anchor = document.querySelector('.clients-analytics') || document.querySelector('main') || document.body;
  if (!anchor) return;
  const section = document.createElement('section');
  section.className = 'products-bank-section';
  section.setAttribute('aria-label', 'Banca dati prodotti');
  section.innerHTML = `
    <div class="analytics-card wide products-bank-card">
      <div class="ac-title-row">
        <div class="ac-title">Banca dati prodotti</div>
        <button type="button" class="btn btn-primary btn-sm" id="openProductsBankBtn">Apri banca dati</button>
      </div>
      <div class="ac-body">
        <div class="products-bank-kpis">
          <div class="pb-kpi"><span>Prodotti unici</span><strong id="productsUniqueCount">0</strong></div>
          <div class="pb-kpi"><span>Pezzi venduti</span><strong id="productsSoldQty">0</strong></div>
          <div class="pb-kpi"><span>Vendite registrate</span><strong id="productsSalesCount">0</strong></div>
        </div>
        <div class="table-wrap">
          <table class="mini-table" id="tblProductsBank">
            <thead><tr><th>#</th><th>Prodotto</th><th>Pezzi</th><th>Vendite</th><th>Ultimo prezzo</th></tr></thead>
            <tbody></tbody>
          </table>
        </div>
      </div>
    </div>`;
  anchor.appendChild(section);
}

function renderProductsBank(){
  const list = buildProductDbFromOrders(_orders).slice().sort((a,b)=> (Number(b.soldQty||0)-Number(a.soldQty||0)) || (Number(b.salesCount||0)-Number(a.salesCount||0)) || String(a.name||'').localeCompare(String(b.name||'')));
  const uniqueEl = document.getElementById('productsUniqueCount');
  const soldEl = document.getElementById('productsSoldQty');
  const salesEl = document.getElementById('productsSalesCount');
  const tbody = document.querySelector('#tblProductsBank tbody');
  if (uniqueEl) uniqueEl.textContent = String(list.length);
  if (soldEl) soldEl.textContent = String(list.reduce((s,x)=> s + Number(x.soldQty||0), 0));
  if (salesEl) salesEl.textContent = String(list.reduce((s,x)=> s + Number(x.salesCount||0), 0));
  if (tbody){
    tbody.innerHTML = list.length ? list.slice(0,8).map((p, idx)=> `
      <tr><td>${idx+1}</td><td>${escapeHtml(p.name || '—')}</td><td>${Number(p.soldQty||0)}</td><td>${Number(p.salesCount||0)}</td><td>${formatEUR(Number(p.lastPrice || p.price || 0))}</td></tr>`).join('') : `<tr><td colspan="5" style="opacity:.65;">Nessun prodotto registrato</td></tr>`;
  }
}
function openProductsBank(){
  const list = buildProductDbFromOrders(_orders).slice().sort((a,b)=> (Number(b.soldQty||0)-Number(a.soldQty||0)) || (Number(b.salesCount||0)-Number(a.salesCount||0)) || String(a.name||'').localeCompare(String(b.name||'')));
  const html = list.length ? `
    <div class="products-modal-summary">
      <div><strong>Prodotti unici:</strong> ${list.length}</div>
      <div><strong>Pezzi venduti:</strong> ${list.reduce((s,x)=> s + Number(x.soldQty||0), 0)}</div>
      <div><strong>Vendite registrate:</strong> ${list.reduce((s,x)=> s + Number(x.salesCount||0), 0)}</div>
    </div>
    <div class="table-wrap"><table class="mini-table"><thead><tr><th>#</th><th>Prodotto</th><th>Pezzi</th><th>Vendite</th><th>Ultimo prezzo</th><th>Agg.</th></tr></thead><tbody>
      ${list.map((p, idx)=> `<tr><td>${idx+1}</td><td>${escapeHtml(p.name || '—')}</td><td>${Number(p.soldQty||0)}</td><td>${Number(p.salesCount||0)}</td><td>${formatEUR(Number(p.lastPrice || p.price || 0))}</td><td>${fmtDateTime(p.updatedAtISO)}</td></tr>`).join('')}
    </tbody></table></div>` : "<div style='opacity:.7;'>Nessun prodotto registrato. I prodotti vengono salvati automaticamente quando salvi un ordine.</div>";
  openClientsModal('Banca dati prodotti', html);
}

function orderClientKey(o){
  if (o?.clientId) return o.clientId;
  const candidates = [
    o?.clientName,
    o?.clienteName,
    o?.nomeCliente,
    o?.cliente,
    o?.customerName,
    o?.customer,
    o?.client?.name,
    o?.client?.nome,
  ];
  for (const c of candidates) {
    const k = normName(c);
    if (k) return k;
  }
  return null;
}

// ===============================
// DOM
// ===============================
const els = {
  searchInput: document.getElementById('searchInput'),
  newClientBtn: document.getElementById('newClientBtn'),
  list: document.getElementById('clientsSidebarList'),
  grandTotal: document.getElementById('grandTotal'),

  kpiOrdersQty: document.getElementById('kpiOrdersQty'),
  kpiOrdersHint: document.getElementById('kpiOrdersHint'),
  kpiRevenue: document.getElementById('kpiRevenue'),
  kpiRevenueHint: document.getElementById('kpiRevenueHint'),
  kpiOrdersMonthQty: document.getElementById('kpiOrdersMonthQty'),
  kpiRevenueMonth: document.getElementById('kpiRevenueMonth'),
  kpiClientsServed: document.getElementById('kpiClientsServed'),
  kpiOrdersYearQty: document.getElementById('kpiOrdersYearQty'),
  kpiRevenueYear: document.getElementById('kpiRevenueYear'),
  pills: Array.from(document.querySelectorAll('.pill[data-period]')),
};

let _clients = [];
let _orders = [];
let _clientNameById = new Map();
let _period = 'day';
let _clientSort = 'revenue'; // revenue | name | lastVisit | orders
let _selectedClientId = null;

// Per-client derived stats (computed once after loadAll)
let _clientStats = new Map(); // clientId -> { lastVisit, orderCount, totalRevenue, activityStatus, isVip }

// ===============================
// Client stats computation
// ===============================
function computeClientStats(){
  const now = new Date();
  const statsMap = new Map();

  // Accumulate per-client
  _clients.forEach(c => {
    statsMap.set(c.id, { lastVisit: null, orderCount: 0, totalRevenue: 0 });
  });

  _orders.forEach(o => {
    let key = orderClientKey(o);
    if (!key) return;
    // try to map normalized name to id
    const c = _clients.find(cl => cl.id === key || normName(cl.name) === key);
    if (!c) return;
    const id = c.id;
    if (!statsMap.has(id)) statsMap.set(id, { lastVisit: null, orderCount: 0, totalRevenue: 0 });
    const s = statsMap.get(id);
    const d = orderDate(o);
    if (d && (!s.lastVisit || d > s.lastVisit)) s.lastVisit = d;
    s.orderCount++;
    s.totalRevenue += parseEuroLike(o.total);
  });

  // VIP threshold: top 20% by revenue among clients with orders
  const revenues = Array.from(statsMap.values())
    .map(s => s.totalRevenue)
    .filter(v => v > 0)
    .sort((a, b) => b - a);
  const vipThreshold = revenues.length > 0 ? revenues[Math.floor(revenues.length * 0.20)] || revenues[revenues.length - 1] : Infinity;

  statsMap.forEach((s, id) => {
    // Activity status
    if (!s.lastVisit) {
      s.activityStatus = 'unknown';
    } else {
      const daysSince = Math.floor((now - s.lastVisit) / (1000 * 60 * 60 * 24));
      s.daysSinceVisit = daysSince;
      if (daysSince <= 30) s.activityStatus = 'active';
      else if (daysSince <= 90) s.activityStatus = 'warning';
      else s.activityStatus = 'inactive';
    }
    s.isVip = revenues.length > 0 && s.totalRevenue >= vipThreshold && s.totalRevenue > 0;
  });

  _clientStats = statsMap;
}

// ===============================
// UI
// ===============================
function renderClientList(clients){
  els.list.innerHTML = '';

  // Apply sort
  let sorted = [...clients];
  if (_clientSort === 'name') {
    sorted.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'it'));
  } else if (_clientSort === 'lastVisit') {
    sorted.sort((a, b) => {
      const sa = _clientStats.get(a.id)?.lastVisit;
      const sb = _clientStats.get(b.id)?.lastVisit;
      if (!sa && !sb) return 0;
      if (!sa) return 1;
      if (!sb) return -1;
      return sb - sa;
    });
  } else if (_clientSort === 'orders') {
    sorted.sort((a, b) => (_clientStats.get(b.id)?.orderCount || 0) - (_clientStats.get(a.id)?.orderCount || 0));
  } else {
    // revenue (default)
    sorted.sort((a, b) => (b.total || 0) - (a.total || 0));
  }

  sorted.forEach(c => {
    const stats = _clientStats.get(c.id) || {};
    const actClass = { active: 'dot-active', warning: 'dot-warning', inactive: 'dot-inactive', unknown: 'dot-unknown' }[stats.activityStatus] || 'dot-unknown';
    const actTitle = { active: 'Attivo (< 30 gg)', warning: 'Attenzione (30-90 gg)', inactive: 'Inattivo (> 90 gg)', unknown: 'Nessun ordine' }[stats.activityStatus] || '';
    const lastVisitStr = stats.lastVisit ? stats.lastVisit.toLocaleDateString('it-IT') : '—';
    const vipBadge = stats.isVip ? '<span class="vip-badge" title="VIP: top 20% per fatturato">VIP</span>' : '';

    const row = document.createElement('div');
    row.className = 'client-item' + (_selectedClientId === c.id ? ' client-item--selected' : '');
    row.dataset.name = (c.name || '').toLowerCase();
    row.dataset.city = (c.city || '').toLowerCase();
    row.dataset.clientId = c.id;
    row.innerHTML = `
      <div class="left" style="min-width:0;flex:1 1 auto;">
        <div class="client-name-row">
          <span class="activity-dot ${actClass}" title="${actTitle}"></span>
          <span class="name">${escapeHtml(c.name || '—')}</span>
          ${vipBadge}
        </div>
        <div class="meta">${escapeHtml(c.city || '')} • ultima visita: ${lastVisitStr}</div>
      </div>
      <div class="right">
        <div class="total">${formatEUR(c.total || 0)}</div>
        <div class="orders-count">${stats.orderCount || 0} ordini</div>
      </div>
    `;
    row.addEventListener('click', () => openClientDetail(c.id));
    els.list.appendChild(row);
  });
}

function escapeHtml(s){
  return String(s ?? '').replace(/[&<>"]/g, (m)=>({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'
  }[m]));
}

// ===============================
// Client Detail Panel
// ===============================
function openClientDetail(clientId){
  _selectedClientId = clientId;
  // Re-render list to highlight selected
  const q = (els.searchInput?.value || '').toLowerCase();
  document.querySelectorAll('.client-item').forEach(row => {
    row.classList.toggle('client-item--selected', row.dataset.clientId === clientId);
  });

  const panel = document.getElementById('clientDetailPanel');
  if (!panel) return;

  const client = _clients.find(c => c.id === clientId);
  if (!client) { panel.classList.add('hidden'); return; }

  const stats = _clientStats.get(clientId) || {};
  const initials = (client.name || '?').split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();

  // Last 5 orders for this client
  const clientOrders = _orders
    .filter(o => {
      const key = orderClientKey(o);
      const c = _clients.find(cl => cl.id === key || normName(cl.name) === key);
      return c?.id === clientId;
    })
    .sort((a, b) => (orderDate(b)?.getTime() || 0) - (orderDate(a)?.getTime() || 0))
    .slice(0, 5);

  const ordersHtml = clientOrders.length ? clientOrders.map(o => {
    const d = orderDate(o);
    const dateStr = d ? d.toLocaleDateString('it-IT') : '—';
    const href = `/order.html?orderId=${encodeURIComponent(o.__id || o.id || '')}${clientId ? `&clientId=${encodeURIComponent(clientId)}` : ''}`;
    return `<div class="cdp-order-row">
      <span class="cdp-order-date">${escapeHtml(dateStr)}</span>
      <span class="cdp-order-total">${formatEUR(parseEuroLike(o.total))}</span>
      <a href="${href}" class="cdp-order-link" title="Apri ordine">→</a>
    </div>`;
  }).join('') : '<div class="cdp-no-orders">Nessun ordine registrato</div>';

  const actLabel = { active: '🟢 Attivo', warning: '🟡 Attenzione', inactive: '🔴 Inattivo', unknown: '⚫ Nessun ordine' }[stats.activityStatus] || '—';
  const vipBadgeHtml = stats.isVip ? '<span class="vip-badge" style="font-size:13px;">VIP</span>' : '';

  panel.innerHTML = `
    <div class="cdp-header">
      <div class="cdp-avatar">${escapeHtml(initials)}</div>
      <div class="cdp-info">
        <div class="cdp-name">${escapeHtml(client.name || '—')} ${vipBadgeHtml}</div>
        <div class="cdp-city">${escapeHtml(client.city || '')} ${actLabel}</div>
      </div>
      <button class="cdp-close" id="cdpClose" title="Chiudi dettaglio">✕</button>
    </div>
    <div class="cdp-stats">
      <div class="cdp-stat">
        <div class="cdp-stat-val">${formatEUR(client.total || 0)}</div>
        <div class="cdp-stat-label">Fatturato totale</div>
      </div>
      <div class="cdp-stat">
        <div class="cdp-stat-val">${stats.orderCount || 0}</div>
        <div class="cdp-stat-label">Visite totali</div>
      </div>
      <div class="cdp-stat">
        <div class="cdp-stat-val">${stats.lastVisit ? stats.lastVisit.toLocaleDateString('it-IT') : '—'}</div>
        <div class="cdp-stat-label">Ultima visita</div>
      </div>
      <div class="cdp-stat">
        <div class="cdp-stat-val">${stats.orderCount > 0 ? formatEUR((client.total || 0) / stats.orderCount) : '—'}</div>
        <div class="cdp-stat-label">Scontrino medio</div>
      </div>
    </div>
    <div class="cdp-section-title">Ultimi ordini</div>
    <div class="cdp-orders">${ordersHtml}</div>
    <div class="cdp-actions">
      <a href="client.html?clientId=${encodeURIComponent(clientId)}" class="cdp-btn cdp-btn-primary">📋 Scheda completa</a>
      <a href="order.html?clientId=${encodeURIComponent(clientId)}" class="cdp-btn cdp-btn-secondary">➕ Nuovo ordine</a>
    </div>
  `;
  panel.classList.remove('hidden');

  document.getElementById('cdpClose')?.addEventListener('click', () => {
    panel.classList.add('hidden');
    _selectedClientId = null;
    document.querySelectorAll('.client-item').forEach(r => r.classList.remove('client-item--selected'));
  });
}

function filterClientList(){
  const q = (els.searchInput?.value || '').toLowerCase();
  document.querySelectorAll('.client-item').forEach(row => {
    row.style.display = (row.dataset.name.includes(q) || row.dataset.city.includes(q)) ? '' : 'none';
  });
}

function calcPeriodBounds(now, period){
  const n = startOfDay(now);
  if (period === 'day') {
    return { start: startOfDay(n), end: new Date(startOfDay(n).getTime() + 24*3600*1000) };
  }
  if (period === 'week') {
    const s = startOfWeek(n);
    return { start: s, end: new Date(s.getTime() + 7*24*3600*1000) };
  }
  if (period === 'month') {
    const s = startOfMonth(n);
    const e = new Date(s);
    e.setMonth(e.getMonth() + 1);
    return { start: s, end: e };
  }
  // year
  const s = startOfYear(n);
  const e = new Date(s);
  e.setFullYear(e.getFullYear() + 1);
  return { start: s, end: e };
}

function computeOrdersKpis(){
  const now = new Date();

  // KPI periodo selezionato
  const { start, end } = calcPeriodBounds(now, _period);
  const inPeriod = _orders.filter(o => {
    const d = toDateSafe(o.createdAtISO || o.createdAt);
    if (!d) return false;
    return d >= start && d < end;
  });
  const qty = inPeriod.length;
  const revenue = inPeriod.reduce((s,o)=> s + parseEuroLike(o.total), 0);

  els.kpiOrdersQty.textContent = String(qty);
  els.kpiRevenue.textContent = formatEUR(revenue);

  const hintLabel = (_period === 'day') ? 'Oggi' : (_period === 'week') ? 'Settimana corrente' : (_period === 'month') ? 'Mese corrente' : 'Anno corrente';
  els.kpiOrdersHint.textContent = hintLabel;
  els.kpiRevenueHint.textContent = hintLabel;

  // KPI mese
  const m = calcPeriodBounds(now, 'month');
  const inMonth = _orders.filter(o => {
    const d = toDateSafe(o.createdAtISO || o.createdAt);
    return d && d >= m.start && d < m.end;
  });
  els.kpiOrdersMonthQty.textContent = String(inMonth.length);
  els.kpiRevenueMonth.textContent = formatEUR(inMonth.reduce((s,o)=> s + parseEuroLike(o.total), 0));

  // KPI anno
  const y = calcPeriodBounds(now, 'year');
  const inYear = _orders.filter(o => {
    const d = toDateSafe(o.createdAtISO || o.createdAt);
    return d && d >= y.start && d < y.end;
  });
  els.kpiOrdersYearQty.textContent = String(inYear.length);
  els.kpiRevenueYear.textContent = formatEUR(inYear.reduce((s,o)=> s + parseEuroLike(o.total), 0));
  const servedSet = new Set(inYear.map(o => orderClientKey(o)).filter(Boolean));
  if (els.kpiClientsServed) els.kpiClientsServed.textContent = String(servedSet.size);

  // KPI: Top cliente mese
  const topClientEl = document.getElementById('kpiTopClientMonth');
  if (topClientEl) {
    const revenueByClient = new Map();
    inMonth.forEach(o => {
      const key = orderClientKey(o);
      if (!key) return;
      const name = o.clientName || o.nomeCliente || _clientNameById.get(key) || key;
      revenueByClient.set(key, { name, total: (revenueByClient.get(key)?.total || 0) + parseEuroLike(o.total) });
    });
    if (revenueByClient.size > 0) {
      const top = Array.from(revenueByClient.values()).sort((a,b)=>b.total-a.total)[0];
      topClientEl.textContent = escapeHtml(top.name);
      topClientEl.title = formatEUR(top.total);
    } else {
      topClientEl.textContent = '—';
    }
  }

  // KPI: Ritorno clienti (clients who ordered both last month AND this month)
  const retEl = document.getElementById('kpiRetentionRate');
  const retSubEl = document.getElementById('kpiRetentionSub');
  if (retEl) {
    const prevMonthStart = new Date(m.start); prevMonthStart.setMonth(prevMonthStart.getMonth() - 1);
    const inLastMonth = _orders.filter(o => {
      const d = toDateSafe(o.createdAtISO || o.createdAt);
      return d && d >= prevMonthStart && d < m.start;
    });
    const thisMonthClients = new Set(inMonth.map(o => orderClientKey(o)).filter(Boolean));
    const lastMonthClients = new Set(inLastMonth.map(o => orderClientKey(o)).filter(Boolean));
    const returned = [...thisMonthClients].filter(k => lastMonthClients.has(k)).length;
    const rate = lastMonthClients.size > 0 ? Math.round((returned / lastMonthClients.size) * 100) : null;
    retEl.textContent = rate !== null ? `${rate}%` : '—';
    if (retSubEl) retSubEl.textContent = `${returned} su ${lastMonthClients.size} del mese scorso`;
  }
}

function setPeriod(p){
  _period = p;
  els.pills.forEach(btn => btn.classList.toggle('active', btn.dataset.period === p));
  computeOrdersKpis();
  try{ renderClientAnalytics({ clients: _clients, orders: _orders }); }catch(e){ console.warn('analytics error', e); }
  try{ ensureProductsBankSection(); renderProductsBank(); }catch(e){ console.warn('products bank error', e); }
}



// ===============================
// Modal liste (Clienti)
// ===============================
const clientsModal = document.getElementById('clientsModal');
const clientsModalTitle = document.getElementById('clientsModalTitle');
const clientsModalBody = document.getElementById('clientsModalBody');
const clientsModalClose = document.getElementById('clientsModalClose');

function openClientsModal(title, html){
  if(!clientsModal) return;
  clientsModalTitle.textContent = title;
  clientsModalBody.innerHTML = html || "<div style='opacity:.7;'>Nessun dato.</div>";
  clientsModal.classList.remove('hidden');
}
function closeClientsModal(){
  clientsModal?.classList.add('hidden');
}
clientsModalClose?.addEventListener('click', closeClientsModal);
clientsModal?.addEventListener('click', (e)=>{ if(e.target === clientsModal) closeClientsModal(); });

function orderDate(o){
  const v = o.createdAtISO ?? o.createdAt ?? o.date ?? o.data ?? o.day ?? o.giorno;
  if(v && typeof v.toDate === 'function') return v.toDate();
  const d = v ? new Date(v) : null;
  if(!d || Number.isNaN(d.getTime())) return null;
  return d;
}
function dateKey(d){
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function fmtIt(d){
  return d.toLocaleDateString('it-IT');
}
function orderClientName(o){
  return (o.clientName || o.nomeCliente || o.customerName || o.name || '').toString();
}
function orderPaymentLabel(o){
  const p = (o.paymentStatus || o.pagamento || o.statoPagamento || '').toString();
  if(p === 'incassato') return 'Incassato';
  if(p === 'acconto') return 'Acconto';
  if(p === 'da_incassare') return 'Da incassare';
  return p || '—';
}

function renderOrdersList(list){
  if(!list || list.length === 0) return "<div style='opacity:.7;'>Nessun ordine.</div>";
  const rows = list.map((o, idx) => {
    const d = orderDate(o);
    const total = parseEuroLike(o.total);
    let client = orderClientName(o);
    // Richiesta: mostra almeno i nomi dei clienti nei primi 5 ordini
    if(!client && idx < 5){
      const cid = (o.clientId || '').toString();
      if(cid && _clientNameById.has(cid)) client = _clientNameById.get(cid);
    }
    client = client || '(cliente)';
    const status = orderPaymentLabel(o);
    const id = o.__id;
    const cid = o.clientId || '';
    const href = `/order.html?orderId=${encodeURIComponent(id)}${cid ? `&clientId=${encodeURIComponent(cid)}` : ''}`;
    return `
      <div class="modal-row">
        <div style="min-width:0;">
          <div style="font-weight:900;">${client}</div>
          <div class="meta">${d ? fmtIt(d) : ''} • ${status}</div>
        </div>
        <div style="display:flex;align-items:center;gap:8px;flex-shrink:0;">
          <div class="amt">${formatEUR(total)}</div>
          <a href="${href}" style="text-decoration:none;">
            <button type="button">Apri</button>
          </a>
        </div>
      </div>
    `;
  }).join('');
  return rows;
}


// ===============================
// Data load
// ===============================
async function loadAll(){
  els.list.innerHTML = '<div style="padding:10px;opacity:.7;">Caricamento…</div>';

  // 🔒 SAFE: tutte le letture passano dai services (mai Firestore diretto in UI)
  const [clientsArr, ordersArr] = await Promise.all([
    fs.getAll('clients'),
    listOrders(),
  ]);

  // name->id for legacy orders without clientId
  const nameToId = new Map();
  clientsArr.forEach(c => {
    const k = normName(c.name || c.nome);
    if (k && !nameToId.has(k)) nameToId.set(k, c.id);
  });

  const totalsByClient = {};
  let totalGenerale = 0;

  _orders = ordersArr.map(o => ({ __id: o.id || o.__id, ...o }));
  _orders.forEach(o => {
    let key = orderClientKey(o);
    if (!key) return;
    // translate normalized name to clientId when possible
    const mapped = nameToId.get(key);
    if (mapped) key = mapped;
    const value = parseEuroLike(o.total);
    totalsByClient[key] = (totalsByClient[key] || 0) + value;
    totalGenerale += value;
  });

  _clients = clientsArr.map(c => {
    const name = c.name || '';
    const city = c.city || c.comune || c.town || '';
    const total = (totalsByClient[c.id] || totalsByClient[normName(name)] || 0);
    return { id: c.id, name, city, total };
  });

  // cache per lookup rapido nei popup (ordini -> nome cliente)
  _clientNameById = new Map(_clients.map(c => [c.id, c.name]));

  // compute per-client stats (lastVisit, orderCount, VIP, activity)
  computeClientStats();

  _clients.sort((a,b)=> (b.total||0) - (a.total||0));
  els.grandTotal.textContent = totalGenerale.toFixed(2);

  // prepare export data
  window._exportClientiData = _clients.map(c => {
    const s = _clientStats.get(c.id) || {};
    return { name: c.name, email: '', phone: '', totalOrders: c.total, city: c.city, orderCount: s.orderCount || 0, lastVisit: s.lastVisit ? s.lastVisit.toLocaleDateString('it-IT') : '' };
  });

  renderClientList(_clients);
  computeOrdersKpis();
  try{ renderClientAnalytics({ clients: _clients, orders: _orders }); }catch(e){ console.warn('analytics error', e); }
  try{ ensureProductsBankSection(); renderProductsBank(); }catch(e){ console.warn('products bank error', e); }
}


// ===============================
// Events
// ===============================
els.newClientBtn?.addEventListener('click', () => {
  window.location.href = 'client.html';
});

els.searchInput?.addEventListener('input', filterClientList);

els.pills.forEach(btn => {
  btn.addEventListener('click', () => setPeriod(btn.dataset.period));
});

document.getElementById('clientSortSelect')?.addEventListener('change', (e) => {
  _clientSort = e.target.value;
  renderClientList(_clients);
  filterClientList();
});


// KPI click -> liste ordini
function openOrdersToday(){
  const now = new Date(); now.setHours(0,0,0,0);
  const end = new Date(now); end.setHours(23,59,59,999);
  const list = _orders
    .map(o => ({...o, __id: o.__id}))
    .filter(o => {
      const d = orderDate(o);
      return d && d.getTime() >= now.getTime() && d.getTime() <= end.getTime();
    })
    .sort((a,b)=> (orderDate(b)?.getTime()||0) - (orderDate(a)?.getTime()||0));
  openClientsModal("Ordini di oggi", renderOrdersList(list));
}
function openRevenueToday(){
  openOrdersToday(); // stessa lista, mostra importi
  clientsModalTitle.textContent = "Fatturato di oggi (ordini)";
}
function openOrdersMonth(){
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1, 0,0,0,0);
  const end = new Date(now.getFullYear(), now.getMonth()+1, 0, 23,59,59,999);
  const list = _orders
    .filter(o => {
      const d = orderDate(o);
      return d && d.getTime() >= start.getTime() && d.getTime() <= end.getTime();
    })
    .sort((a,b)=> (orderDate(b)?.getTime()||0) - (orderDate(a)?.getTime()||0));
  openClientsModal("Ordini del mese", renderOrdersList(list));
}
function openRevenueMonth(){
  openOrdersMonth();
  clientsModalTitle.textContent = "Fatturato mese (ordini)";
}

document.getElementById('cardOrdersToday')?.addEventListener('click', openOrdersToday);
document.getElementById('cardRevenueToday')?.addEventListener('click', openRevenueToday);
document.getElementById('cardOrdersMonth')?.addEventListener('click', openOrdersMonth);
document.getElementById('cardRevenueMonth')?.addEventListener('click', openRevenueMonth);


function openOrdersYear(){
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 1, 0,0,0,0);
  const end = new Date(now.getFullYear(), 11, 31, 23,59,59,999);
  const list = _orders
    .filter(o => {
      const d = orderDate(o);
      return d && d.getTime() >= start.getTime() && d.getTime() <= end.getTime();
    })
    .sort((a,b)=> (orderDate(b)?.getTime()||0) - (orderDate(a)?.getTime()||0));
  openClientsModal("Ordini anno " + now.getFullYear(), renderOrdersList(list));
}

function clickOrEnter(el, fn){
  if(!el) return;
  el.addEventListener("click", fn);
  el.addEventListener("keydown", (e)=>{
    if(e.key === "Enter" || e.key === " ") fn();
  });
}

clickOrEnter(document.getElementById("cardOrdersYear"), openOrdersYear);

// Boot — attendi che Firebase Auth ripristini la sessione (async) prima di
// leggere Firestore; senza questo le regole vedono l'utente come non autenticato.
function waitForAuth() {
  return new Promise(resolve => {
    const unsub = onAuthStateChanged(auth, user => {
      unsub();
      resolve(user);
    });
  });
}

waitForAuth().then(() => {
  loadAll().catch(err => {
    console.error(err);
    alert('Errore nel caricamento dei clienti.');
  });
});




function getOrderDate(o){
  return orderDate(o);
}

function getOrderTotal(o){
  return parseEuroLike(o?.total ?? o?.totale ?? o?.amount ?? 0);
}
// =========================
// ANALYTICS (Dashboard stile screenshot)
// =========================
let __clientCharts = [];

function destroyClientCharts(){
  try{ __clientCharts.forEach(c=>c && c.destroy && c.destroy()); }catch(_){ }
  __clientCharts = [];
}

function buildClientAnalyticsData(clients, orders){
  const now = new Date();
  const year = now.getFullYear();
  const labels = ["01","02","03","04","05","06","07","08","09","10","11","12"];
  const monthlyRevenue = new Array(12).fill(0);
  const byRevenue = new Map();
  const byOrders = new Map();

  for (const raw of orders || []) {
    const d = getOrderDate(raw);
    if (!d || d.getFullYear() !== year) continue;
    const total = getOrderTotal(raw);
    if (!(total > 0)) continue;
    monthlyRevenue[d.getMonth()] += total;
    const key = raw.clientId || orderClientKey(raw) || normName(raw.clientName || raw.nomeCliente || raw.cliente || '');
    const label = (raw.clientName || raw.nomeCliente || raw.cliente || _clientNameById.get(raw.clientId) || '').toString().trim() || '(cliente)';
    if (!key) continue;
    const prevR = byRevenue.get(key) || { name: label, total: 0 };
    prevR.total += total;
    if (!prevR.name && label) prevR.name = label;
    byRevenue.set(key, prevR);
    const prevO = byOrders.get(key) || { name: label, count: 0 };
    prevO.count += 1;
    if (!prevO.name && label) prevO.name = label;
    byOrders.set(key, prevO);
  }

  const topRevenue = Array.from(byRevenue.values())
    .sort((a,b)=>b.total-a.total)
    .slice(0,10)
    .map((r, idx)=>({ n: idx+1, name: r.name || '(cliente)', total: Number(r.total.toFixed(2)), totalFmt: formatEUR(r.total), count: byOrders.get(Array.from(byRevenue.keys())[idx])?.count || 0 }));

  const topOrders = Array.from(byOrders.entries())
    .sort((a,b)=>b[1].count-a[1].count)
    .slice(0,10)
    .map(([key, r], idx)=>({ n: idx+1, name: r.name || '(cliente)', count: r.count, totalFmt: formatEUR(byRevenue.get(key)?.total || 0) }));

  return {
    labels,
    monthlyRevenue: monthlyRevenue.map(v=>Number(v.toFixed(2))),
    topRevenue,
    topOrders,
  };
}

function renderClientAnalytics({ clients, orders }){
  const wrap = document.getElementById("clientsAnalytics");
  if(!wrap) return;
  destroyClientCharts();

  const data = buildClientAnalyticsData(clients || [], orders || []);

  const rev = document.getElementById('chartRevenue');
  if(rev && window.Chart){
    try{ rev.height = 220; }catch(_){ }
    const ctx = rev.getContext('2d');
    if(window.ChartDataLabels) Chart.register(ChartDataLabels);
    __clientCharts.push(new Chart(ctx,{
      type:'bar',
      data:{ labels: data.labels, datasets:[{ label:'Fatturato', data: data.monthlyRevenue, borderWidth:1, backgroundColor:'rgba(59,130,246,0.55)', borderColor:'rgba(59,130,246,0.95)' }] },
      options:{
        responsive:true,
        maintainAspectRatio:false,
        plugins:{
          legend:{ display:false },
          tooltip:{ callbacks:{ label:(ctx)=> formatEUR(ctx.parsed.y || 0) } },
          datalabels:{
            display:(ctx)=>ctx.dataset.data[ctx.dataIndex]>0,
            anchor:'end', align:'top',
            formatter:(v)=>formatEUR(v),
            font:{size:10,weight:'700'},
            color:'rgba(59,130,246,0.9)',
            clamp:true, clip:false, padding:{top:2}
          }
        },
        scales:{ y:{ beginAtZero:true, ticks:{ callback:(v)=> formatEUR(v) } } }
      }
    }));
  }

  const tblRev = document.querySelector('#tblTopRevenue tbody');
  if(tblRev){
    tblRev.innerHTML = data.topRevenue.length
      ? data.topRevenue.map((r)=>`<tr><td>${r.n}</td><td>${escapeHtml(r.name)}</td><td>${escapeHtml(r.totalFmt)}</td><td>${r.count||''}</td></tr>`).join('')
      : `<tr><td colspan="4" style="opacity:.65;">Nessun dato</td></tr>`;
  }
  const tblOrd = document.querySelector('#tblTopOrders tbody');
  if(tblOrd){
    tblOrd.innerHTML = data.topOrders.length
      ? data.topOrders.map((r)=>`<tr><td>${r.n}</td><td>${escapeHtml(r.name)}</td><td>${r.count}</td><td>${escapeHtml(r.totalFmt)}</td></tr>`).join('')
      : `<tr><td colspan="4" style="opacity:.65;">Nessun dato</td></tr>`;
  }

  // Inactive clients table
  const tblInactive = document.querySelector('#tblInactiveClients tbody');
  const inactiveBadge = document.getElementById('inactiveCountBadge');
  if (tblInactive) {
    const now90 = new Date();
    const cutoff = new Date(now90.getTime() - 90 * 24 * 60 * 60 * 1000);
    const inactive = _clients
      .map(c => {
        const s = _clientStats.get(c.id) || {};
        if (!s.lastVisit) return null; // no orders: not shown
        if (s.lastVisit > cutoff) return null;
        const daysSince = Math.floor((now90 - s.lastVisit) / (1000 * 60 * 60 * 24));
        return { name: c.name, lastVisit: s.lastVisit, daysSince, total: c.total };
      })
      .filter(Boolean)
      .sort((a, b) => b.daysSince - a.daysSince);

    if (inactiveBadge) inactiveBadge.textContent = String(inactive.length);
    tblInactive.innerHTML = inactive.length
      ? inactive.slice(0, 20).map((r, i) => `<tr>
          <td>${i + 1}</td>
          <td>${escapeHtml(r.name)}</td>
          <td>${r.lastVisit.toLocaleDateString('it-IT')}</td>
          <td><span class="days-ago-badge">${r.daysSince} gg</span></td>
          <td>${formatEUR(r.total)}</td>
        </tr>`).join('')
      : `<tr><td colspan="5" style="opacity:.65;">Nessun cliente inattivo — ottimo!</td></tr>`;
  }
}


ensureProductsBankSection();
clickOrEnter(document.getElementById('openProductsBankBtn'), openProductsBank);
