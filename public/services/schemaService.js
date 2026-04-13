// services/schemaService.js
// Normalization layer (retro-compatible, NO writes).

function num(v, def = 0) {
  if (typeof v === "number") return Number.isFinite(v) ? v : def;
  const s = String(v ?? "").trim();
  if (!s) return def;
  let cleaned = s.replace(/[^0-9,.-]/g, "");
  if (cleaned.includes(",")) cleaned = cleaned.replace(/\./g, "").replace(",", ".");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : def;
}

function dateISOFromAny(v, fallbackId = "") {
  try {
    if (!v && fallbackId) v = fallbackId;
    if (!v) return null;
    if (typeof v === "string") {
      const s = v.trim();
      if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
      if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) {
        const [dd, mm, yy] = s.split("/");
        return `${yy}-${mm}-${dd}`;
      }
      const d = new Date(s);
      return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
    }
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    if (typeof v === "number") {
      const d = new Date(v);
      return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
    }
    // Firestore Timestamp
    if (typeof v === "object" && typeof v.toDate === "function") {
      const d = v.toDate();
      return d?.toISOString?.().slice(0, 10) || null;
    }
    if (typeof v === "object" && typeof v.seconds === "number") {
      const d = new Date(v.seconds * 1000);
      return d.toISOString().slice(0, 10);
    }
  } catch {
    return null;
  }
  return null;
}

function upperName(v) {
  return String(v ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, " ");
}

export function normalizeIncome(doc) {
  const id = doc?.id || "";
  const isDeleted = Boolean(doc?.isDeleted || doc?.deleted);
  const dateISO = dateISOFromAny(doc?.date ?? doc?.data ?? doc?.createdAt, id);
  const amount = isDeleted ? 0 : num(doc?.amount ?? doc?.importo ?? doc?.value, NaN);
  const note = String(doc?.note ?? doc?.descrizione ?? "").trim();
  const orderId = String(doc?.orderId ?? doc?.ordineId ?? "").trim();
  const clientId = String(doc?.clientId ?? doc?.clienteId ?? "").trim();
  const clientName = String(doc?.clientName ?? doc?.clienteNome ?? doc?.cliente ?? "").trim();
  const kind = String(doc?.kind ?? doc?.type ?? (orderId ? "ordine" : "manuale"));
  const source = String(doc?.source ?? (orderId ? "ordine" : "manuale"));

  return {
    id,
    dateISO,
    amount: Number.isFinite(amount) ? amount : NaN,
    note,
    orderId,
    clientId,
    clientName,
    kind,
    source,
    isDeleted,
  };
}

export function normalizeOrder(doc) {
  const id = doc?.id || "";
  const createdAtISO = dateISOFromAny(doc?.createdAtISO ?? doc?.createdAtDate ?? doc?.createdAt ?? doc?.date ?? doc?.data, "");
  const total = num(doc?.total ?? doc?.totale ?? doc?.importo, 0);
  const deposit = num(doc?.deposit ?? doc?.depositAmount ?? doc?.acconto ?? doc?.anticipo, 0);
  const clientId = String(doc?.clientId ?? doc?.clienteId ?? "").trim();
  const clientName = upperName(doc?.clientName ?? doc?.clienteNome ?? doc?.cliente ?? doc?.nomeCliente ?? doc?.client?.name ?? doc?.customerName ?? doc?.ragioneSocialeCliente);
  const residual = num(doc?.residual ?? doc?.residuo, 0);
  const status = String(doc?.paymentStatus ?? doc?.status ?? doc?.stato ?? "").trim().toLowerCase();
  const rawRows = Array.isArray(doc?.rows)
    ? doc.rows
    : (Array.isArray(doc?.items)
      ? doc.items
      : (Array.isArray(doc?.products) ? doc.products : []));
  const rows = rawRows.map((r) => ({
    product: String(r?.product ?? r?.name ?? r?.description ?? r?.descrizione ?? r?.desc ?? "").trim(),
    name: String(r?.name ?? r?.product ?? r?.description ?? r?.descrizione ?? r?.desc ?? "").trim(),
    description: String(r?.description ?? r?.descrizione ?? r?.desc ?? r?.product ?? r?.name ?? "").trim(),
    qty: num(r?.qty ?? r?.quantita ?? r?.quantity ?? 0, 0),
    price: num(r?.price ?? r?.prezzo ?? r?.unitPrice ?? 0, 0),
    total: num(r?.total ?? r?.totale ?? 0, 0),
  }));
  return {
    id,
    createdAtISO,
    total,
    deposit,
    residual,
    clientId,
    clientName,
    status,
    paymentStatus: status,
    depositAmount: deposit,
    rows,
    items: rows,
  };
}

export function normalizeClient(doc) {
  const id = doc?.id || "";
  const name = String(doc?.name ?? doc?.nome ?? "").trim();
  const city = String(doc?.city ?? doc?.citta ?? "").trim();
  const createdAtISO = dateISOFromAny(doc?.createdAt ?? doc?.dataCreazione ?? doc?.date, "");
  return { id, name, city, createdAtISO };
}

export function normalizeExpense(doc) {
  const id = doc?.id || "";
  const dateISO = dateISOFromAny(doc?.date ?? doc?.data ?? doc?.createdAt, id);
  const amount = num(doc?.amount ?? doc?.importo ?? doc?.value, 0);
  const category = String(doc?.category ?? doc?.categoria ?? "").trim();
  const note = String(doc?.note ?? doc?.descrizione ?? "").trim();
  const isDeleted = Boolean(doc?.isDeleted);
  return { id, dateISO, amount, category, note, isDeleted };
}

export function normalizeDeadline(doc) {
  const id = doc?.id || "";
  const dateISO = dateISOFromAny(doc?.date ?? doc?.data ?? doc?.dueDate, id);
  const amount = num(doc?.amount ?? doc?.importo ?? doc?.value, 0);
  const note = String(doc?.note ?? doc?.descrizione ?? "").trim();
  const isDeleted = Boolean(doc?.isDeleted);
  const pagata = Boolean(doc?.pagata ?? doc?.paid ?? doc?.pagato);
  const category = String(doc?.category ?? doc?.categoria ?? "").trim();
  return { id, dateISO, amount, note, isDeleted, pagata, category };
}

export const schemaUtils = {
  num,
  dateISOFromAny,
  upperName,
};
