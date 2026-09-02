import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildInvoiceProtocolTraceLink,
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

test('links only explicitly scoped protocols for a case and period', () => {
  const linked = createInvoiceProtocol({
    invoiceId: 'INV-LINKED',
    sourceSystem: 'legacy-purchasing',
    postingPeriod: '2026-08',
    caseId: 'case-1',
    status: 'checked',
  });
  const otherCase = createInvoiceProtocol({
    invoiceId: 'INV-OTHER',
    sourceSystem: 'legacy-purchasing',
    postingPeriod: '2026-08',
    caseId: 'case-2',
  });
  const unscoped = createInvoiceProtocol({
    invoiceId: 'INV-UNSCOPED',
    sourceSystem: 'legacy-purchasing',
    postingPeriod: '2026-08',
  });

  assert.deepEqual(
    buildInvoiceProtocolTraceLink(
      'case-1',
      [linked, otherCase, unscoped],
      '2026-09',
      -1,
    ),
    {
      caseId: 'case-1',
      postingPeriod: '2026-08',
      protocolIds: [linked.protocolId],
      sourceSystems: ['legacy-purchasing'],
      statuses: ['checked'],
    },
  );
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
