// Node-only helpers for tests (pure functions).

export function calcOutstanding(total, deposit) {
  const t = Number(total || 0);
  const d = Number(deposit || 0);
  if (!Number.isFinite(t) || !Number.isFinite(d)) return 0;
  if (d <= 0) return 0;
  return Math.max(0, +(t - d).toFixed(2));
}

export function sumBy(items, fn) {
  return items.reduce((s, x) => s + (Number(fn(x)) || 0), 0);
}

export function buildLisapPdfRows(lines) {
  // lines: [{ prodotto, qty, prezzo }]
  const rows = [];
  let total = 0;
  for (const l of lines) {
    const qty = Number(l.qty || 0);
    const prezzo = Number(l.prezzo || 0);
    if (!Number.isFinite(qty) || qty <= 0) continue;
    if (!Number.isFinite(prezzo) || prezzo < 0) continue;
    const rowTot = +(qty * prezzo).toFixed(2);
    total += rowTot;
    rows.push({ prodotto: String(l.prodotto || "").trim(), qty, prezzo, totale: rowTot });
  }
  return { rows, total: +total.toFixed(2) };
}

export function joinClientsOrders(clients, orders) {
  // returns { ok:boolean, orphans: orderIds[] }
  const ids = new Set(clients.map((c) => c.id));
  const orphans = orders.filter((o) => o.clientId && !ids.has(o.clientId)).map((o) => o.id);
  return { ok: orphans.length === 0, orphans };
}

/**
 * Pure helper that mirrors the supplier.js markAllInvoicesPaid batch logic.
 * Given a list of invoice objects, returns the IDs that need to be updated to "pagata".
 */
export function getUnpaidInvoiceIds(invoices) {
  return invoices.filter(inv => (inv.status || "da-pagare") !== "pagata").map(inv => inv.id);
}
