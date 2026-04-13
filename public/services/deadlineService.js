// services/deadlineService.js
// Single source of truth for Scadenze.
// SAFE rule: no hard deletes.

import { firestoreService as fs } from "./firestoreService.js";
import { QUERY } from "./queryRegistry.js";
import { normalizeDeadline } from "./schemaService.js";

/**
 * List all active (non-deleted) deadlines.
 * @returns {Promise<object[]>} Normalized deadline objects
 */
export async function listDeadlines() {
  const raw = await fs.getAllFromQuery(QUERY.DEADLINES_ALL(), { name: "DEADLINES_ALL" });
  return raw.map(normalizeDeadline).filter((d) => !d.isDeleted);
}

/**
 * Create or update a deadline for a given date.
 * @param {string} dateISO - Date in YYYY-MM-DD format (also used as document ID)
 * @param {object} data    - Fields to save (amount, note, etc.)
 * @returns {Promise<void>}
 */
export async function upsertDeadline(dateISO, data) {
  const id = String(dateISO).slice(0, 10);
  return await fs.set("scadenze", id, { ...data, date: id, isDeleted: false }, { merge: true });
}

/**
 * Soft-delete a deadline (sets isDeleted=true, writes to scadenzeHistory).
 * @param {string} dateISO - Date in YYYY-MM-DD format
 * @param {object} [meta]  - Optional metadata to store with the history record
 * @returns {Promise<void>}
 */
export async function softDeleteDeadline(dateISO, meta = {}) {
  const id = String(dateISO).slice(0, 10);
  await fs.update("scadenze", id, {
    isDeleted: true,
    deletedAt: fs.serverTimestamp(),
    deleteMeta: meta,
  });
  await fs.add("scadenzeHistory", {
    deadlineId: id,
    action: "SOFT_DELETE",
    at: fs.serverTimestamp(),
    meta,
  });
}
