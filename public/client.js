import {
  db,
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  orderBy,
  addDoc,
  deleteDoc,
  updateDoc,
  serverTimestamp,
  auth,
} from './firebase.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

// ===============================
// Helpers
// ===============================
function toDateSafe(v) {
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

function formatDateIT(d) {
  if (!d) return '';
  return d.toLocaleDateString('it-IT');
}

function formatEUR(n) {
  const num = Number(n || 0);
  return num.toLocaleString('it-IT', { style: 'currency', currency: 'EUR' });
}

function parseEuroLike(v){
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  const s = String(v ?? '').trim();
  if (!s) return 0;
  let cleaned = s.replace(/[^0-9,.-]/g, '');
  if (cleaned.includes(',')) cleaned = cleaned.replace(/\./g, '').replace(',', '.');
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

function getParam(name) {
  const url = new URL(window.location.href);
  return url.searchParams.get(name);
}

function startOfYear(d){
  const x = new Date(d);
  x.setMonth(0,1);
  x.setHours(0,0,0,0);
  return x;
}

function nextYear(d){
  const x = startOfYear(d);
  x.setFullYear(x.getFullYear() + 1);
  return x;
}

// Copiato (in forma compatta) dalla logica ordine: elimina eventuali incassi auto collegati all'ordine
async function deleteIncassiByOrderId(orderId){
  try{
    const deletions = [];
    deletions.push(deleteDoc(doc(db, 'incassi', `${orderId}_incasso`)).catch(()=>null));
    deletions.push(deleteDoc(doc(db, 'incassi', `${orderId}_acconto`)).catch(()=>null));
    deletions.push(deleteDoc(doc(db, 'incassi', `${orderId}_incasso_totale`)).catch(()=>null));
    deletions.push(deleteDoc(doc(db, 'incassi', `${orderId}__saldo`)).catch(()=>null));
    deletions.push(deleteDoc(doc(db, 'incassi', `${orderId}__incasso`)).catch(()=>null));
    deletions.push(deleteDoc(doc(db, 'incassi', `${orderId}__acconto`)).catch(()=>null));

    // fallback: se in passato sono stati creati con chiavi diverse ma con campo orderId
    try{
      const qx = query(collection(db, 'incassi'), where('orderId', '==', orderId));
      const snap = await getDocs(qx);
      snap.forEach(d => deletions.push(deleteDoc(doc(db, 'incassi', d.id)).catch(()=>null)));
    }catch(e){
      // ignore
    }

    await Promise.all(deletions);
  }catch(e){
    console.warn('Impossibile eliminare incassi collegati:', e);
  }
}

// ===============================
// DOM
// ===============================
const els = {
  title: document.getElementById('clientName'),
  sub: document.getElementById('clientSub'),
  name: document.getElementById('name'),
  email: document.getElementById('email'),
  phone: document.getElementById('phone'),
  city: document.getElementById('city'),
  vat: document.getElementById('vat'),
  saveClientBtn: document.getElementById('saveClient'),
  deleteClientBtn: document.getElementById('deleteClient'),
  addOrderBtn: document.getElementById('addOrder'),
  ordersList: document.getElementById('ordersList'),

  kpiOrdersTotal: document.getElementById('kpiOrdersTotal'),
  kpiRevenueYear: document.getElementById('kpiRevenueYear'),
  kpiIncassi: document.getElementById('kpiIncassi'),
  kpiDaIncassare: document.getElementById('kpiDaIncassare'),
};

// Compatibilità: alcune versioni usavano ?id=, altre ?clientId=
let clientId = getParam('clientId') || getParam('id');
let _clientRef = null;
let _clientData = null;
let _orders = [];

// ===============================
// UI render
// ===============================
function renderOrders(orders){
  els.ordersList.innerHTML = '';

  if (!orders.length) {
    const empty = document.createElement('div');
    empty.className = 'emptyHint';
    empty.textContent = 'Nessun ordine trovato per questo cliente.';
    els.ordersList.appendChild(empty);
    return;
  }

  for (const o of orders) {
    const d = toDateSafe(o.createdAt);
    const dateStr = d ? formatDateIT(d) : '';

    const item = document.createElement('div');
    item.className = 'orderItem';

    const left = document.createElement('div');
    left.style.minWidth = '0';
    left.style.flex = '1 1 auto';

    const right = document.createElement('div');
    right.style.flex = '0 0 auto';
    right.style.textAlign = 'right';

    const top = document.createElement('div');
    top.className = 'orderTop';

    const title = document.createElement('div');
    title.className = 'orderTitle';
    title.textContent = dateStr || '—';
    top.appendChild(title);

    const details = document.createElement('div');
    details.className = 'orderDetails';

    const rows = Array.isArray(o.rows) ? o.rows : [];
    if (rows.length) {
      const parts = rows.slice(0, 3).map(r => {
        const p = r.product || r.desc || r.description || r.descrizione || 'Prodotto';
        const q = r.qty != null ? `x${r.qty}` : '';
        return `${p} ${q}`.trim();
      });
      details.textContent = parts.join(' • ') + (rows.length > 3 ? ' • …' : '');
    } else {
      details.textContent = '—';
    }

    const amount = document.createElement('div');
    amount.className = 'orderAmount';
    amount.textContent = formatEUR(parseEuroLike(o.total));

    const actions = document.createElement('div');
    actions.className = 'orderActions';

    const btnEdit = document.createElement('button');
    btnEdit.className = 'orderBtn edit';
    btnEdit.type = 'button';
    btnEdit.innerHTML = '✏️';
    btnEdit.title = 'Modifica ordine';
    btnEdit.addEventListener('click', (ev) => {
      ev.stopPropagation();
      if (o.__id) window.location.href = `/order.html?orderId=${encodeURIComponent(o.__id)}&clientId=${encodeURIComponent(clientId)}`;
    });

    const btnDel = document.createElement('button');
    btnDel.className = 'orderBtn del';
    btnDel.type = 'button';
    btnDel.innerHTML = '🗑️';
    btnDel.title = 'Elimina ordine';
    btnDel.addEventListener('click', async (ev) => {
      ev.stopPropagation();
      if (!o.__id) return;
      const ok = confirm('Eliminare questo ordine?\n\nVerrà eliminato anche l\'incasso collegato (se presente).');
      if (!ok) return;
      try{
        await deleteDoc(doc(db, 'orders', o.__id));
        await deleteIncassiByOrderId(o.__id);
        await loadOrdersForClient();
      }catch(e){
        console.error(e);
        alert('Errore durante eliminazione ordine.');
      }
    });

    actions.appendChild(btnEdit);
    actions.appendChild(btnDel);

    left.appendChild(top);
    left.appendChild(details);
    right.appendChild(amount);
    right.appendChild(actions);

    item.appendChild(left);
    item.appendChild(right);

    item.addEventListener('click', () => {
      if (o.__id) window.location.href = `/order.html?orderId=${encodeURIComponent(o.__id)}&clientId=${encodeURIComponent(clientId)}`;
    });

    els.ordersList.appendChild(item);
  }
}

function computeClientKpis(){
  const totalOrders = _orders.length;
  els.kpiOrdersTotal.textContent = String(totalOrders);

  const now = new Date();
  const y0 = startOfYear(now);
  const y1 = nextYear(now);
  const inYear = _orders.filter(o => {
    const d = toDateSafe(o.createdAt);
    return d && d >= y0 && d < y1;
  });
  const revenueYear = inYear.reduce((s,o)=> s + parseEuroLike(o.total), 0);
  els.kpiRevenueYear.textContent = formatEUR(revenueYear);

  // Incassi (stima da ordini: incassato totale + acconti)
  const incassi = _orders.reduce((s,o)=>{
    const status = String(o.paymentStatus || '').toLowerCase();
    const total = parseEuroLike(o.total);
    const deposit = Number(o.depositAmount || 0);
    if (status === 'incassato') return s + total;
    if (status === 'acconto') return s + deposit;
    return s;
  }, 0);
  els.kpiIncassi.textContent = formatEUR(incassi);

  // Da incassare (residui)
  const daIncassare = _orders.reduce((s,o)=>{
    const residual = Number(o.residual || 0);
    const status = String(o.paymentStatus || '').toLowerCase();
    if (status === 'da_incassare') return s + parseEuroLike(o.total);
    if (status === 'acconto') return s + residual;
    return s;
  }, 0);
  els.kpiDaIncassare.textContent = formatEUR(daIncassare);
}


function renderClientProducts(){
  const tbody = document.querySelector('#clientProductsTable tbody');
  if(!tbody) return;
  const map = new Map();
  (_orders||[]).forEach((o)=>{
    (Array.isArray(o.rows)?o.rows:[]).forEach((r)=>{
      const name = String(r.product || r.description || r.descrizione || r.name || r.desc || '').trim();
      if(!name) return;
      const key = name.toUpperCase().replace(/\s+/g,' ');
      const prev = map.get(key) || { name, qty:0, orders:0, lastPrice:0 };
      prev.qty += Number(r.qty || r.quantita || 0);
      prev.orders += 1;
      prev.lastPrice = Number(r.price || r.prezzo || prev.lastPrice || 0);
      map.set(key, prev);
    });
  });
  const list = Array.from(map.values()).sort((a,b)=> (b.qty-a.qty)||(b.orders-a.orders)||a.name.localeCompare(b.name));
  tbody.innerHTML = list.length ? list.map((r,i)=>`<tr><td>${i+1}</td><td>${nameHtml(r.name)}</td><td>${r.qty}</td><td>${r.orders}</td><td>${formatEUR(r.lastPrice||0)}</td></tr>`).join('') : `<tr><td colspan="5">Nessun prodotto registrato.</td></tr>`;
}
function nameHtml(s){ return String(s ?? '').replace(/[&<>"]/g, (m)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m]||m)); }

// ===============================
// Load
// ===============================
async function loadClient(){
  if (!clientId) {
    // nuovo cliente
    els.title.textContent = 'Nuovo cliente';
    els.sub.textContent = 'Crea prima il cliente, poi potrai inserire ordini.';
    els.addOrderBtn.disabled = true;
    els.addOrderBtn.style.opacity = '.6';
    els.deleteClientBtn.disabled = true;
    els.deleteClientBtn.style.opacity = '.6';
    return null;
  }

  _clientRef = doc(db, 'clients', clientId);
  const snap = await getDoc(_clientRef);
  if (!snap.exists()) {
    els.title.textContent = 'Cliente non trovato';
    els.addOrderBtn.disabled = true;
    els.deleteClientBtn.disabled = true;
    return null;
  }
  _clientData = snap.data();

  const name = _clientData.name || '';
  els.title.textContent = name || 'Scheda cliente';
  els.name.value = name;
  els.email.value = _clientData.email || '';
  els.phone.value = _clientData.phone || '';
  els.city.value = _clientData.city || '';
  els.vat.value = _clientData.vat || '';

  return { ref: _clientRef, data: _clientData };
}

async function loadOrdersForClient(){
  if (!clientId) return;

  const seen = new Set();
  const allOrders = [];

  // Query 1: by clientId (preferred, modern format)
  try {
    let snaps;
    try {
      const q1 = query(
        collection(db, 'orders'),
        where('clientId', '==', clientId),
        orderBy('createdAt', 'desc')
      );
      snaps = await getDocs(q1);
    } catch (e) {
      // Fallback without orderBy (index might be missing)
      snaps = await getDocs(query(collection(db, 'orders'), where('clientId', '==', clientId)));
    }
    snaps.docs.forEach(d => {
      if (!seen.has(d.id)) { seen.add(d.id); allOrders.push({ __id: d.id, ...d.data() }); }
    });
  } catch (e) {
    console.warn('loadOrdersForClient: query by clientId failed', e);
  }

  // Query 2: by clientName (legacy fallback for old orders without clientId)
  const clientName = _clientData?.name;
  if (clientName) {
    try {
      const qLeg = await getDocs(query(collection(db, 'orders'), where('clientName', '==', clientName)));
      qLeg.docs.forEach(d => {
        if (!seen.has(d.id)) { seen.add(d.id); allOrders.push({ __id: d.id, ...d.data() }); }
      });
    } catch (e) {
      console.warn('loadOrdersForClient: legacy query by clientName failed', e);
    }
  }

  _orders = allOrders;

  // Sort by date descending
  _orders.sort((a, b) => {
    const da = toDateSafe(a.createdAt);
    const dbb = toDateSafe(b.createdAt);
    const ta = da ? da.getTime() : 0;
    const tb = dbb ? dbb.getTime() : 0;
    return tb - ta;
  });

  renderOrders(_orders);
  computeClientKpis();
  renderClientProducts();
}

// ===============================
// Actions
// ===============================
async function saveClient(){
  const name = (els.name.value || '').trim();
  if (!name) {
    alert('Inserisci il nome del cliente.');
    return;
  }

  const payload = {
    name,
    email: (els.email.value || '').trim(),
    phone: (els.phone.value || '').trim(),
    city: (els.city.value || '').trim(),
    vat: (els.vat.value || '').trim(),
    updatedAt: serverTimestamp(),
  };

  try{
    if (clientId && _clientRef) {
      await updateDoc(_clientRef, payload);
      alert('✅ Cliente salvato');
      // aggiorna titolo
      els.title.textContent = name;
    } else {
      // nuovo cliente
      payload.createdAt = serverTimestamp();
      const ref = await addDoc(collection(db, 'clients'), payload);
      clientId = ref.id;
      _clientRef = doc(db, 'clients', clientId);
      alert('✅ Cliente creato');
      window.location.href = `client.html?clientId=${encodeURIComponent(clientId)}`;
      return;
    }
  }catch(e){
    console.error(e);
    alert('❌ Errore salvataggio cliente');
  }
}

async function deleteClientSafe(){
  if (!clientId || !_clientRef) return;

  // sicurezza: non cancelliamo se ci sono ordini collegati
  if (_orders.length > 0) {
    alert('Questo cliente ha ordini collegati.\n\nPer sicurezza NON lo eliminiamo per non perdere collegamenti e dati.');
    return;
  }

  const ok = confirm('Eliminare il cliente? Operazione irreversibile.');
  if (!ok) return;
  try{
    await deleteDoc(_clientRef);
    alert('✅ Cliente eliminato');
    window.location.href = 'clients.html';
  }catch(e){
    console.error(e);
    alert('❌ Errore eliminazione cliente');
  }
}

function createOrder(){
  if (!clientId) {
    alert('Salva prima il cliente.');
    return;
  }
  window.location.href = `/order.html?clientId=${encodeURIComponent(clientId)}`;
}

// ===============================
// Init
// ===============================
function waitForAuth() {
  return new Promise(resolve => {
    const unsub = onAuthStateChanged(auth, user => { unsub(); resolve(user); });
  });
}

waitForAuth().then(async () => {
  try{
    await loadClient();
    await loadOrdersForClient();

    els.saveClientBtn?.addEventListener('click', saveClient);
    els.deleteClientBtn?.addEventListener('click', deleteClientSafe);
    els.addOrderBtn?.addEventListener('click', createOrder);
  }catch(e){
    console.error(e);
    alert('Errore nel caricamento della scheda cliente.');
  }
});
