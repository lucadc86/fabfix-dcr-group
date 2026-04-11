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
