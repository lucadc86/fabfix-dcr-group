import { listOrders } from './services/orderService.js';
import { getYearlyIncomesTotal } from './services/incomeService.js';
import { getIncassiKpis } from './services/kpiService.js';
import { listDeadlines } from './services/deadlineService.js';
import { listExpenses } from './services/expenseService.js';
import { firestoreService as fs } from './services/firestoreService.js';
import { auth } from './firebase.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';

const elFatt = document.getElementById('homeFatturato');
const elFattSub = document.getElementById('homeFatturatoSub');
const elInc = document.getElementById('homeIncassi');
const elIncSub = document.getElementById('homeIncassiSub');
const elForn = document.getElementById('homeFornitori');
const elScad = document.getElementById('homeScadenze');
const elSaldo = document.getElementById('homeSaldo');

function itMoney(n){
  return new Intl.NumberFormat('it-IT', { style:'currency', currency:'EUR' }).format(Number(n||0));
}

async function loadHomeSummary(){
  const now = new Date();
  const year = now.getFullYear();
  const ym = `${year}-${String(now.getMonth()+1).padStart(2,'0')}`;

  try{
    const orders = await listOrders();
    const total = orders.reduce((s,o)=>s+Number(o.total||0),0);
    if(elFatt) elFatt.textContent = itMoney(total);
    if(elFattSub) elFattSub.textContent = `${orders.length} ordini (totale)`;
  }catch(err){
    console.warn('Home fatturato error', err);
  }

  try{
    const suppliers = await fs.getAll('suppliers');
    const total = suppliers.reduce((s,x)=>s+Number(x.total||0),0);
    if(elForn) elForn.textContent = itMoney(total);
  }catch(err){
    console.warn('Home fornitori error', err);
  }

  try{
    const incAnno = await getYearlyIncomesTotal(year);
    if(elInc) elInc.textContent = itMoney(incAnno);
    if(elIncSub) elIncSub.textContent = `Totale annuo incassato ${year}`;

    // Saldo netto: incassato anno - spese anno
    const expenses = await listExpenses();
    const speseAnno = expenses
      .filter(e => String(e.dateISO || e.date || '').startsWith(String(year) + '-'))
      .reduce((s, e) => s + Number(e.amount || 0), 0);
    const saldo = incAnno - speseAnno;
    if(elSaldo){
      elSaldo.textContent = itMoney(saldo);
      elSaldo.style.color = saldo >= 0 ? '#24d366' : '#ef4444';
    }
  }catch(err){
    console.warn('Home incassi/saldo error', err);
  }

  try{
    const deadlines = await listDeadlines();
    const monthTotal = deadlines.filter((d)=>String(d.dateISO||'').startsWith(ym)).reduce((s,d)=>s+Number(d.amount||0),0);
    if(elScad) elScad.textContent = itMoney(monthTotal);
  }catch(err){
    console.warn('Home scadenze error', err);
  }
}

function waitForAuth() {
  return new Promise(resolve => {
    const unsub = onAuthStateChanged(auth, user => { unsub(); resolve(user); });
  });
}

waitForAuth().then(() => loadHomeSummary());
