// services/exportService.js
// Utility for exporting data to CSV. No Firestore access — pure data transforms.

/**
 * Convert an array of objects to a CSV string.
 * @param {string[]} headers - Display header names (in order)
 * @param {string[]} fields  - Object field names matching headers
 * @param {object[]} rows    - Array of data objects
 * @returns {string} CSV text with BOM for Excel UTF-8 compatibility
 */
export function toCSV(headers, fields, rows) {
  const escape = (v) => {
    const s = String(v ?? '').replace(/"/g, '""');
    return /[",\n\r]/.test(s) ? `"${s}"` : s;
  };

  const lines = [
    headers.map(escape).join(','),
    ...rows.map(r => fields.map(f => escape(r[f] ?? '')).join(',')),
  ];

  // BOM for Excel UTF-8
  return '\uFEFF' + lines.join('\r\n');
}

/**
 * Trigger a CSV file download in the browser.
 * @param {string} csv      - CSV content
 * @param {string} filename - File name (without extension)
 */
export function downloadCSV(csv, filename) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${filename}.csv`;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
}

// ── Preset exporters for each entity type ──

export function exportIncassi(incomes) {
  const headers = ['Data', 'Cliente', 'Importo (€)', 'Tipo', 'Note', 'ID Ordine'];
  const fields  = ['dateISO', 'clientName', 'amount', 'paymentType', 'note', 'orderId'];
  downloadCSV(toCSV(headers, fields, incomes), `incassi_${_today()}`);
}

export function exportSpese(expenses) {
  const headers = ['Data', 'Descrizione', 'Importo (€)', 'Categoria', 'Note'];
  const fields  = ['dateISO', 'description', 'amount', 'category', 'note'];
  const rows = expenses.map(e => ({
    ...e,
    dateISO: e.dateISO || e.date || '',
    description: e.note || e.description || e.category || '',
  }));
  downloadCSV(toCSV(headers, fields, rows), `spese_${_today()}`);
}

export function exportOrdini(orders) {
  const headers = ['Data', 'Cliente', 'Totale (€)', 'Acconto (€)', 'Stato', 'Note'];
  const fields  = ['createdAtISO', 'clientName', 'total', 'deposit', 'status', 'note'];
  const rows = orders.map(o => ({
    ...o,
    createdAtISO: String(o.createdAtISO || '').slice(0, 10),
  }));
  downloadCSV(toCSV(headers, fields, rows), `ordini_${_today()}`);
}

export function exportScadenze(deadlines) {
  const headers = ['Data', 'Descrizione', 'Importo (€)', 'Note'];
  const fields  = ['dateISO', 'note', 'amount', 'extraNote'];
  const rows = deadlines.map(d => ({
    ...d,
    extraNote: d.description || '',
  }));
  downloadCSV(toCSV(headers, fields, rows), `scadenze_${_today()}`);
}

export function exportClienti(clients) {
  const headers = ['Nome', 'Email', 'Telefono', 'Totale Ordini (€)'];
  const fields  = ['name', 'email', 'phone', 'totalOrders'];
  downloadCSV(toCSV(headers, fields, clients), `clienti_${_today()}`);
}

function _today() {
  return new Date().toISOString().slice(0, 10);
}
