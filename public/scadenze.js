import { listDeadlines, upsertDeadline, softDeleteDeadline } from './services/deadlineService.js';
import { auth, db } from './firebase.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import {
  doc, setDoc, deleteDoc, addDoc, collection, serverTimestamp, getDoc
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

// ── Helpers ──────────────────────────────────────────────────
const fmt = (n) =>
  new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(Number(n) || 0);

const todayISO = () => new Date().toISOString().slice(0, 10);

function dateAddDays(iso, n) {
  const d = new Date(iso);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

function fmtDate(iso) {
  if (!iso || iso.length < 10) return iso || '—';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

function monthLabel(ym) {
  const [y, m] = ym.split('-');
  const d = new Date(Number(y), Number(m) - 1, 1);
  return d.toLocaleDateString('it-IT', { month: 'long', year: 'numeric' });
}

function statusOf(iso) {
  const today = todayISO();
  if (iso < today) return { cls: 'scad-status-past',   label: '🔴 Scaduta' };
  if (iso === today) return { cls: 'scad-status-today', label: '🟡 Oggi' };
  return { cls: 'scad-status-future',  label: '🟢 Futura' };
}

function esc(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

// ── Spese sync ────────────────────────────────────────────────
async function syncScadenzaToSpese(dateKey, amount, note) {
  if (!dateKey) return;
  try {
    await setDoc(doc(db, 'spese', `scad_${dateKey}`), {
      date: dateKey, amount: amount || 0,
      note: note || '', category: 'scadenze',
      source: 'scadenza', syncedAt: new Date().toISOString()
    }, { merge: true });
  } catch (e) { console.warn('Sync scadenza→spese:', e); }
}

async function removeScadenzaFromSpese(dateKey) {
  if (!dateKey) return;
  try { await deleteDoc(doc(db, 'spese', `scad_${dateKey}`)); }
  catch (e) { console.warn('Rimozione scadenza da spese:', e); }
}

// ── State ─────────────────────────────────────────────────────
let allDeadlines = [];
let sortBy  = 'date';   // 'date' | 'amount'
let sortDir = 'desc';   // 'asc'  | 'desc'
let editId  = null;     // null = new record, string = existing doc id

// ── DOM refs ──────────────────────────────────────────────────
const backBtn      = document.getElementById('backBtn');
const scadSearch   = document.getElementById('scadSearch');
const filterMonth  = document.getElementById('filterMonth');
const filterYear   = document.getElementById('filterYear');
const sortDateBtn  = document.getElementById('sortDateBtn');
const sortAmtBtn   = document.getElementById('sortAmtBtn');
const btnNew       = document.getElementById('btnNew');
const scadList     = document.getElementById('scadList');

const scadModal    = document.getElementById('scadModal');
const modalTitle   = document.getElementById('modalTitle');
const modalClose   = document.getElementById('modalClose');
const modalCancel  = document.getElementById('modalCancel');
const modalSave    = document.getElementById('modalSave');
const modalDelete  = document.getElementById('modalDelete');
const mDate        = document.getElementById('mDate');
const mAmount      = document.getElementById('mAmount');
const mNote        = document.getElementById('mNote');
const mCategory    = document.getElementById('mCategory');
const mDateErr     = document.getElementById('mDateErr');
const mAmountErr   = document.getElementById('mAmountErr');

let chartInstance  = null;

// ── KPIs ──────────────────────────────────────────────────────
function updateKPIs() {
  const today = todayISO();
  const thisYear  = today.slice(0, 4);
  const thisMonth = today.slice(0, 7);
  const in30Days  = dateAddDays(today, 30);

  const kpiAnno = allDeadlines
    .filter(d => d.dateISO.startsWith(thisYear))
    .reduce((s, d) => s + d.amount, 0);

  const kpiMese = allDeadlines
    .filter(d => d.dateISO.startsWith(thisMonth))
    .reduce((s, d) => s + d.amount, 0);

  const kpiScaduto = allDeadlines
    .filter(d => d.dateISO < today && d.amount > 0)
    .reduce((s, d) => s + d.amount, 0);

  const kpiProssime = allDeadlines
    .filter(d => d.dateISO >= today && d.dateISO <= in30Days)
    .length;

  document.getElementById('kpiAnno').textContent    = fmt(kpiAnno);
  document.getElementById('kpiMese').textContent    = fmt(kpiMese);
  document.getElementById('kpiScaduto').textContent = fmt(kpiScaduto);
  document.getElementById('kpiProssime').textContent = kpiProssime;
}

// ── Year filter population ────────────────────────────────────
function populateYearFilter() {
  const years = [...new Set(allDeadlines.map(d => d.dateISO.slice(0, 4)))].sort().reverse();
  const currentYear = todayISO().slice(0, 4);
  if (!years.includes(currentYear)) years.unshift(currentYear);

  filterYear.innerHTML = '<option value="">Tutti gli anni</option>';
  years.forEach(y => {
    const opt = document.createElement('option');
    opt.value = y;
    opt.textContent = y;
    filterYear.appendChild(opt);
  });
}

// ── Filtered & sorted list ────────────────────────────────────
function getFiltered() {
  const search = scadSearch.value.toLowerCase().trim();
  const fMonth = filterMonth.value;
  const fYear  = filterYear.value;

  let list = [...allDeadlines];
  if (fYear)  list = list.filter(d => d.dateISO.startsWith(fYear));
  if (fMonth) list = list.filter(d => d.dateISO.slice(5, 7) === fMonth);
  if (search) list = list.filter(d => d.note.toLowerCase().includes(search));

  list.sort((a, b) => {
    const cmp = sortBy === 'date'
      ? a.dateISO.localeCompare(b.dateISO)
      : a.amount - b.amount;
    return sortDir === 'desc' ? -cmp : cmp;
  });

  return list;
}

// ── Render list ───────────────────────────────────────────────
function renderList() {
  const list = getFiltered();

  if (list.length === 0) {
    scadList.innerHTML = `
      <div class="scad-empty-state">
        <div class="scad-empty-icon">🔍</div>
        <div>Nessuna scadenza trovata.</div>
      </div>`;
    return;
  }

  // Group by year-month
  const groups = new Map();
  for (const item of list) {
    const ym = item.dateISO.slice(0, 7);
    if (!groups.has(ym)) groups.set(ym, []);
    groups.get(ym).push(item);
  }

  // Sort groups by month key following the same sort direction
  const sortedGroups = [...groups.entries()].sort((a, b) =>
    sortDir === 'desc' ? b[0].localeCompare(a[0]) : a[0].localeCompare(b[0])
  );

  const html = sortedGroups.map(([ym, items]) => {
    const groupTotal = items.reduce((s, d) => s + d.amount, 0);
    const label = monthLabel(ym);

    const rows = items.map(item => {
      const st = statusOf(item.dateISO);
      return `
        <div class="scad-row" data-id="${esc(item.id)}" tabindex="0" role="button"
             aria-label="Scadenza ${fmtDate(item.dateISO)}: ${esc(item.note) || 'nessuna nota'}">
          <div class="scad-row-date">${fmtDate(item.dateISO)}</div>
          <div class="scad-row-note" title="${esc(item.note)}">${esc(item.note) || ''}</div>
          <div class="scad-row-amount">${fmt(item.amount)}</div>
          <div class="scad-row-status-wrap">
            <span class="scad-status ${st.cls}">${st.label}</span>
          </div>
          <div class="scad-row-actions">
            <button class="scad-row-btn edit-btn" data-id="${esc(item.id)}" title="Modifica">✏️</button>
            <button class="scad-row-btn del del-btn" data-id="${esc(item.id)}" title="Elimina">🗑</button>
          </div>
        </div>`;
    }).join('');

    return `
      <div class="scad-group-header">
        <span class="scad-group-name">${esc(label)}</span>
        <span class="scad-group-total">${fmt(groupTotal)}</span>
      </div>
      ${rows}`;
  }).join('');

  scadList.innerHTML = html;

  // Event delegation for row / edit / delete buttons
  scadList.querySelectorAll('.scad-row').forEach(row => {
    row.addEventListener('click', e => {
      const delBtn  = e.target.closest('.del-btn');
      const editBtn = e.target.closest('.edit-btn');
      if (delBtn) {
        e.stopPropagation();
        handleDelete(delBtn.dataset.id);
      } else if (editBtn) {
        e.stopPropagation();
        openModal(editBtn.dataset.id);
      } else {
        openModal(row.dataset.id);
      }
    });
    row.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openModal(row.dataset.id); }
    });
  });
}

// ── Chart ─────────────────────────────────────────────────────
function renderChart() {
  const canvas = document.getElementById('scadChart');
  if (!canvas || typeof Chart === 'undefined') return;

  // Build last 12 months labels & totals
  const today = new Date();
  const labels = [];
  const data   = [];

  for (let i = 11; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
    const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    labels.push(d.toLocaleDateString('it-IT', { month: 'short', year: '2-digit' }));
    const total = allDeadlines
      .filter(x => x.dateISO.startsWith(ym))
      .reduce((s, x) => s + x.amount, 0);
    data.push(total);
  }

  const isDark = !document.documentElement.classList.contains('theme-light');
  const textColor  = isDark ? '#94a3b8' : '#64748b';
  const gridColor  = isDark ? 'rgba(255,255,255,.07)' : 'rgba(0,0,0,.07)';

  if (chartInstance) chartInstance.destroy();

  chartInstance = new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Scadenze (€)',
        data,
        backgroundColor: 'rgba(59,130,246,.55)',
        borderColor: 'rgba(59,130,246,.85)',
        borderWidth: 1.5,
        borderRadius: 6,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => fmt(ctx.parsed.y)
          }
        }
      },
      scales: {
        x: {
          ticks: { color: textColor, font: { size: 11, weight: '700' } },
          grid: { color: gridColor }
        },
        y: {
          ticks: {
            color: textColor,
            font: { size: 11, weight: '700' },
            callback: v => fmt(v)
          },
          grid: { color: gridColor }
        }
      }
    }
  });
}

// ── Modal ─────────────────────────────────────────────────────
function clearModalErrors() {
  [mDate, mAmount].forEach(el => el.classList.remove('input-error'));
  [mDateErr, mAmountErr].forEach(el => { el.textContent = ''; el.classList.remove('visible'); });
}

async function openModal(id = null) {
  editId = id;
  clearModalErrors();

  if (id) {
    modalTitle.textContent = 'Modifica Scadenza';
    modalDelete.classList.remove('hidden');

    // Fetch full doc for category field (normalized data doesn't include category)
    let item = allDeadlines.find(d => d.id === id);
    mDate.value   = item ? item.dateISO : '';
    mAmount.value = item ? (item.amount || '') : '';
    mNote.value   = item ? item.note : '';
    mCategory.value = '';

    try {
      const snap = await getDoc(doc(db, 'scadenze', id));
      if (snap.exists()) {
        const raw = snap.data();
        mCategory.value = raw.category || '';
      }
    } catch (e) { console.warn('getDoc for edit:', e); }

    mDate.readOnly = true;
    mDate.style.opacity = '.6';
  } else {
    modalTitle.textContent = 'Nuova Scadenza';
    modalDelete.classList.add('hidden');
    mDate.value   = todayISO();
    mAmount.value = '';
    mNote.value   = '';
    mCategory.value = '';
    mDate.readOnly = false;
    mDate.style.opacity = '';
  }

  scadModal.classList.remove('hidden');
  setTimeout(() => mAmount.focus(), 60);
}

function closeModal() {
  scadModal.classList.add('hidden');
  editId = null;
  mDate.readOnly = false;
  mDate.style.opacity = '';
}

async function handleSave() {
  clearModalErrors();
  let hasErr = false;

  const dateVal   = mDate.value.trim();
  const amountVal = parseFloat(mAmount.value);
  const noteVal   = mNote.value.trim();
  const catVal    = mCategory.value;

  if (!dateVal || !/^\d{4}-\d{2}-\d{2}$/.test(dateVal)) {
    mDate.classList.add('input-error');
    mDateErr.textContent = 'Data richiesta (YYYY-MM-DD)';
    mDateErr.classList.add('visible');
    hasErr = true;
  }
  if (isNaN(amountVal) || amountVal < 0) {
    mAmount.classList.add('input-error');
    mAmountErr.textContent = 'Inserisci un importo valido (≥ 0)';
    mAmountErr.classList.add('visible');
    hasErr = true;
  }
  if (hasErr) return;

  modalSave.disabled = true;
  try {
    const targetId = editId || dateVal;
    const payload = {
      date:     targetId,
      amount:   amountVal,
      note:     noteVal,
      category: catVal,
      updatedAt: serverTimestamp()
    };
    await upsertDeadline(targetId, payload);
    await syncScadenzaToSpese(targetId, amountVal, noteVal);
    try {
      await addDoc(collection(db, 'scadenzeHistory'), {
        action: 'save', day: targetId, payload, at: serverTimestamp()
      });
    } catch (_) {}
    closeModal();
    await loadAndRender();
  } catch (e) {
    alert('Errore salvataggio: ' + e.message);
  } finally {
    modalSave.disabled = false;
  }
}

async function handleDelete(id) {
  if (!id) return;
  const item = allDeadlines.find(d => d.id === id);
  const label = item ? fmtDate(item.dateISO) : id;
  if (!confirm(`Eliminare la scadenza del ${label}?`)) return;

  try {
    const snap = await getDoc(doc(db, 'scadenze', id));
    if (snap.exists()) {
      await addDoc(collection(db, 'scadenzeHistory'), {
        action: 'delete', day: id, payload: snap.data(), at: serverTimestamp()
      });
    }
  } catch (_) {}

  await softDeleteDeadline(id);
  await removeScadenzaFromSpese(id);
  closeModal();
  await loadAndRender();
}

// ── Sort buttons ──────────────────────────────────────────────
function updateSortUI() {
  sortDateBtn.classList.toggle('scad-sort-active', sortBy === 'date');
  sortAmtBtn.classList.toggle('scad-sort-active',  sortBy === 'amount');
  sortDateBtn.textContent = sortBy === 'date' ? `Data ${sortDir === 'desc' ? '↓' : '↑'}` : 'Data';
  sortAmtBtn.textContent  = sortBy === 'amount' ? `Importo ${sortDir === 'desc' ? '↓' : '↑'}` : 'Importo';
}

sortDateBtn?.addEventListener('click', () => {
  if (sortBy === 'date') sortDir = sortDir === 'desc' ? 'asc' : 'desc';
  else { sortBy = 'date'; sortDir = 'desc'; }
  updateSortUI();
  renderList();
});

sortAmtBtn?.addEventListener('click', () => {
  if (sortBy === 'amount') sortDir = sortDir === 'desc' ? 'asc' : 'desc';
  else { sortBy = 'amount'; sortDir = 'desc'; }
  updateSortUI();
  renderList();
});

// ── Filter & search listeners ─────────────────────────────────
scadSearch?.addEventListener('input', renderList);
filterMonth?.addEventListener('change', renderList);
filterYear?.addEventListener('change', renderList);

// ── Modal event listeners ─────────────────────────────────────
btnNew?.addEventListener('click', () => openModal(null));
modalClose?.addEventListener('click', closeModal);
modalCancel?.addEventListener('click', closeModal);
scadModal?.addEventListener('click', e => { if (e.target === scadModal) closeModal(); });
modalSave?.addEventListener('click', handleSave);
modalDelete?.addEventListener('click', () => handleDelete(editId));

// ── Back button ───────────────────────────────────────────────
backBtn?.addEventListener('click', () => { window.location.href = 'index.html'; });

// ── Chart re-render on section open ──────────────────────────
document.getElementById('chartSection')?.addEventListener('toggle', e => {
  if (e.target.open) renderChart();
});

// ── Load & render ─────────────────────────────────────────────
async function loadAndRender() {
  try {
    allDeadlines = await listDeadlines();
    updateKPIs();
    populateYearFilter();
    renderList();
    // Bulk sync to spese (idempotent, background)
    Promise.all(allDeadlines.map(d => syncScadenzaToSpese(d.dateISO, d.amount, d.note)))
      .catch(e => console.warn('Sync bulk scadenze→spese:', e));
    const cs = document.getElementById('chartSection');
    if (cs && cs.open) renderChart();
  } catch (e) {
    console.error('Errore caricamento scadenze:', e);
    scadList.innerHTML = `<div class="scad-empty-state scad-danger">⚠️ Errore nel caricamento delle scadenze.</div>`;
  }
}

// ── Boot ──────────────────────────────────────────────────────
function waitForAuth() {
  return new Promise(resolve => {
    const unsub = onAuthStateChanged(auth, user => { unsub(); resolve(user); });
  });
}

waitForAuth().then(() => loadAndRender());
