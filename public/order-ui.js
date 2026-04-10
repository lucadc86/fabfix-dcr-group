
// order-ui.js
// Multi-pagamento + Multi-scadenza per Ordini Clienti.
// Gestisce lo stato in-memory di payments[] e deadlines[]
// ed espone window.__fabfix per la comunicazione con order.js.

// ====================================
// UTILS
// ====================================
function qs(id) { return document.getElementById(id); }

function parseEuroLikeText(txt) {
  const s = String(txt || '0').replace(/[^0-9.,-]/g, '').replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function fmtEUR(n) {
  return new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(Number(n || 0));
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function fmtDateLocal(isoStr) {
  if (!isoStr) return '';
  try { return new Date(isoStr + 'T00:00:00').toLocaleDateString('it-IT'); } catch { return isoStr; }
}

function escHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[c]));
}

// ====================================
// STATE
// ====================================
let payments = [];
let deadlines = [];

// ====================================
// API PUBBLICA (usata da order.js)
// ====================================
window.__fabfix = {
  /** Inizializza lo stato da dati salvati (chiamata da order.js dopo loadOrderForEdit) */
  init({ payments: p, deadlines: d } = {}) {
    payments = Array.isArray(p) ? p.map(sanitizePayment) : [];
    deadlines = Array.isArray(d) ? d.map(sanitizeDeadline) : [];
    renderPaymentsUI();
    renderDueUI();
  },
  getPayments() { return payments.slice(); },
  getDeadlines() { return deadlines.slice(); },
};

// Se order.js ha già caricato i dati prima di noi, processiamo subito
if (window.__fabfix_pending_init) {
  window.__fabfix.init(window.__fabfix_pending_init);
  delete window.__fabfix_pending_init;
}

function sanitizePayment(p) {
  return {
    id: p.id || genId(),
    amount: Number(p.amount) || 0,
    method: String(p.method || 'Bonifico Bancario'),
    reference: String(p.reference || ''),
    date: String(p.date || todayISO()),
    type: String(p.type || 'acconto'),
  };
}

function sanitizeDeadline(d) {
  return {
    id: d.id || genId(),
    amount: Number(d.amount) || 0,
    date: String(d.date || ''),
    note: String(d.note || ''),
  };
}

// ====================================
// MODAL PAGAMENTO
// ====================================
const openBtn = qs('registerPaymentBtn');
const modal = qs('paymentModal');
const modalBackdrop = qs('paymentModalBackdrop');
const closeBtns = [qs('paymentModalClose'), qs('paymentModalCancel')].filter(Boolean);
const applyBtn = qs('paymentModalApply');

function openModal() {
  if (!modal) return;
  // Pre-popola la data con oggi se non valorizzata
  const payDateModal = qs('payDateModal');
  if (payDateModal && !payDateModal.value) payDateModal.value = todayISO();
  // Pre-popola l'importo con il residuo corrente
  const depositAmountModal = qs('depositAmountModal');
  if (depositAmountModal && !depositAmountModal.value) {
    const residual = Math.max(0, getGrandTotal() - calcTotalPaid());
    if (residual > 0) depositAmountModal.value = residual.toFixed(2);
  }
  modal.classList.remove('hidden');
  modalBackdrop?.classList.remove('hidden');
  document.body.classList.add('modal-open');
}

function closeModal() {
  modal?.classList.add('hidden');
  modalBackdrop?.classList.add('hidden');
  document.body.classList.remove('modal-open');
}

openBtn?.addEventListener('click', (e) => { e.preventDefault(); openModal(); });
modalBackdrop?.addEventListener('click', closeModal);
closeBtns.forEach(b => b.addEventListener('click', (e) => { e.preventDefault(); closeModal(); }));

// Applica pagamento: aggiunge all'array payments[]
applyBtn?.addEventListener('click', (e) => {
  e.preventDefault();

  const type = qs('paymentStatusModal')?.value || 'acconto';
  const amountRaw = String(qs('depositAmountModal')?.value || '0').replace(',', '.');
  const amount = Number(amountRaw);
  const method = qs('paymentMethodModal')?.value || 'Bonifico Bancario';
  const reference = String(qs('ibanModal')?.value || '');
  const date = qs('payDateModal')?.value || todayISO();

  if (!Number.isFinite(amount) || amount <= 0) {
    alert('Inserisci un importo valido.');
    return;
  }

  const total = getGrandTotal();
  const alreadyPaid = calcTotalPaid();
  const remaining = Math.max(0, total - alreadyPaid);

  // Per "saldo / incassato" paghiamo esattamente il residuo
  const finalAmount = (type === 'incassato') ? (remaining > 0 ? remaining : amount) : amount;

  if (type !== 'incassato' && remaining <= 0 && total > 0) {
    alert("L'ordine risulta già completamente pagato.");
    return;
  }

  payments.push(sanitizePayment({ id: genId(), amount: finalAmount, method, reference, date, type }));

  // Reset campi modal
  if (qs('depositAmountModal')) qs('depositAmountModal').value = '';
  if (qs('ibanModal')) qs('ibanModal').value = '';
  if (qs('payDateModal')) qs('payDateModal').value = '';

  renderPaymentsUI();
  closeModal();
});

// ====================================
// RENDER PAGAMENTI
// ====================================
const grandTotalEl = qs('grandTotal');
const paidValueEl = qs('paidValue');
const residualValueEl = qs('residualValue');
const paymentsListEl = qs('paymentsListNew');
const payResidualHidden = qs('payResidual');
const payTotalEl = qs('payTotal');

function getGrandTotal() {
  return parseEuroLikeText(grandTotalEl?.textContent);
}

function calcTotalPaid() {
  return payments.reduce((s, p) => s + (Number(p.amount) || 0), 0);
}

function renderPaymentsUI() {
  const total = getGrandTotal();
  const paid = calcTotalPaid();
  const residual = Math.max(0, total - paid);

  if (payTotalEl) payTotalEl.textContent = fmtEUR(total);
  if (paidValueEl) paidValueEl.textContent = fmtEUR(paid);
  if (residualValueEl) residualValueEl.textContent = fmtEUR(residual);
  if (payResidualHidden) payResidualHidden.textContent = fmtEUR(residual);

  // Aggiorna display residuo nella sezione Scadenze
  const dueResidualEl = qs('dueResidualDisplay');
  if (dueResidualEl) dueResidualEl.textContent = fmtEUR(residual);

  // Auto-popola importo scadenza con il residuo (solo se campo vuoto e lista scadenze vuota)
  const dueAmountEl = qs('dueAmount');
  if (dueAmountEl && !(Number(dueAmountEl.value) > 0) && residual > 0 && !deadlines.length) {
    dueAmountEl.value = residual.toFixed(2);
    renderDueUI();
  }

  if (!paymentsListEl) return;
  paymentsListEl.innerHTML = '';

  if (!payments.length) {
    const d = document.createElement('div');
    d.className = 'muted small';
    d.textContent = 'Nessun pagamento registrato.';
    paymentsListEl.appendChild(d);
    return;
  }

  payments.forEach((pay, idx) => {
    const item = document.createElement('div');
    item.className = 'payment-item';
    const sub = [pay.type, fmtDateLocal(pay.date), pay.reference].filter(Boolean).join(' • ');
    item.innerHTML = `
      <div class="payment-left">
        <div class="payment-title">${escHtml(pay.method)} <strong>${fmtEUR(pay.amount)}</strong></div>
        ${sub ? `<div class="payment-sub">${escHtml(sub)}</div>` : ''}
      </div>
      <button class="btn btn-light" type="button">Storna</button>
    `;
    item.querySelector('button')?.addEventListener('click', () => {
      const i = payments.findIndex(p => p.id === pay.id);
      if(i !== -1) payments.splice(i, 1);
      renderPaymentsUI();
    });
    paymentsListEl.appendChild(item);
  });
}

// Observer: quando cambia il totale ordine, aggiorna i display
const obs = new MutationObserver(renderPaymentsUI);
if (grandTotalEl) obs.observe(grandTotalEl, { childList: true, subtree: true });

renderPaymentsUI();

// ====================================
// RENDER SCADENZE
// ====================================
const miniDueTotalEl = qs('miniDueTotal');
const dueAmountInputEl = qs('dueAmount');
const dueDateInputEl = qs('dueDate');
const dueNoteInputEl = qs('dueNote');
const dueAlertEl = qs('dueAlert');
const deadlinesListEl = qs('deadlinesList');

function renderDueUI() {
  const total = deadlines.reduce((s, d) => s + (Number(d.amount) || 0), 0);
  if (miniDueTotalEl) miniDueTotalEl.textContent = fmtEUR(total);

  if (deadlinesListEl) {
    deadlinesListEl.innerHTML = '';
    if (!deadlines.length) {
      const d = document.createElement('div');
      d.className = 'muted small';
      d.textContent = 'Nessuna scadenza registrata.';
      deadlinesListEl.appendChild(d);
    } else {
      deadlines.forEach((due, idx) => {
        const item = document.createElement('div');
        item.className = 'payment-item';
        const today = new Date(todayISO() + 'T00:00:00');
        const dueDate = due.date ? new Date(due.date + 'T00:00:00') : null;
        const isOverdue = dueDate && dueDate < today;
        const diffDays = isOverdue ? Math.round((today - dueDate) / 86400000) : 0;
        const dateStr = fmtDateLocal(due.date);
        item.innerHTML = `
          <div class="payment-left">
            <div class="payment-title">${escHtml(dateStr)} <strong>${fmtEUR(due.amount)}</strong></div>
            ${due.note ? `<div class="payment-sub">${escHtml(due.note)}</div>` : ''}
            ${isOverdue ? `<div class="payment-sub" style="color:#92400e;">⚠️ Scaduta da ${diffDays} giorn${diffDays === 1 ? 'o' : 'i'}</div>` : ''}
          </div>
          <button class="btn btn-light" type="button">Rimuovi</button>
        `;
        item.querySelector('button')?.addEventListener('click', () => {
          const i = deadlines.findIndex(d => d.id === due.id);
          if(i !== -1) deadlines.splice(i, 1);
          renderDueUI();
        });
        deadlinesListEl.appendChild(item);
      });
    }
  }

  // Alert per il campo input corrente
  if (!dueAlertEl) return;
  const dueVal = dueDateInputEl?.value;
  const amount = parseFloat(String(dueAmountInputEl?.value || '0').replace(',', '.')) || 0;
  if (dueVal && amount > 0) {
    const dueDate = new Date(dueVal + 'T00:00:00');
    const today = new Date(todayISO() + 'T00:00:00');
    if (dueDate < today) {
      const diffDays = Math.round((today - dueDate) / 86400000);
      dueAlertEl.textContent = `⚠️ Data passata da ${diffDays} giorn${diffDays === 1 ? 'o' : 'i'}`;
      dueAlertEl.classList.remove('hidden');
      return;
    }
  }
  dueAlertEl.textContent = '';
  dueAlertEl.classList.add('hidden');
}

dueAmountInputEl?.addEventListener('input', renderDueUI);
dueAmountInputEl?.addEventListener('change', renderDueUI);
dueDateInputEl?.addEventListener('change', renderDueUI);
renderDueUI();

// Aggiungi scadenza alla lista
const addDeadlineBtn = qs('addDeadlineBtn');
addDeadlineBtn?.addEventListener('click', (e) => {
  e.preventDefault();
  const date = dueDateInputEl?.value || '';
  const amountRaw = String(dueAmountInputEl?.value || '').replace(',', '.');
  const amount = Number(amountRaw);
  const note = String(dueNoteInputEl?.value || '').trim();

  if (!date) {
    alert('Seleziona una data scadenza.');
    return;
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    alert('Inserisci un importo scadenza valido.');
    return;
  }

  deadlines.push(sanitizeDeadline({ id: genId(), amount, date, note }));

  // Reset form
  if (dueDateInputEl) dueDateInputEl.value = '';
  if (dueAmountInputEl) dueAmountInputEl.value = '';
  if (dueNoteInputEl) dueNoteInputEl.value = '';
  if (dueAlertEl) { dueAlertEl.textContent = ''; dueAlertEl.classList.add('hidden'); }

  renderDueUI();
});
