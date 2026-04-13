
function ensureTextEditorModal(){
  let modal = document.getElementById('textEditorModal');
  if(modal) return modal;
  modal = document.createElement('div');
  modal.id = 'textEditorModal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,.58);display:none;align-items:center;justify-content:center;z-index:99999;padding:18px;';
  modal.innerHTML = `
    <div style="width:min(720px,100%);background:#0f172a;color:#fff;border-radius:18px;padding:16px;box-shadow:0 20px 60px rgba(0,0,0,.35)">
      <div style="font-size:18px;font-weight:800;margin-bottom:10px">Modifica nota</div>
      <textarea id="textEditorModalArea" rows="8" style="width:100%;min-height:220px;border-radius:14px;border:1px solid rgba(255,255,255,.15);padding:14px;font-size:16px;line-height:1.45;resize:vertical;box-sizing:border-box"></textarea>
      <div style="display:flex;justify-content:flex-end;gap:10px;margin-top:14px">
        <button type="button" id="textEditorModalCancel" style="padding:12px 16px;border-radius:12px;border:none;background:#334155;color:#fff;font-weight:700">Annulla</button>
        <button type="button" id="textEditorModalOk" style="padding:12px 16px;border-radius:12px;border:none;background:#2563eb;color:#fff;font-weight:800">Salva</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
  return modal;
}

function openTextEditorModal(initialValue){
  const modal = ensureTextEditorModal();
  const area = document.getElementById('textEditorModalArea');
  const btnOk = document.getElementById('textEditorModalOk');
  const btnCancel = document.getElementById('textEditorModalCancel');
  area.value = String(initialValue || '');
  modal.style.display = 'flex';
  setTimeout(()=>{ try{ area.focus(); area.setSelectionRange(area.value.length, area.value.length); }catch(e){} }, 30);
  return new Promise((resolve)=>{
    const cleanup = (val)=>{
      modal.style.display = 'none';
      btnOk.onclick = null; btnCancel.onclick = null; modal.onclick = null;
      resolve(val);
    };
    btnOk.onclick = ()=> cleanup(area.value);
    btnCancel.onclick = ()=> cleanup(null);
    modal.onclick = (e)=>{ if(e.target === modal) cleanup(null); };
  });
}


function autoAmountFromNote(note){
  const s = String(note || "").trim();
  if(!s) return null;

  // Try: take a math expression at the end of the note (e.g. "Mario 10+5*2")
  const m = s.match(/([0-9][0-9\s.,+\-*/()]*?)\s*$/);
  if(m){
    let expr = m[1].replace(/\s+/g,"").replace(/,/g,".");
    // keep only safe chars
    if(/^[0-9.+\-*/()]+$/.test(expr)){
      try{
        // eslint-disable-next-line no-new-func
        const val = Function(`"use strict"; return (${expr});`)();
        if(Number.isFinite(val)) return Math.round(val*100)/100;
      }catch(e){}
    }
  }

  // Fallback: sum all numbers found in the text
  const nums = s.match(/\d+(?:[.,]\d+)?/g);
  if(!nums) return null;
  const sum = nums.reduce((acc, x) => {
    const n = Number(String(x).replace(",","."));
    return Number.isFinite(n) ? acc + n : acc;
  }, 0);
  if(!Number.isFinite(sum)) return null;
  return Math.round(sum*100)/100;
}

import { db } from "./firebase.js";
import {
  collection,
  addDoc,
  getDocs,
  query,
  where,
  deleteDoc,
  doc,
  updateDoc
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const params = new URLSearchParams(window.location.search);
const date = params.get("date");

const dayTitle = document.getElementById("dayTitle");
const noteInput = document.getElementById("noteInput");
const amountInput = document.getElementById("amountInput");
const addBtn = document.getElementById("addBtn");
const incassiList = document.getElementById("incassiList");
const dayTotalEl = document.getElementById("dayTotal");

dayTitle.textContent = `Incassi ${date}`;

async function loadIncassi() {
  const q = query(
    collection(db, "incassi"),
    where("date", "==", date)
  );

  const snap = await getDocs(q);

  incassiList.innerHTML = "";
  let total = 0;

  snap.forEach(docSnap => {
    const i = docSnap.data();
    const id = docSnap.id;

    total += Number(i.amount) || 0;

    const row = document.createElement("div");
    row.className = "day-row";

    row.innerHTML = `
      <span>${i.note}</span>
      <span>€ ${Number(i.amount).toFixed(2)}</span>
      <span>
        <button class="edit-btn">✏️</button>
        <button class="delete-btn">🗑️</button>
      </span>
    `;

    row.querySelector(".delete-btn").addEventListener("click", async () => {
      await deleteDoc(doc(db, "incassi", id));
      loadIncassi();
    });

    row.querySelector(".edit-btn").addEventListener("click", async () => {
      const newNote = await openTextEditorModal(i.note);
      const newAmount = await openTextEditorModal(i.amount);

      if (!newNote || isNaN(newAmount)) return;

      await updateDoc(doc(db, "incassi", id), {
        note: newNote,
        amount: Number(newAmount)
      });

      loadIncassi();
    });

    incassiList.appendChild(row);
  });

  dayTotalEl.textContent = total.toFixed(2);
}

noteInput?.addEventListener("input", ()=>{ if(noteInput.value.trim()) noteInput.classList.remove("field-error"); });
amountInput?.addEventListener("input", ()=>{ const v = Number(amountInput.value); if(Number.isFinite(v) && v > 0) amountInput.classList.remove("field-error"); });

addBtn.addEventListener("click", async () => {
  const note = noteInput.value.trim();
  const amount = Number(amountInput.value);
  let hasError = false;
  if (!note) { noteInput.classList.add("field-error"); hasError = true; }
  if (!amount || isNaN(amount) || amount <= 0) { amountInput.classList.add("field-error"); hasError = true; }
  if (hasError) return;

  await addDoc(collection(db, "incassi"), {
    date,
    note,
    amount
  });

  noteInput.value = "";
  amountInput.value = "";
  noteInput.classList.remove("field-error","field-ok");
  amountInput.classList.remove("field-error","field-ok");

  loadIncassi();
});

loadIncassi();
