// nav.js (module)
// Floating AI Assistant + optional actions (promemoria/spese/incassi) with Firestore integration.

import { auth, db, collection, addDoc, getDocs, serverTimestamp, query, orderBy, limit } from './firebase.js';
import {
  onAuthStateChanged,
  signOut,
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';

// ---- Helpers ----
const qs = (sel, root=document) => root.querySelector(sel);
const qsa = (sel, root=document) => Array.from(root.querySelectorAll(sel));

function escapeHtml(str){
  return String(str ?? '').replace(/[&<>"']/g, (ch) => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[ch]));
}

function todayISO(){
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth()+1).padStart(2,'0');
  const dd = String(d.getDate()).padStart(2,'0');
  return `${yyyy}-${mm}-${dd}`;
}

function toISODateTime(dateISO, timeHHMM){
  const [y,m,d] = String(dateISO).split('-').map(n=>parseInt(n,10));
  const [hh,mm] = String(timeHHMM || '09:00').split(':').map(n=>parseInt(n,10));
  const dt = new Date(y, (m||1)-1, d||1, hh||0, mm||0, 0, 0);
  return dt.toISOString();
}

function addMinutes(iso, minutes){
  const d = new Date(iso);
  d.setMinutes(d.getMinutes() + (Number(minutes)||0));
  return d.toISOString();
}

function parseJsonLoose(text){
  const t = String(text || '').trim();
  // try direct
  try { return JSON.parse(t); } catch {}
  // try extract first {...}
  const m = t.match(/\{[\s\S]*\}/);
  if (m){
    try { return JSON.parse(m[0]); } catch {}
  }
  return null;
}

// In questo gestionale l'accesso potrebbe essere pubblico (senza login).
// Quindi NON dobbiamo bloccare l'UI in attesa di Auth: al massimo aspettiamo poco,
// poi proseguiamo comunque.
async function waitForAuth(timeoutMs = 1500){
  try{
    if (auth && auth.currentUser) return auth.currentUser;
  }catch{}

  return await new Promise((resolve) => {
    let done = false;
    const finish = (u) => {
      if (done) return;
      done = true;
      try{ unsub && unsub(); }catch{}
      resolve(u || null);
    };

    let unsub = null;
    try{
      unsub = onAuthStateChanged(auth, (u) => { if (u) finish(u); });
    }catch{
      // auth non disponibile: proseguiamo
      finish(null);
      return;
    }

    setTimeout(() => finish(null), timeoutMs);
  });
}

// ---- Styles ----
(function injectStyles(){
  if (qs('#ai-assistant-styles')) return;
  const style = document.createElement('style');
  style.id = 'ai-assistant-styles';
  style.textContent = `
    .ai-fab{position:fixed;right:18px;bottom:calc(18px + env(safe-area-inset-bottom) + var(--ai-bottom-extra, 0px));z-index:9999;width:54px;height:54px;border-radius:50%;
      border:none;cursor:pointer;background:rgba(20,140,255,.95);box-shadow:0 10px 25px rgba(0,0,0,.25);
      display:flex;align-items:center;justify-content:center;}
    .ai-fab:active{transform:scale(.98)}
    .ai-fab span{font-weight:800;color:#fff;font-size:18px;letter-spacing:.5px}

    .ai-modal-backdrop{position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:10000;display:flex;
      align-items:flex-end;justify-content:flex-end;padding:14px;}
    .ai-modal{width:min(420px, 100%);max-height:min(75vh, 720px);background:rgba(22,34,47,.96);
      border:1px solid rgba(255,255,255,.12);border-radius:16px;overflow:hidden;box-shadow:0 20px 50px rgba(0,0,0,.45);
      backdrop-filter: blur(10px);display:flex;flex-direction:column;}
    .ai-hdr{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:12px 12px 10px;
      border-bottom:1px solid rgba(255,255,255,.10)}
    .ai-hdr .title{display:flex;flex-direction:column;line-height:1.1}
    .ai-hdr .title b{color:#fff;font-size:14px}
    .ai-hdr .title small{color:rgba(255,255,255,.65);font-size:12px}
    .ai-btn{border:1px solid rgba(255,255,255,.18);background:rgba(255,255,255,.06);color:#fff;
      border-radius:10px;padding:8px 10px;cursor:pointer;font-size:12px}
    .ai-btn:hover{background:rgba(255,255,255,.10)}

    .ai-quick{display:flex;gap:8px;flex-wrap:wrap;padding:10px 12px;border-bottom:1px solid rgba(255,255,255,.10)}
    .ai-chip{border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.05);color:#fff;
      border-radius:999px;padding:6px 10px;font-size:12px;cursor:pointer}
    .ai-chip:hover{background:rgba(255,255,255,.09)}

    .ai-log{padding:12px;overflow:auto;display:flex;flex-direction:column;gap:10px;}
    .ai-msg{max-width:92%;padding:10px 12px;border-radius:14px;font-size:13px;line-height:1.35;white-space:pre-wrap;word-break:break-word}
    .ai-msg.user{align-self:flex-end;background:rgba(20,140,255,.22);border:1px solid rgba(20,140,255,.35);color:#fff}
    .ai-msg.bot{align-self:flex-start;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.12);color:#fff}
    .ai-msg.meta{align-self:flex-start;background:rgba(0,0,0,.22);border:1px dashed rgba(255,255,255,.18);color:rgba(255,255,255,.85)}

    .ai-foot{display:flex;flex-direction:column;gap:8px;padding:10px 12px;border-top:1px solid rgba(255,255,255,.10)}
    .ai-tog{display:flex;align-items:center;gap:10px;color:rgba(255,255,255,.75);font-size:12px}
    .ai-tog input{transform:scale(1.05)}
    .ai-row{display:flex;gap:8px}
    .ai-inp{flex:1;border:1px solid rgba(255,255,255,.16);background:rgba(0,0,0,.25);color:#fff;
      border-radius:12px;padding:10px 12px;font-size:13px;outline:none}
    .ai-inp:focus{border-color:rgba(20,140,255,.55)}

    .ai-warn{color:#ffd6a5}
    .ai-ok{color:#b7ffcb}
  `;
  document.head.appendChild(style);
})()
// iOS Safari: the bottom toolbar can cover fixed buttons.
// We add a small extra offset so the AI button stays clickable.
;(function setIOSBottomOffset(){
  try{
    const ua = navigator.userAgent || '';
    const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    if (!isIOS) return;
    // Extra lift above Safari toolbar (ignored on desktop).
    document.documentElement.style.setProperty('--ai-bottom-extra', '64px');
  }catch(e){}
})();
;

// ---- UI ----
let modal = null;
let includeData = true;
let lastContextCache = null;
let lastContextAt = 0;

function ensureFab(){
  if (qs('#ai-fab')) return;
  const btn = document.createElement('button');
  btn.className = 'ai-fab';
  btn.id = 'ai-fab';
  btn.title = 'Assistente AI';
  btn.innerHTML = '<span>AI</span>';
  btn.addEventListener('click', openModal);
  document.body.appendChild(btn);

  // Pulsante logout piccolo, in basso a sinistra
  if (!qs('#nav-logout-btn')) {
    const logoutBtn = document.createElement('button');
    logoutBtn.id = 'nav-logout-btn';
    logoutBtn.title = 'Esci';
    logoutBtn.textContent = '⏏';
    logoutBtn.style.cssText = [
      'position:fixed','bottom:18px','left:18px','z-index:9999',
      'width:44px','height:44px','border-radius:50%','border:none',
      'background:rgba(255,255,255,.12)','color:#fff','font-size:18px',
      'cursor:pointer','box-shadow:0 4px 14px rgba(0,0,0,.25)',
    ].join(';');
    logoutBtn.addEventListener('click', async () => {
      if (!confirm('Uscire dal gestionale?')) return;
      try { await signOut(auth); } catch {}
      window.location.replace('/login.html');
    });
    document.body.appendChild(logoutBtn);
  }
}

function openModal(){
  if (modal) return;
  const backdrop = document.createElement('div');
  backdrop.className = 'ai-modal-backdrop';
  backdrop.addEventListener('click', (e)=>{ if (e.target === backdrop) closeModal(); });

  const box = document.createElement('div');
  box.className = 'ai-modal';
  box.innerHTML = `
    <div class="ai-hdr">
      <div class="title">
        <b>Assistente</b>
        <small>chat + azioni rapide</small>
      </div>
      <div style="display:flex;gap:8px;align-items:center">
        <button class="ai-btn" data-act="clear">Pulisci</button>
        <button class="ai-btn" data-act="close">✕</button>
      </div>
    </div>

    <div class="ai-quick">
      <button class="ai-chip" data-q="riepilogo">📊 Riepilogo</button>
      <button class="ai-chip" data-q="promemoria">➕ Promemoria</button>
      <button class="ai-chip" data-q="spesa">➕ Spesa</button>
      <button class="ai-chip" data-q="incasso">➕ Incasso</button>
      <button class="ai-chip" data-q="help">❓ Cosa posso fare?</button>
    </div>

    <div class="ai-log" id="ai-log"></div>

    <div class="ai-foot">
      <label class="ai-tog"><input type="checkbox" id="ai-include" checked /> Includi dati (Firestore)</label>
      <div class="ai-row">
        <input class="ai-inp" id="ai-input" placeholder="Scrivi qui…" />
        <button class="ai-btn" id="ai-send">Invia</button>
      </div>
      <div class="ai-tog" style="justify-content:space-between">
        <span id="ai-status"></span>
        <span style="opacity:.6">Esc per chiudere</span>
      </div>
    </div>
  `;

  backdrop.appendChild(box);
  document.body.appendChild(backdrop);
  modal = backdrop;

  const logEl = qs('#ai-log', box);
  const inputEl = qs('#ai-input', box);
  const sendBtn = qs('#ai-send', box);
  const statusEl = qs('#ai-status', box);
  const includeEl = qs('#ai-include', box);

  includeEl.checked = includeData;
  includeEl.addEventListener('change', ()=>{ includeData = includeEl.checked; });

  function addMsg(text, who='bot', cls=''){ 
    const div = document.createElement('div');
    div.className = `ai-msg ${who} ${cls}`.trim();
    div.textContent = text;
    logEl.appendChild(div);
    logEl.scrollTop = logEl.scrollHeight;
  }

  const greet = [
    'Ciao! Posso aiutarti con riepiloghi e anche creare promemoria/spese/incassi.',
    'Suggerimento: usa i bottoni rapidi qui sopra, oppure scrivi “fammi un riepilogo settimana”.'
  ].join('\n');
  addMsg(greet, 'bot');

  box.addEventListener('click', (e)=>{
    const act = e.target?.dataset?.act;
    if (act === 'close') closeModal();
    if (act === 'clear') { logEl.innerHTML=''; addMsg(greet,'bot'); }
    const q = e.target?.dataset?.q;
    if (q) handleQuick(q);
  });

  async function handleQuick(q){
    if (q === 'help'){
      addMsg('Posso:\n- Rispondere alle domande (chat)\n- 📊 Fare un riepilogo (usando i dati Firestore)\n- ➕ Creare un promemoria in Agenda\n- ➕ Registrare una Spesa\n- ➕ Registrare un Incasso\n\nDimmi cosa ti serve.', 'bot');
      return;
    }

    if (q === 'riepilogo'){
      await sendUserMessage('Fammi un riepilogo rapido (clienti, fornitori, incassi, spese, scadenze) e dimmi 3 cose da controllare oggi.');
      return;
    }

    if (q === 'promemoria'){
      const text = prompt('Descrivi il promemoria (es: “Chiamare Mario domani alle 10 per preventivo”)');
      if (!text) return;
      await createPromemoriaFromText(text);
      return;
    }

    if (q === 'spesa'){
      const text = prompt('Descrivi la spesa (es: “Benzina 45 euro oggi”)');
      if (!text) return;
      await createMovimentoFromText('spesa', text);
      return;
    }

    if (q === 'incasso'){
      const text = prompt('Descrivi l\'incasso (es: “Incasso Rossi 1200 euro 2026-02-20”)');
      if (!text) return;
      await createMovimentoFromText('incasso', text);
      return;
    }
  }

  async function setStatus(msg, kind=''){
    statusEl.className = kind ? `ai-${kind}` : '';
    statusEl.textContent = msg;
  }

  async function getContextIfEnabled(){
    if (!includeData) return null;

    // cache for 30s
    const now = Date.now();
    if (lastContextCache && (now - lastContextAt) < 30000) return lastContextCache;

    await setStatus('Leggo i dati…', 'warn');
    try{
      await waitForAuth();
      const ctx = await buildContext();
      lastContextCache = ctx;
      lastContextAt = now;
      await setStatus('Dati pronti', 'ok');
      return ctx;
    }catch(err){
      console.error(err);
      await setStatus('Non riesco a leggere i dati (controlla login/regole Firestore).', 'warn');
      return null;
    }
  }

  async function sendUserMessage(text){
    const message = String(text || '').trim();
    if (!message) return;

    addMsg(message, 'user');
    inputEl.value = '';

    const ctx = await getContextIfEnabled();

    await setStatus('Sto pensando…', 'warn');
    try{
      const reply = await callAI(message, ctx);
      addMsg(reply || '(nessuna risposta)', 'bot');
      await setStatus('', '');
    }catch(err){
      console.error(err);
      addMsg('Errore: non riesco a contattare il server AI. Controlla le Functions /api/ai e la chiave OpenAI.', 'bot');
      await setStatus('Errore AI', 'warn');
    }
  }

  async function createPromemoriaFromText(text){
    addMsg(`Creo promemoria: ${text}`, 'user');
    const ctx = await getContextIfEnabled();

    await setStatus('Creo il promemoria…', 'warn');
    try{
      const spec = await callAIJson(
        'Estrai un promemoria e rispondi SOLO con JSON.',
        {
          task: 'promemoria',
          input: text,
          constraints: {
            date_format: 'YYYY-MM-DD',
            time_format: 'HH:MM (24h)',
            duration_minutes_default: 30
          }
        },
        ctx
      );

      if (!spec || !spec.title){
        addMsg('Non ho capito bene il promemoria. Riprova con una frase più chiara (data/ora).', 'bot');
        await setStatus('', '');
        return;
      }

      const date = spec.date || todayISO();
      const time = spec.time || '09:00';
      const duration = Number(spec.durationMinutes || 30);
      const start = toISODateTime(date, time);
      const end = addMinutes(start, duration);

      await waitForAuth();
      await addDoc(collection(db, 'agendaEvents'), {
        title: String(spec.title).trim(),
        start,
        end,
        allDay: false,
        notes: String(spec.notes || '').trim(),
        createdAt: serverTimestamp(),
        source: 'ai'
      });

      addMsg(`✅ Promemoria creato in Agenda: ${spec.title} (${date} ${time})`, 'bot');
      await setStatus('', '');

    }catch(err){
      console.error(err);
      addMsg('Errore nel creare il promemoria. Controlla Firestore e riprova.', 'bot');
      await setStatus('Errore', 'warn');
    }
  }

  async function createMovimentoFromText(kind, text){
    const label = kind === 'spesa' ? 'Spesa' : 'Incasso';
    addMsg(`Registro ${label.toLowerCase()}: ${text}`, 'user');
    const ctx = await getContextIfEnabled();

    await setStatus(`Registro ${label.toLowerCase()}…`, 'warn');
    try{
      const spec = await callAIJson(
        `Estrai un ${label} e rispondi SOLO con JSON.`,
        {
          task: kind,
          input: text,
          constraints: {
            date_format: 'YYYY-MM-DD',
            amount_number: true
          }
        },
        ctx
      );

      const date = spec?.date || todayISO();
      const description = String(spec?.description || spec?.desc || spec?.title || label).trim();
      const amount = Number(spec?.amount ?? spec?.value ?? 0);

      if (!amount || !isFinite(amount)){
        addMsg(`Non ho capito l'importo del ${label.toLowerCase()}. Scrivi ad esempio: “${label} 120 euro oggi”.`, 'bot');
        await setStatus('', '');
        return;
      }

      await waitForAuth();
      const col = kind === 'spesa' ? 'spese' : 'incassi';
      await addDoc(collection(db, col), {
        date,
        description,
        amount,
        createdAt: serverTimestamp(),
        source: 'ai'
      });

      addMsg(`✅ ${label} registrato: ${description} — ${amount.toFixed(2)} € (${date})`, 'bot');
      await setStatus('', '');

    }catch(err){
      console.error(err);
      addMsg(`Errore nel registrare ${label.toLowerCase()}. Controlla Firestore e riprova.`, 'bot');
      await setStatus('Errore', 'warn');
    }
  }

  // Send on Enter
  inputEl.addEventListener('keydown', (e)=>{
    if (e.key === 'Enter') sendUserMessage(inputEl.value);
    if (e.key === 'Escape') closeModal();
  });

  sendBtn.addEventListener('click', ()=> sendUserMessage(inputEl.value));

  document.addEventListener('keydown', escListener);
  function escListener(e){
    if (e.key === 'Escape') closeModal();
  }

  // focus
  setTimeout(()=> inputEl.focus(), 30);
}

function closeModal(){
  if (!modal) return;
  document.removeEventListener('keydown', ()=>{});
  modal.remove();
  modal = null;
}

// ---- Context builder ----
async function countCollection(colName, max=500){
  // lightweight: just read up to max docs and count
  const snap = await getDocs(query(collection(db, colName), limit(max)));
  return snap.size;
}

async function sumLastN(colName, n=200){
  // expects docs with {date:'YYYY-MM-DD', amount:number}
  const snap = await getDocs(query(collection(db, colName), orderBy('date','desc'), limit(n)));
  let total30 = 0;
  let total7 = 0;
  const now = new Date();
  const d30 = new Date(now); d30.setDate(d30.getDate()-30);
  const d7 = new Date(now); d7.setDate(d7.getDate()-7);

  snap.forEach(docu=>{
    const d = docu.data() || {};
    const dateStr = d.date;
    const amt = Number(d.amount || 0);
    if (!dateStr || !isFinite(amt)) return;
    const dt = new Date(dateStr + 'T00:00:00');
    if (dt >= d30) total30 += amt;
    if (dt >= d7) total7 += amt;
  });

  return { total7, total30 };
}

async function buildContext(){
  const [
    clients, suppliers, scadenze, preventivi, ordersClienti, ordersFornitori,
    incassiSum, speseSum
  ] = await Promise.all([
    countCollection('clients'),
    countCollection('suppliers'),
    countCollection('scadenze'),
    countCollection('preventivi'),
    countCollection('ordersClienti'),
    countCollection('ordersFornitori'),
    sumLastN('incassi'),
    sumLastN('spese'),
  ]);

  return {
    app: 'DCR GROUP Gestionale',
    page: location.pathname,
    counts: { clients, suppliers, scadenze, preventivi, ordersClienti, ordersFornitori },
    incassi: incassiSum,
    spese: speseSum,
    generatedAt: new Date().toISOString()
  };
}

// ---- AI Calls ----
async function callAI(userText, context){
  const body = { message: userText, context: (context && typeof context === "object") ? JSON.stringify(context, null, 2) : context };
  const res = await fetch('/api/ai', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok){
    const t = await res.text().catch(()=> '');
    throw new Error(`AI HTTP ${res.status}: ${t}`);
  }
  const data = await res.json();
  return data?.reply || data?.text || data?.message || "";
}

async function callAIJson(systemInstruction, payload, context){
  // We reuse the same endpoint, but we instruct the model to return JSON.
  // Backend returns plain text; we parse.
  const message = [
    systemInstruction,
    'Regole IMPORTANTI:',
    '- Rispondi SOLO con JSON valido (niente markdown, niente testo extra).',
    '- Se un campo non è noto, omettilo o usa null.',
    '- Non includere commenti.',
    '',
    `INPUT_JSON: ${JSON.stringify(payload)}`
  ].join('\n');

  const reply = await callAI(message, context);
  const parsed = parseJsonLoose(reply);
  if (!parsed) throw new Error('AI JSON parse failed');
  return parsed;
}

// Init
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', ensureFab);
} else {
  ensureFab();
}
