// services/expenseService.js
// Single source of truth for Spese.
// SAFE rule: no hard deletes; use softDeleteExpense.

import { firestoreService as fs } from "./firestoreService.js";
import { QUERY } from "./queryRegistry.js";
import { normalizeExpense } from "./schemaService.js";

/**
 * List all active (non-deleted) expenses.
 * @returns {Promise<object[]>} Normalized expense objects
 */
export async function listExpenses() {
  const raw = await fs.getAllFromQuery(QUERY.EXPENSES_ALL(), { name: "EXPENSES_ALL" });
  return raw.map(normalizeExpense).filter((e) => !e.isDeleted);
}

/**
 * List expenses for a specific date.
 * @param {string} dateISO - Date in YYYY-MM-DD format
 * @returns {Promise<object[]>} Normalized expense objects for that date
 */
export async function listExpensesByDate(dateISO) {
  const q = fs.query(fs.col("expenses"), fs.where("date", "==", dateISO));
  const raw = await fs.getAllFromQuery(q, { name: "EXPENSES_BY_DATE", dateISO });
  return raw.map(normalizeExpense).filter((e) => !e.isDeleted);
}

/**
 * Add a new expense document.
 * @param {object} data - Expense fields (date, amount, note, category, …)
 * @returns {Promise<string>} New document ID
 */
export async function addExpense(data) {
  return await fs.add("expenses", data);
}

/**
 * Create or update an expense by ID.
 * @param {string} id     - Document ID
 * @param {object} data   - Fields to save
 * @param {object} [opts] - Options; merge defaults to true
 * @returns {Promise<void>}
 */
export async function upsertExpense(id, data, { merge = true } = {}) {
  if (!id) throw new Error("Expense id required");
  return await fs.set("expenses", id, data, { merge });
}

/**
 * Soft-delete an expense (sets isDeleted=true, writes to expensesHistory).
 * @param {string} id    - Document ID to soft-delete
 * @param {object} [meta] - Optional metadata for the history record
 * @returns {Promise<void>}
 */
export async function softDeleteExpense(id, meta = {}) {
  if (!id) throw new Error("Expense id required");
  await fs.update("expenses", id, {
    isDeleted: true,
    deletedAt: fs.serverTimestamp(),
    deleteMeta: meta,
  });

  // Optional history collection (does not affect existing data).
  await fs.add("expensesHistory", {
    expenseId: id,
    action: "SOFT_DELETE",
    at: fs.serverTimestamp(),
    meta,
  });
}
