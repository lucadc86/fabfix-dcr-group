# CHANGELOG

## vNEXT (build SAFE)

### 🚀 Top di Gamma — Livello 1 (zero costo)
- **Dark/Light mode toggle**: pulsante visibile in ogni pagina (nav.js), tema persistito in localStorage; dark mode su `body.page`
- **Banner offline**: banner rosso in alto quando la connessione è assente (rilevamento `window.online/offline`)
- **Ricerca globale** (`search.html`): ricerca full-text su clienti, ordini, fornitori, incassi, spese, scadenze con filtri per categoria e debounce
- **Search FAB**: bottone flottante 🔍 in ogni pagina che porta alla ricerca globale
- **Export CSV**: modulo `services/exportService.js` + pulsanti "⬇ CSV" su incassi.html, spese.html, ordini-clienti.html
- **Admin Portale** (`admin-portale.html`): pagina per creare/abilitare/disabilitare account portale ordini per i clienti (collezione `portalAccounts`)
- **Session timeout**: avviso toast a 30 min di inattività, logout automatico a 35 min (auth-guard.js)
- **Validazione form inline**: campo note e importo con feedback visivo rosso/verde (spesa.js + spesa.html) invece del semplice alert
- **Statistiche avanzate** (`statistiche.html`): redesign completo con 6 KPI, 4 grafici, selettore anno, top clienti
- **KPI Saldo Netto** in home page (incassato − spese anno)
- Ricerca globale e Admin Portale aggiunte al grid home

### Data integrity / Firestore
- Introdotti services centralizzati in `public/services/`:
  - `firestoreService`, `schemaService`, `queryRegistry`, `incomeService`, `kpiService`, `orderService`, `expenseService`, `deadlineService`, `clientAnalyticsService`.
- Aggiunta normalizzazione retrocompatibile (date/numeri/campi legacy).
- Implementati **soft delete** per:
  - Spese (`expenses.isDeleted`)
  - Scadenze (`scadenze.isDeleted`)
- Aggiunte collections history append-only:
  - `expensesHistory`, `scadenzeHistory`.

### KPI / Analytics
- KPI incassi centralizzati (funzione unica `getYearlyIncomesTotal(year)`).
- Fix logico incassi fantasma (mai delete DB).
- Calcolo “restante da incassare” normalizzato: `max(0, total - deposit)` solo ordini con acconto.

### Listini / LISAP
- Integrazione Excel LISAP in `public/assets/Lisap_listino_ordine.xlsx`.
- Generato indice ricerca `public/assets/lisap_index.json`.
- Pagina ordine LISAP con quantità persistite e stampa PDF (solo righe qty>0).

### UI / iPad
- Uniformato layout pagina Listini con safe-area inset top/bottom.

### Tests
- Aggiunta cartella `tests/` con:
  - unit: KPI restante
  - unit: rows/totale stampa LISAP
  - integration: clienti↔ordini orfani
  - UI: safe-area listini
  - stress: dataset 1000/1000

