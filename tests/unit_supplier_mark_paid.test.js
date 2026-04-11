import test from 'node:test';
import assert from 'node:assert/strict';
import { getUnpaidInvoiceIds } from './utils.js';

test('getUnpaidInvoiceIds: returns only non-pagata invoices', () => {
  const invoices = [
    { id: 'a', status: 'da-pagare' },
    { id: 'b', status: 'pagata' },
    { id: 'c', status: 'pagata-parz' },
    { id: 'd', status: 'pagata' },
    { id: 'e' }, // no status = da-pagare
  ];
  const ids = getUnpaidInvoiceIds(invoices);
  assert.deepEqual(ids, ['a', 'c', 'e']);
});

test('getUnpaidInvoiceIds: returns empty array when all paid', () => {
  const invoices = [
    { id: 'a', status: 'pagata' },
    { id: 'b', status: 'pagata' },
  ];
  assert.deepEqual(getUnpaidInvoiceIds(invoices), []);
});

test('getUnpaidInvoiceIds: returns all ids when none is paid', () => {
  const invoices = [
    { id: '1', status: 'da-pagare' },
    { id: '2', status: 'da-pagare' },
    { id: '3', status: 'pagata-parz' },
  ];
  assert.deepEqual(getUnpaidInvoiceIds(invoices), ['1', '2', '3']);
});

test('getUnpaidInvoiceIds across multiple suppliers: collects all unpaid ids', () => {
  // Simulates flattening invoices from multiple suppliers into one list
  const supplierAInvoices = [
    { id: 'a1', status: 'da-pagare' },
    { id: 'a2', status: 'pagata' },
  ];
  const supplierBInvoices = [
    { id: 'b1', status: 'pagata-parz' },
    { id: 'b2', status: 'pagata' },
    { id: 'b3' }, // no status = da-pagare
  ];
  const supplierCInvoices = [
    { id: 'c1', status: 'pagata' },
  ];
  const allUnpaid = [
    ...getUnpaidInvoiceIds(supplierAInvoices),
    ...getUnpaidInvoiceIds(supplierBInvoices),
    ...getUnpaidInvoiceIds(supplierCInvoices),
  ];
  assert.deepEqual(allUnpaid, ['a1', 'b1', 'b3']);
});

test('getUnpaidInvoiceIds across multiple suppliers: returns empty when all paid', () => {
  const supplierAInvoices = [{ id: 'a1', status: 'pagata' }];
  const supplierBInvoices = [{ id: 'b1', status: 'pagata' }, { id: 'b2', status: 'pagata' }];
  const allUnpaid = [
    ...getUnpaidInvoiceIds(supplierAInvoices),
    ...getUnpaidInvoiceIds(supplierBInvoices),
  ];
  assert.deepEqual(allUnpaid, []);
});
