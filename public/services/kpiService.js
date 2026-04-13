// services/kpiService.js
// Centralized KPI math. Never queries Firestore directly.

import {
  getNormalizedIncomesAndOrders,
  getDailyIncomesTotal,
  getMonthlyIncomesTotal,
  getYearlyIncomesTotal,
} from "./incomeService.js";
import { firestoreService as fs } from "./firestoreService.js";
import { QUERY } from "./queryRegistry.js";
import { normalizeExpense, normalizeDeadline, normalizeOrder } from "./schemaService.js";

function todayISO() {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}

function ymFromISO(iso) {
  return String(iso || "").slice(0, 7);
}

function yearFromISO(iso) {
  return Number(String(iso || "").slice(0, 4)) || new Date().getFullYear();
}

function monthFromISO(iso) {
  return Number(String(iso || "").slice(5, 7)) || new Date().getMonth() + 1;
}

/**
 * Compute income KPIs for a given reference date.
 * @param {string|object} refDateInput - ISO date string or {todayISO, year, month}
 * @returns {Promise<object>} KPI values: incassoOggi, incassoMese, incassoAnno, fatturatoMese, …
 */
export async function getIncassiKpis(refDateInput = todayISO()) {
  const refDateISO = typeof refDateInput === "object"
    ? String(refDateInput.todayISO || `${refDateInput.year}-${String(refDateInput.month || 1).padStart(2,"0")}-01`)
    : String(refDateInput || todayISO());
  const y = typeof refDateInput === "object" && refDateInput.year ? Number(refDateInput.year) : yearFromISO(refDateISO);
  const m = typeof refDateInput === "object" && refDateInput.month ? Number(refDateInput.month) : monthFromISO(refDateISO);

  const [oggi, mese, anno] = await Promise.all([
    getDailyIncomesTotal(refDateISO),
    getMonthlyIncomesTotal(y, m),
    getYearlyIncomesTotal(y),
  ]);

  const { orders } = await getNormalizedIncomesAndOrders();
  const ym = `${y}-${String(m).padStart(2, "0")}`;
  const fattMese = orders
    .filter((o) => String(o.createdAtISO || "").startsWith(ym))
    .reduce((s, o) => s + (o.total || 0), 0);

  const restante = orders
    .filter((o) => String(o.createdAtISO || "").startsWith(ym) && (o.deposit || 0) > 0)
    .reduce((s, o) => s + Math.max(0, (o.total || 0) - (o.deposit || 0)), 0);

  const date = new Date(refDateISO + "T00:00:00");
  const start = new Date(date);
  start.setDate(start.getDate() - 29);
  const { incomes } = await getNormalizedIncomesAndOrders();
  const sum30 = incomes
    .filter((i) => {
      const d = new Date(i.dateISO + "T00:00:00");
      return d >= start && d <= date;
    })
    .reduce((s, i) => s + i.amount, 0);
  const media30 = sum30 / 30;

  return {
    dateISO: refDateISO,
    incassoOggi: Number(oggi.toFixed(2)),
    incassoMese: Number(mese.toFixed(2)),
    incassoAnno: Number(anno.toFixed(2)),
    fatturatoMese: Number(fattMese.toFixed(2)),
    restanteDaIncassareMese: Number(restante.toFixed(2)),
    mediaIncasso30: Number(media30.toFixed(2)),
    today: Number(oggi.toFixed(2)),
    month: Number(mese.toFixed(2)),
    year: Number(anno.toFixed(2)),
    ordersMonthRevenue: Number(fattMese.toFixed(2)),
    avg30: Number(media30.toFixed(2)),
    debug: { year: y, month: m, ym },
  };
}

/**
 * Compute expense KPIs for a given reference month.
 * @param {string} refDateISO - ISO date string (YYYY-MM-DD)
 * @returns {Promise<{speseMese: number, speseAnno: number}>}
 */
export async function getSpeseKpis(refDateISO = todayISO()) {
  const y = yearFromISO(refDateISO);
  const ym = ymFromISO(refDateISO);
  const expRaw = await fs.getAllFromQuery(QUERY.EXPENSES_ALL(), { name: "EXPENSES_ALL" });
  const exp = expRaw.map(normalizeExpense);
  const mese = exp.filter((e) => String(e.dateISO || "").startsWith(ym)).reduce((s, e) => s + e.amount, 0);
  const anno = exp.filter((e) => String(e.dateISO || "").startsWith(String(y) + "-")).reduce((s, e) => s + e.amount, 0);
  return { speseMese: Number(mese.toFixed(2)), speseAnno: Number(anno.toFixed(2)) };
}

/**
 * Compute deadline KPIs for a given reference month.
 * @param {string} refDateISO - ISO date string (YYYY-MM-DD)
 * @returns {Promise<{scadenzeMese: number, scadenzeAnno: number}>}
 */
export async function getScadenzeKpis(refDateISO = todayISO()) {
  const y = yearFromISO(refDateISO);
  const ym = ymFromISO(refDateISO);
  const raw = await fs.getAllFromQuery(QUERY.DEADLINES_ALL(), { name: "DEADLINES_ALL" });
  const sc = raw.map(normalizeDeadline);
  const mese = sc.filter((d) => String(d.dateISO || "").startsWith(ym)).reduce((s, d) => s + d.amount, 0);
  const anno = sc.filter((d) => String(d.dateISO || "").startsWith(String(y) + "-")).reduce((s, d) => s + d.amount, 0);
  return { scadenzeMese: Number(mese.toFixed(2)), scadenzeAnno: Number(anno.toFixed(2)) };
}

/**
 * Compute orders KPIs for a given reference month.
 * @param {string} refDateISO - ISO date string (YYYY-MM-DD)
 * @returns {Promise<{ordiniFatturatoMese: number, ordiniFatturatoAnno: number}>}
 */
export async function getOrdersKpis(refDateISO = todayISO()) {
  const y = yearFromISO(refDateISO);
  const ym = ymFromISO(refDateISO);
  const ordersRaw = await fs.getAllFromQuery(QUERY.ORDERS_ALL(), { name: "ORDERS_ALL" });
  const orders = ordersRaw.map(normalizeOrder);
  const meseTot = orders.filter((o) => String(o.createdAtISO || "").startsWith(ym)).reduce((s, o) => s + (o.total || 0), 0);
  const annoTot = orders.filter((o) => String(o.createdAtISO || "").startsWith(String(y) + "-")).reduce((s, o) => s + (o.total || 0), 0);
  return { ordiniFatturatoMese: Number(meseTot.toFixed(2)), ordiniFatturatoAnno: Number(annoTot.toFixed(2)) };
}
