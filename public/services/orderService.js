// services/orderService.js
// Centralized Orders access (no UI should query Firestore directly).

import { firestoreService as fs } from "./firestoreService.js";
import { QUERY } from "./queryRegistry.js";
import { normalizeOrder } from "./schemaService.js";

/**
 * List all orders (across all clients).
 * @returns {Promise<object[]>} Normalized order objects
 */
export async function listOrders() {
  const raw = await fs.getAllFromQuery(QUERY.ORDERS_ALL(), { name: "ORDERS_ALL" });
  return raw.map(normalizeOrder);
}

/**
 * List orders filtered by client ID.
 * @param {string} clientId - Firestore document ID of the client
 * @returns {Promise<object[]>} Normalized order objects for that client
 */
export async function listOrdersByClient(clientId) {
  if (!clientId) return [];
  const raw = await fs.getAllFromQuery(QUERY.ORDERS_BY_CLIENT(clientId), { name: "ORDERS_BY_CLIENT" });
  return raw.map(normalizeOrder);
}

/**
 * Calculate outstanding (saldo) amount for a given order.
 * @param {object} order - Normalized order object
 * @returns {number} Amount still to be paid (0 if no deposit was registered)
 */
export function calcOutstandingForOrder(order) {
  const total = Number(order?.total) || 0;
  const dep = Number(order?.deposit) || 0;
  if (dep <= 0) return 0;
  return Math.max(0, total - dep);
}
