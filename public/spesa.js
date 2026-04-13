import { addExpense, listExpensesByDate, softDeleteExpense } from "./services/expenseService.js";

function autoAmountFromNote(note) {
  const s = String(note || "").trim();
  if (!s) return null;

  // Try: take a math expression at the end of the note (e.g. "Mario 10+5*2")
  const m = s.match(/([0-9][0-9\s.,+\-*/()]*?)\s*$/);
  if (m) {
    let expr = m[1].replace(/\s+/g, "").replace(/,/g, ".");
    // keep only safe chars
    if (/^[0-9.+\-*/()]+$/.test(expr)) {
      try {
        // eslint-disable-next-line no-new-func
        const val = Function(`"use strict"; return (${expr});`)();
        if (Number.isFinite(val)) return Math.round(val * 100) / 100;
      } catch (e) {}
    }
  }

  // Fallback: sum all numbers found in the text
  const nums = s.match(/\d+(?:[.,]\d+)?/g);
  if (!nums) return null;
  const sum = nums.reduce((acc, x) => {
    const n = Number(String(x).replace(",", "."));
    return Number.isFinite(n) ? acc + n : acc;
  }, 0);
  if (!Number.isFinite(sum)) return null;
  return Math.round(sum * 100) / 100;
}

const params = new URLSearchParams(window.location.search);
const date = params.get("date");

const dayTitle = document.getElementById("dayTitle");
const noteInput = document.getElementById("note");
const amountInput = document.getElementById("amount");
const saveBtn = document.getElementById("saveExpense");
const expensesList = document.getElementById("expensesList");
const dayTotalEl = document.getElementById("dayTotal");

if (!date) {
  alert("Data mancante");
} else {
  dayTitle.textContent = new Date(date).toLocaleDateString("it-IT");
}

noteInput?.addEventListener("input", () => {
  const auto = autoAmountFromNote(noteInput.value);
  if (auto !== null && !amountInput.value) amountInput.value = String(auto);
  if (noteInput.value.trim()) { noteInput.classList.remove('field-error'); }
});

amountInput?.addEventListener("input", () => {
  const v = Number(amountInput.value);
  if (Number.isFinite(v) && v > 0) { amountInput.classList.remove('field-error'); }
});

async function loadExpenses() {
  expensesList.innerHTML = "";
  dayTotalEl.textContent = "0.00";

  const expenses = await listExpensesByDate(date);

  let total = 0;

  for (const e of expenses) {
    total += e.amount || 0;

    const row = document.createElement("div");
    row.className = "supplier-row";

    row.innerHTML = `
      <span>${e.note || ""}</span>
      <strong>€ ${(e.amount || 0).toFixed(2)}</strong>
      <button class="delete-btn">🗑</button>
    `;

    row.querySelector(".delete-btn").onclick = async (ev) => {
      ev.stopPropagation();
      if (confirm("Eliminare spesa? (SAFE: verrà solo nascosta)")) {
        await softDeleteExpense(e.id, { page: "spesa", date });
        loadExpenses();
      }
    };

    expensesList.appendChild(row);
  }

  dayTotalEl.textContent = total.toFixed(2);
}

saveBtn.onclick = async () => {
  const note = noteInput.value.trim();
  const amount = Number(amountInput.value);

  // Inline validation
  let hasErrors = false;
  if (!note) {
    noteInput.classList.add('field-error');
    noteInput.classList.remove('field-ok');
    hasErrors = true;
  } else {
    noteInput.classList.remove('field-error');
    noteInput.classList.add('field-ok');
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    amountInput.classList.add('field-error');
    amountInput.classList.remove('field-ok');
    hasErrors = true;
  } else {
    amountInput.classList.remove('field-error');
    amountInput.classList.add('field-ok');
  }
  if (hasErrors) return;

  await addExpense({
    note,
    amount,
    date,
    createdAt: new Date().toISOString(),
  });

  noteInput.value = "";
  amountInput.value = "";
  noteInput.classList.remove('field-ok');
  amountInput.classList.remove('field-ok');

  loadExpenses();
};

loadExpenses();
