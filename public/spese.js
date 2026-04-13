// spese.js – Professional Spese module
// Uses: dateISO field from normalizeExpense (via listExpenses)

import { listExpenses, addExpense, upsertExpense, softDeleteExpense } from './services/expenseService.js';

// ── Helpers ──────────────────────────────────────────────────

const fmt = (n) =>
  new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(Number(n) || 0);

const todayISO = () => new Date().toISOString().slice(0, 10);

function fmtDate(iso) {
  if (!iso || iso.length < 10) return iso || '—';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

function monthLabel(ym) {
  if (!ym || ym.length < 7) return ym || '';
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1, 1);
  const s = d.toLocaleDateString('it-IT', { month: 'long', year: 'numeric' });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function esc(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

const CAT_KNOWN = ['prodotti','attrezzatura','servizi','utenze','fornitori','personale','marketing','affitto','altro'];

function catClass(cat) {
  const c = String(cat || '').toLowerCase().trim();
  return CAT_KNOWN.includes(c) ? `sp-cat-${c}` : 'sp-cat-altro';
}

function catBadge(cat) {
  const label = cat || 'altro';
  return `<span class="sp-cat-badge ${catClass(cat)}">${esc(label)}</span>`;
}

// ── State ────────────────────────────────────────────────────

let allExpenses = [];

const now = new Date();
let filterMonth = now.getMonth() + 1; // 1-12, 0 = all months
let filterYear  = now.getFullYear();
let searchTerm  = '';
let filterCat   = '';
let sortBy      = 'date';   // 'date' | 'amount'
let sortDir     = 'desc';   // 'asc'  | 'desc'
let editId      = null;     // null = new record

let barChart   = null;
let donutChart = null;

// ── DOM refs ─────────────────────────────────────────────────

const backBtn      = document.getElementById('backBtn');
const speseSearch  = document.getElementById('speseSearch');
const catFilterEl  = document.getElementById('catFilter');
const monthFilter  = document.getElementById('monthFilter');
const yearFilter   = document.getElementById('yearFilter');
const btnNew       = document.getElementById('btnNew');
const sortDateBtn  = document.getElementById('sortDateBtn');
const sortAmtBtn   = document.getElementById('sortAmtBtn');
const speseList    = document.getElementById('speseList');
const listCountEl  = document.getElementById('listCount');

const kpiAnno     = document.getElementById('kpiAnno');
const kpiMese     = document.getElementById('kpiMese');
const kpiMedia    = document.getElementById('kpiMedia');
const kpiNumMese  = document.getElementById('kpiNumMese');

const modal       = document.getElementById('speseModal');
const modalTitle  = document.getElementById('modalTitle');
const fDate       = document.getElementById('fDate');
const fAmount     = document.getElementById('fAmount');
const fNote       = document.getElementById('fNote');
const fCat        = document.getElementById('fCat');
const fSourceEl   = document.getElementById('fSource');
const sourceField = document.getElementById('sourceField');
const btnSave     = document.getElementById('btnSave');
const btnDelete   = document.getElementById('btnDelete');
const btnCancel   = document.getElementById('btnCancel');
const btnCancel2  = document.getElementById('btnCancel2');

const chartsToggle = document.getElementById('chartsToggle');
const chartsBody   = document.getElementById('chartsBody');

// ── Init year filter ──────────────────────────────────────────

(function buildYearFilter() {
  if (!yearFilter) return;
  const cy = now.getFullYear();
  for (let y = cy + 1; y >= cy - 3; y--) {
    const opt = document.createElement('option');
    opt.value = y;
    opt.textContent = y;
    if (y === cy) opt.selected = true;
    yearFilter.appendChild(opt);
  }
})();

// ── Set default month in select ───────────────────────────────

if (monthFilter) monthFilter.value = filterMonth;

// ── Event bindings ───────────────────────────────────────────

backBtn?.addEventListener('click', () => history.back());

speseSearch?.addEventListener('input', () => {
  searchTerm = speseSearch.value.trim().toLowerCase();
  render();
});

catFilterEl?.addEventListener('change', () => {
  filterCat = catFilterEl.value;
  render();
});

monthFilter?.addEventListener('change', () => {
  filterMonth = Number(monthFilter.value);
  render();
});

yearFilter?.addEventListener('change', () => {
  filterYear = Number(yearFilter.value);
  render();
});

sortDateBtn?.addEventListener('click', () => {
  if (sortBy === 'date') sortDir = sortDir === 'desc' ? 'asc' : 'desc';
  else { sortBy = 'date'; sortDir = 'desc'; }
  updateSortButtons();
  render();
});

sortAmtBtn?.addEventListener('click', () => {
  if (sortBy === 'amount') sortDir = sortDir === 'desc' ? 'asc' : 'desc';
  else { sortBy = 'amount'; sortDir = 'desc'; }
  updateSortButtons();
  render();
});

btnNew?.addEventListener('click', () => openModal(null));
btnSave?.addEventListener('click', save);
btnDelete?.addEventListener('click', del);
btnCancel?.addEventListener('click', closeModal);
btnCancel2?.addEventListener('click', closeModal);

modal?.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeModal();
});

chartsToggle?.addEventListener('click', toggleCharts);
chartsToggle?.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleCharts(); } });

function toggleCharts() {
  const isOpen = chartsBody.classList.contains('open');
  chartsBody.classList.toggle('open', !isOpen);
  chartsToggle.classList.toggle('open', !isOpen);
  chartsToggle.setAttribute('aria-expanded', String(!isOpen));
  chartsBody.setAttribute('aria-hidden', String(isOpen));
  if (!isOpen) renderCharts();
}

function updateSortButtons() {
  sortDateBtn?.classList.toggle('active', sortBy === 'date');
  sortAmtBtn?.classList.toggle('active', sortBy === 'amount');
}

// ── Filter & Sort ─────────────────────────────────────────────

function getFiltered() {
  return allExpenses
    .filter(e => {
      if (!e.dateISO) return false;
      const [y, m] = e.dateISO.split('-').map(Number);
      if (y !== filterYear) return false;
      if (filterMonth > 0 && m !== filterMonth) return false;
      if (filterCat && (e.category || '').toLowerCase() !== filterCat) return false;
      if (searchTerm) {
        const haystack = `${e.note} ${e.category}`.toLowerCase();
        if (!haystack.includes(searchTerm)) return false;
      }
      return true;
    })
    .sort((a, b) => {
      const va = sortBy === 'amount' ? (a.amount || 0) : (a.dateISO || '');
      const vb = sortBy === 'amount' ? (b.amount || 0) : (b.dateISO || '');
      if (va < vb) return sortDir === 'asc' ? -1 : 1;
      if (va > vb) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
}

// ── KPIs (always based on current real calendar) ──────────────

function renderKPIs() {
  const cy = now.getFullYear();
  const cm = now.getMonth() + 1;

  const yearAll  = allExpenses.filter(e => e.dateISO?.startsWith(`${cy}-`));
  const monthAll = allExpenses.filter(e => {
    if (!e.dateISO) return false;
    const [y, m] = e.dateISO.split('-').map(Number);
    return y === cy && m === cm;
  });

  const yearSum  = yearAll.reduce((s, e) => s + (e.amount || 0), 0);
  const monthSum = monthAll.reduce((s, e) => s + (e.amount || 0), 0);
  const numMese  = monthAll.length;

  const monthBuckets = {};
  for (const e of yearAll) {
    const ym = e.dateISO.slice(0, 7);
    monthBuckets[ym] = (monthBuckets[ym] || 0) + (e.amount || 0);
  }
  const numMonths = Object.keys(monthBuckets).length;
  const media = numMonths ? yearSum / numMonths : 0;

  if (kpiAnno)    kpiAnno.textContent    = fmt(yearSum);
  if (kpiMese)    kpiMese.textContent    = fmt(monthSum);
  if (kpiMedia)   kpiMedia.textContent   = fmt(media);
  if (kpiNumMese) kpiNumMese.textContent = numMese;
}

// ── Render list ───────────────────────────────────────────────

function render() {
  renderKPIs();

  const items = getFiltered();

  if (listCountEl) listCountEl.textContent = `${items.length} spese`;

  if (!items.length) {
    speseList.innerHTML = `
      <div class="sp-empty">
        <div class="sp-empty-icon">💸</div>
        <div>Nessuna spesa trovata</div>
        <div style="font-size:13px;margin-top:6px">Cambia i filtri o aggiungi una nuova spesa</div>
      </div>`;
    return;
  }

  // Group by YYYY-MM
  const groups = {};
  for (const e of items) {
    const ym = (e.dateISO || '').slice(0, 7);
    if (!groups[ym]) groups[ym] = [];
    groups[ym].push(e);
  }
  const sortedYms = Object.keys(groups).sort((a, b) => b.localeCompare(a));

  let html = `
    <div class="sp-table-head">
      <div>Data</div>
      <div>Nota / Descrizione</div>
      <div>Categoria</div>
      <div style="text-align:right">Importo</div>
      <div style="text-align:right">Azioni</div>
    </div>`;

  for (const ym of sortedYms) {
    const grpItems = groups[ym];
    const grpTotal = grpItems.reduce((s, e) => s + (e.amount || 0), 0);
    const countLabel = grpItems.length === 1 ? '1 spesa' : `${grpItems.length} spese`;

    html += `<div class="sp-month-group">
      <div class="sp-month-header">
        <span class="sp-month-header-label">${monthLabel(ym)}</span>
        <span>
          <span class="sp-month-total">${fmt(grpTotal)}</span>
          <span class="sp-month-count">${countLabel}</span>
        </span>
      </div>`;

    for (const e of grpItems) {
      const noteHtml = e.note
        ? `<span class="sp-row-note">${esc(e.note)}</span>`
        : `<span class="sp-row-note sp-row-note-empty">—</span>`;

      html += `
        <div class="sp-expense-row" data-id="${esc(e.id)}" role="button" tabindex="0"
             aria-label="${esc(e.note || e.category || '')} ${fmt(e.amount)}">
          <div class="sp-row-date">${fmtDate(e.dateISO)}</div>
          <div>${noteHtml}</div>
          <div>${catBadge(e.category)}</div>
          <div class="sp-row-amount">${fmt(e.amount)}</div>
          <div class="sp-row-actions">
            <button class="sp-icon-btn edit-btn" title="Modifica" data-id="${esc(e.id)}" aria-label="Modifica">✏️</button>
            <button class="sp-icon-btn del del-btn" title="Elimina" data-id="${esc(e.id)}" aria-label="Elimina">🗑</button>
          </div>
        </div>`;
    }

    html += `</div>`;
  }

  speseList.innerHTML = html;

  speseList.querySelectorAll('.sp-expense-row').forEach(row => {
    row.addEventListener('click', (e) => {
      if (e.target.closest('.sp-icon-btn')) return;
      openModal(row.dataset.id);
    });
    row.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') openModal(row.dataset.id);
    });
  });

  speseList.querySelectorAll('.edit-btn').forEach(btn => {
    btn.addEventListener('click', (e) => { e.stopPropagation(); openModal(btn.dataset.id); });
  });

  speseList.querySelectorAll('.del-btn').forEach(btn => {
    btn.addEventListener('click', (e) => { e.stopPropagation(); quickDelete(btn.dataset.id); });
  });
}

// ── Modal ─────────────────────────────────────────────────────

function openModal(id) {
  editId = id || null;
  const expense = id ? allExpenses.find(e => e.id === id) : null;

  if (modalTitle) modalTitle.textContent = expense ? 'Modifica Spesa' : 'Nuova Spesa';
  if (fDate)   fDate.value   = expense?.dateISO || todayISO();
  if (fAmount) fAmount.value = expense ? String(expense.amount) : '';
  if (fNote)   fNote.value   = expense?.note || '';
  if (fCat)    fCat.value    = expense?.category || 'altro';

  if (sourceField && fSourceEl) {
    if (expense?.source) {
      fSourceEl.textContent = `Fonte: ${expense.source}`;
      sourceField.style.display = '';
    } else {
      sourceField.style.display = 'none';
    }
  }

  if (btnDelete) btnDelete.style.display = id ? 'inline-flex' : 'none';

  modal?.classList.remove('hidden');
  setTimeout(() => fAmount?.focus(), 50);
}

function closeModal() {
  modal?.classList.add('hidden');
  editId = null;
}

async function save() {
  const date   = fDate?.value;
  const rawAmt = String(fAmount?.value || '').replace(',', '.');
  const amount = parseFloat(rawAmt);
  const note   = fNote?.value?.trim() || '';
  const cat    = fCat?.value || 'altro';

  if (!date) { alert('Inserisci una data'); return; }
  if (!Number.isFinite(amount) || amount <= 0) { alert('Inserisci un importo valido'); return; }

  if (btnSave) { btnSave.disabled = true; btnSave.textContent = 'Salvo…'; }

  try {
    if (editId) {
      await upsertExpense(editId, { date, amount, note, category: cat });
    } else {
      await addExpense({ date, amount, note, category: cat });
    }
    closeModal();
    await boot(false);
  } catch (e) {
    alert('Errore: ' + e.message);
  } finally {
    if (btnSave) { btnSave.disabled = false; btnSave.textContent = '💾 Salva'; }
  }
}

async function del() {
  if (!editId) return;
  if (!confirm('Eliminare questa spesa? L\'operazione non può essere annullata.')) return;

  if (btnDelete) btnDelete.disabled = true;
  try {
    await softDeleteExpense(editId);
    closeModal();
    await boot(false);
  } catch (e) {
    alert('Errore: ' + e.message);
  } finally {
    if (btnDelete) btnDelete.disabled = false;
  }
}

async function quickDelete(id) {
  if (!id || !confirm('Eliminare questa spesa?')) return;
  try {
    await softDeleteExpense(id);
    await boot(false);
  } catch (e) {
    alert('Errore: ' + e.message);
  }
}

// ── Charts ────────────────────────────────────────────────────

function renderCharts() {
  if (typeof Chart === 'undefined') return;

  // Register datalabels plugin if available
  if (typeof ChartDataLabels !== 'undefined') {
    Chart.register(ChartDataLabels);
  }

  const barCanvas   = document.getElementById('barChart');
  const donutCanvas = document.getElementById('donutChart');
  if (!barCanvas || !donutCanvas) return;

  // Last 12 months bar
  const months    = [];
  const monthSums = [];
  for (let i = 11; i >= 0; i--) {
    const d  = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    months.push(d.toLocaleDateString('it-IT', { month: 'short', year: '2-digit' }));
    const sum = allExpenses
      .filter(e => e.dateISO?.startsWith(ym))
      .reduce((s, e) => s + (e.amount || 0), 0);
    monthSums.push(sum);
  }

  if (barChart) barChart.destroy();
  barChart = new Chart(barCanvas.getContext('2d'), {
    type: 'bar',
    data: {
      labels: months,
      datasets: [{
        label: 'Spese (€)',
        data: monthSums,
        backgroundColor: 'rgba(249,115,22,.65)',
        borderColor: '#f97316',
        borderWidth: 1,
        borderRadius: 5,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      layout: { padding: { top: 24 } },
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: ctx => fmt(ctx.raw) } },
        datalabels: typeof ChartDataLabels !== 'undefined' ? {
          anchor: 'end',
          align: 'top',
          color: '#f97316',
          font: { size: 9, weight: '700' },
          formatter: (v) => v > 0 ? fmt(v) : '',
          clip: false,
        } : false,
      },
      scales: {
        x: { ticks: { color: '#94a3b8', font: { size: 10 } }, grid: { color: 'rgba(255,255,255,.06)' } },
        y: { ticks: { color: '#94a3b8', font: { size: 10 }, callback: v => fmt(v) }, grid: { color: 'rgba(255,255,255,.06)' } },
      },
    },
  });

  // Category donut for current filtered view
  const filtered  = getFiltered();
  const catTotals = {};
  for (const e of filtered) {
    const cat = (e.category || 'altro').toLowerCase();
    catTotals[cat] = (catTotals[cat] || 0) + (e.amount || 0);
  }

  const CAT_COLORS = {
    prodotti: '#3b82f6', attrezzatura: '#8b5cf6', servizi: '#06b6d4',
    utenze: '#f59e0b', fornitori: '#ef4444', personale: '#10b981',
    marketing: '#db2777', affitto: '#f97316', altro: '#6b7280',
  };

  const catKeys = Object.keys(catTotals);
  if (donutChart) donutChart.destroy();
  donutChart = new Chart(donutCanvas.getContext('2d'), {
    type: 'doughnut',
    data: {
      labels: catKeys,
      datasets: [{
        data: catKeys.map(k => catTotals[k]),
        backgroundColor: catKeys.map(k => CAT_COLORS[k] || '#6b7280'),
        borderColor: '#1e293b',
        borderWidth: 2,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'right',
          labels: { color: '#94a3b8', font: { size: 11 }, boxWidth: 12, padding: 12 },
        },
        tooltip: { callbacks: { label: ctx => `${ctx.label}: ${fmt(ctx.raw)}` } },
        datalabels: typeof ChartDataLabels !== 'undefined' ? {
          color: '#fff',
          font: { size: 10, weight: '900' },
          formatter: (v, ctx) => {
            if (!v || v <= 0) return '';
            const total = ctx.dataset.data.reduce((a, b) => a + b, 0);
            const pct = total > 0 ? Math.round(v / total * 100) : 0;
            return pct >= 5 ? `${fmt(v)}\n${pct}%` : '';
          },
          textAlign: 'center',
        } : false,
      },
    },
  });
}

// ── Boot ──────────────────────────────────────────────────────

async function boot(showLoading = true) {
  if (showLoading && speseList) {
    speseList.innerHTML = '<div class="sp-loading">⏳ Caricamento spese…</div>';
  }
  try {
    allExpenses = await listExpenses();
  } catch (e) {
    if (speseList) {
      speseList.innerHTML = `
        <div class="sp-empty">
          <div class="sp-empty-icon">⚠️</div>
          <div>Errore caricamento</div>
          <div style="font-size:13px;margin-top:6px">${esc(e.message)}</div>
        </div>`;
    }
    return;
  }
  render();
  if (chartsBody?.classList.contains('open')) renderCharts();
}

boot();
