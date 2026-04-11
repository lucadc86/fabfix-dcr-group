/**
 * Script per segnare come pagate tutte le fatture fornitori non ancora pagate.
 *
 * Aggiorna lo status a "pagata" per tutte le fatture con status "da-pagare"
 * o "pagata-parz" in tutti i documenti della collezione suppliers/{id}/invoices.
 *
 * Eseguire con:
 *   GOOGLE_APPLICATION_CREDENTIALS=<path-to-service-account.json> node scripts/mark-supplier-invoices-paid.js
 */

import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

initializeApp({
  credential: applicationDefault(),
});

const db = getFirestore();

const UNPAID_STATUSES = new Set(["da-pagare", "pagata-parz"]);

async function markAllInvoicesPaid() {
  console.log("🔍 Lettura fornitori...");
  const suppliersSnap = await db.collection("suppliers").get();

  if (suppliersSnap.empty) {
    console.log("ℹ️  Nessun fornitore trovato.");
    return;
  }

  let totalUpdated = 0;
  let totalSkipped = 0;

  for (const supplierDoc of suppliersSnap.docs) {
    const supplierName = supplierDoc.data().name || supplierDoc.id;
    const invoicesSnap = await supplierDoc.ref.collection("invoices").get();

    if (invoicesSnap.empty) continue;

    const batch = db.batch();
    let batchCount = 0;

    for (const invoiceDoc of invoicesSnap.docs) {
      const status = invoiceDoc.data().status || "da-pagare";
      if (UNPAID_STATUSES.has(status)) {
        batch.update(invoiceDoc.ref, { status: "pagata" });
        batchCount++;
      } else {
        totalSkipped++;
      }
    }

    if (batchCount > 0) {
      await batch.commit();
      console.log(`  ✅ ${supplierName}: ${batchCount} fattura/e segnata/e come pagata`);
      totalUpdated += batchCount;
    }
  }

  console.log(`\n✅ Completato: ${totalUpdated} fatture aggiornate, ${totalSkipped} già pagate (saltate).`);
}

markAllInvoicesPaid().catch((err) => {
  console.error("❌ Errore:", err);
  process.exit(1);
});
