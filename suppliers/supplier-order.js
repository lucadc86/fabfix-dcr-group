import { initializeApp } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-app.js";
import {
  getFirestore,
  collection,
  addDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

/* FIREBASE */
const firebaseConfig = {
  apiKey: "API_KEY",
  authDomain: "PROJECT_ID.firebaseapp.com",
  projectId: "PROJECT_ID",
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const params = new URLSearchParams(window.location.search);
const supplierId = params.get("supplierId");

const tbody = document.getElementById("tableBody");
const grandTotal = document.getElementById("grandTotal");

function addRow() {
  const tr = document.createElement("tr");
  tr.innerHTML = `
    <td><input></td>
    <td><input type="number" value="1"></td>
    <td><input type="number" value="0"></td>
    <td class="rowTotal">0</td>
    <td><button onclick="this.closest('tr').remove()">✖</button></td>
  `;
  tr.querySelectorAll("input").forEach(i =>
    i.addEventListener("input", updateTotals)
  );
  tbody.appendChild(tr);
}

function updateTotals() {
  let sum = 0;
  tbody.querySelectorAll("tr").forEach(tr => {
    const q = tr.children[1].querySelector("input").value;
    const p = tr.children[2].querySelector("input").value;
    const t = q * p;
    tr.querySelector(".rowTotal").textContent = t.toFixed(2);
    sum += t;
  });
  grandTotal.textContent = sum.toFixed(2);
}

document.getElementById("addRow").onclick = addRow;

document.getElementById("saveOrder").onclick = async () => {
  const rows = [];
  tbody.querySelectorAll("tr").forEach(tr => {
    rows.push({
      prodotto: tr.children[0].querySelector("input").value,
      quantita: Number(tr.children[1].querySelector("input").value),
      prezzo: Number(tr.children[2].querySelector("input").value),
      totale: Number(tr.querySelector(".rowTotal").textContent)
    });
  });

  const date = new Date();

  await addDoc(collection(db, "suppliers", supplierId, "orders"), {
    data: date,
    anno: date.getFullYear(),
    mese: date.getMonth() + 1,
    righe: rows,
    totale: Number(grandTotal.textContent),
    pagato: false,
    saldato: false,
    createdAt: serverTimestamp()
  });

  // 🔔 Salva anche in Agenda
  try{
    await addDoc(collection(db, "agendaEvents"), {
      title: `Ordine fornitore`,
      start: date,
      end: date,
      allDay: true
    });
  }catch(e){ console.warn('agendaEvents add fail (supplier order)', e); }

  alert("Ordine fornitore salvato");
  history.back();
};

/* INIT */
addRow();
