import assert from 'node:assert/strict';
import test from 'node:test';
import { createInvoiceProtocol } from './invoiceProtocol.js';
import {
  queryInvoiceProtocolsByPeriod,
  resolvePeriodQuery,
} from './periodQuery.js';

test('resolves a previous period across a year boundary', () => {
  assert.deepEqual(resolvePeriodQuery({
    anchorPeriod: '2026-01',
    monthOffset: -1,
  }), {
    anchorPeriod: '2026-01',
    monthOffset: -1,
    targetPeriod: '2025-12',
  });
});

test('returns the resolved period and only matching protocols', () => {
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

  assert.deepEqual(queryInvoiceProtocolsByPeriod(protocols, {
    anchorPeriod: '2026-09',
    monthOffset: -1,
  }), {
    anchorPeriod: '2026-09',
    monthOffset: -1,
    targetPeriod: '2026-08',
    records: [previous],
    recordCount: 1,
    readOnly: true,
  });
  assert.equal(JSON.stringify(protocols), before);
});

test('uses the anchor period when no offset is supplied', () => {
  const protocol = createInvoiceProtocol({
    invoiceId: 'INV-1001',
    sourceSystem: 'legacy-purchasing',
    postingPeriod: '2026-09',
  });

  const result = queryInvoiceProtocolsByPeriod([protocol], {
    anchorPeriod: '2026-09',
  });

  assert.equal(result.targetPeriod, '2026-09');
  assert.equal(result.recordCount, 1);
  assert.equal(result.records[0]?.invoiceId, 'INV-1001');
});

test('returns an empty read-only result when the period is absent', () => {
  const result = queryInvoiceProtocolsByPeriod([], {
    anchorPeriod: '2026-09',
    monthOffset: -1,
  });

  assert.deepEqual(result, {
    anchorPeriod: '2026-09',
    monthOffset: -1,
    targetPeriod: '2026-08',
    records: [],
    recordCount: 0,
    readOnly: true,
  });
});
