
// UI helpers for modern Order page (modal pagamento, UX).
// Non modifica la logica Firestore: usa gli stessi campi che order.js già salva.

function qs(id){ return document.getElementById(id); }

const openBtn = qs("registerPaymentBtn");
const modal = qs("paymentModal");
const modalBackdrop = qs("paymentModalBackdrop");
const closeBtns = [qs("paymentModalClose"), qs("paymentModalCancel")].filter(Boolean);
const applyBtn = qs("paymentModalApply");

function openModal(){
  if(!modal) return;
  modal.classList.remove("hidden");
  modalBackdrop?.classList.remove("hidden");
  document.body.classList.add("modal-open");
}

function closeModal(){
  modal?.classList.add("hidden");
  modalBackdrop?.classList.add("hidden");
  document.body.classList.remove("modal-open");
}

openBtn?.addEventListener("click", (e)=>{ e.preventDefault(); openModal(); });
modalBackdrop?.addEventListener("click", closeModal);
closeBtns.forEach(b => b.addEventListener("click", (e)=>{ e.preventDefault(); closeModal(); }));

// Applica: forza updatePaymentUI (definita in order.js) cambiando i campi e triggerando change/input
applyBtn?.addEventListener("click", (e)=>{
  e.preventDefault();
  // trigger change so order.js ricalcola pill/residuo
  ["paymentStatus","depositAmount","paymentMethod","iban"].forEach(id=>{
    const el = qs(id);
    if(!el) return;
    el.dispatchEvent(new Event("change",{bubbles:true}));
    el.dispatchEvent(new Event("input",{bubbles:true}));
  });
  closeModal();
});


// ---- Pill + lista pagamenti (UI) ----
function parseEuroLikeText(txt){
  const s = String(txt||'0').replace(/[^0-9.,-]/g,'').replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}
function fmtEUR(n){
  return new Intl.NumberFormat('it-IT',{style:'currency',currency:'EUR'}).format(Number(n||0));
}
const grandTotalEl = qs("grandTotal");
const depositAmountEl = qs("depositAmount");
const paymentStatusEl = qs("paymentStatus");
const paidValueEl = qs("paidValue");
const residualValueEl = qs("residualValue");
const paymentsListEl = qs("paymentsListNew");
const payResidualHidden = qs("payResidual");
const payTotalEl = qs("payTotal");

const miniDueTotalEl = qs("miniDueTotal");
const dueAmountInputEl = qs("dueAmount");
const dueDateInputEl = qs("dueDate");
const dueAlertEl = qs("dueAlert");

function calcPaidResidual(){
  const total = parseEuroLikeText(grandTotalEl?.textContent);
  let paid = Number(String(depositAmountEl?.value || "0").replace(",", "."));
  if(!Number.isFinite(paid) || paid < 0) paid = 0;

  const status = paymentStatusEl?.value || "da_incassare";
  if(status === "incassato"){
    paid = total;
  } else if(status === "da_incassare"){
    paid = 0;
  } else if(status === "acconto"){
    paid = Math.min(paid, total);
  }
  const residual = Math.max(0, total - paid);
  return { total, paid, residual, status };
}

function renderPaymentsUI(){
  const { total, paid, residual, status } = calcPaidResidual();

  if(payTotalEl) payTotalEl.textContent = fmtEUR(total);
  if(paidValueEl) paidValueEl.textContent = fmtEUR(paid);
  if(residualValueEl) residualValueEl.textContent = fmtEUR(residual);
  if(payResidualHidden) payResidualHidden.textContent = fmtEUR(residual);

  if(!paymentsListEl) return;
  paymentsListEl.innerHTML = "";

  if(paid <= 0){
    const d = document.createElement("div");
    d.className = "muted small";
    d.textContent = "Nessun pagamento registrato.";
    paymentsListEl.appendChild(d);
    return;
  }

  const method = qs("paymentMethod")?.value || "Pagamento";
  const ref = qs("iban")?.value || "";
  const item = document.createElement("div");
  item.className = "payment-item";
  item.innerHTML = `
    <div class="payment-left">
      <div class="payment-title">${method} <strong>${fmtEUR(paid)}</strong></div>
      ${ref ? `<div class="payment-sub">${ref}</div>` : ``}
    </div>
    <button class="btn btn-light" type="button" id="stornaBtn">Storna</button>
  `;
  paymentsListEl.appendChild(item);

  item.querySelector("#stornaBtn")?.addEventListener("click", ()=>{
    if(paymentStatusEl) paymentStatusEl.value = "da_incassare";
    if(depositAmountEl) depositAmountEl.value = "";
    ["paymentStatus","depositAmount"].forEach(id=>{
      const el = qs(id);
      el?.dispatchEvent(new Event("change",{bubbles:true}));
      el?.dispatchEvent(new Event("input",{bubbles:true}));
    });
    renderPaymentsUI();
  });
}

const obs = new MutationObserver(renderPaymentsUI);
if(grandTotalEl) obs.observe(grandTotalEl, {childList:true,subtree:true});

["paymentStatus","depositAmount","paymentMethod","iban"].forEach(id=>{
  qs(id)?.addEventListener("change", renderPaymentsUI);
  qs(id)?.addEventListener("input", renderPaymentsUI);
});
renderPaymentsUI();

// ---- Scadenze: miniDueTotal + dueAlert ----
function renderDueUI(){
  const amount = parseFloat(String(dueAmountInputEl?.value || "0").replace(",", ".")) || 0;
  if(miniDueTotalEl) miniDueTotalEl.textContent = fmtEUR(amount);

  if(!dueAlertEl) return;
  const dueVal = dueDateInputEl?.value;
  if(dueVal && amount > 0){
    const dueDate = new Date(dueVal);
    const today = new Date();
    today.setHours(0,0,0,0);
    dueDate.setHours(0,0,0,0);
    if(dueDate < today){
      const diffDays = Math.round((today - dueDate) / 86400000);
      dueAlertEl.textContent = `⚠️ Scadenza scaduta da ${diffDays} giorn${diffDays === 1 ? "o" : "i"}`;
      dueAlertEl.classList.remove("hidden");
      return;
    }
  }
  dueAlertEl.textContent = "";
  dueAlertEl.classList.add("hidden");
}

dueAmountInputEl?.addEventListener("input", renderDueUI);
dueAmountInputEl?.addEventListener("change", renderDueUI);
dueDateInputEl?.addEventListener("change", renderDueUI);
renderDueUI();
