import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createInvoiceProtocol,
  readInvoiceProtocolsAtPeriod,
  shiftPeriod,
} from './invoiceProtocol.js';

test('creates a stable protocol with source evidence', () => {
  const protocol = createInvoiceProtocol({
    invoiceId: 'INV-1001',
    sourceSystem: 'legacy-purchasing',
    postingPeriod: '2026-09',
    orderReference: 'PO-77',
    amount: 1250,
    currency: 'EUR',
    status: 'checked',
  });

  assert.equal(
    protocol.protocolId,
    'invoice-protocol:legacy-purchasing:INV-1001:2026-09',
  );
  assert.equal(protocol.orderReference, 'PO-77');
  assert.equal(protocol.status, 'checked');
  assert.equal(protocol.correlationId, 'invoice:legacy-purchasing:INV-1001');
});

test('shifts periods across a year boundary', () => {
  assert.equal(shiftPeriod('2026-01', -1), '2025-12');
  assert.equal(shiftPeriod('2025-12', 1), '2026-01');
});

test('reads only the selected period without mutating the source list', () => {
  const current = createInvoiceProtocol({
    invoiceId: 'INV-CURRENT',
    sourceSystem: 'legacy-purchasing',
    postingPeriod: '2026-09',
  });
  const previous = createInvoiceProtocol({
    invoiceId: 'INV-PREVIOUS',
    sourceSystem: 'legacy-purchasing',
    postingPeriod: '2026-08',
  });
  const protocols = [current, previous];
  const before = JSON.stringify(protocols);

  assert.deepEqual(readInvoiceProtocolsAtPeriod(protocols, '2026-09', -1), [
    previous,
  ]);
  assert.equal(JSON.stringify(protocols), before);
});

test('rejects invalid periods', () => {
  assert.throws(
    () =>
      createInvoiceProtocol({
        invoiceId: 'INV-INVALID',
        sourceSystem: 'legacy-purchasing',
        postingPeriod: '09/2026',
      }),
    /postingPeriod must use YYYY-MM/,
  );
});
