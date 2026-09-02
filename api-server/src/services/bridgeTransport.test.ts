import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createBridgeTransportEnvelope,
  mapTransportData,
} from './bridgeTransport.js';

test('creates a stable envelope with source and target evidence', () => {
  const envelope = createBridgeTransportEnvelope({
    sourceSystem: 'legacy-purchasing',
    targetSystem: 'mobile-review',
    entityType: 'invoice',
    mode: 'asynchronous-message',
    schemaVersion: '1.0',
    correlationId: 'case-1',
    occurredAt: '2026-09-02T12:00:00.000Z',
    data: { legacy_number: 'INV-1001' },
  });

  assert.equal(
    envelope.transportId,
    'asynchronous-message:legacy-purchasing:mobile-review:invoice:case-1',
  );
  assert.equal(envelope.sourceSystem, 'legacy-purchasing');
  assert.equal(envelope.targetSystem, 'mobile-review');
  assert.equal(envelope.data.legacy_number, 'INV-1001');
});

test('preserves the distinction between synchronous and asynchronous transport', () => {
  const envelope = createBridgeTransportEnvelope({
    sourceSystem: 'r3',
    targetSystem: 'bridge',
    entityType: 'invoice',
    mode: 'synchronous-read',
    schemaVersion: '2.1',
    correlationId: 'invoice:1001',
    data: {},
  });

  assert.equal(envelope.mode, 'synchronous-read');
  assert.equal(envelope.schemaVersion, '2.1');
});

test('maps fields explicitly without mutating source data', () => {
  const source = {
    KUNDEN_NR: '4711',
    BELEG_NR: 'INV-1001',
    BETRAG: 1250,
  };
  const before = JSON.stringify(source);

  assert.deepEqual(
    mapTransportData(source, {
      KUNDEN_NR: 'customerId',
      BELEG_NR: 'invoiceId',
      BETRAG: 'amount',
    }),
    {
      customerId: '4711',
      invoiceId: 'INV-1001',
      amount: 1250,
    },
  );
  assert.equal(JSON.stringify(source), before);
});

test('fails closed when a mapped source field is missing', () => {
  assert.throws(
    () => mapTransportData({ BELEG_NR: 'INV-1001' }, { BETRAG: 'amount' }),
    /source field is missing: BETRAG/,
  );
});

test('rejects invalid transport metadata', () => {
  assert.throws(
    () =>
      createBridgeTransportEnvelope({
        sourceSystem: 'r3',
        targetSystem: 'r3',
        entityType: 'invoice',
        mode: 'synchronous-read',
        schemaVersion: '1.0',
        correlationId: 'case-1',
        data: {},
      }),
    /sourceSystem and targetSystem must differ/,
  );

  assert.throws(
    () =>
      createBridgeTransportEnvelope({
        sourceSystem: 'r3',
        targetSystem: 'bridge',
        entityType: 'invoice',
        mode: 'synchronous-read',
        schemaVersion: 'v1',
        correlationId: 'case-1',
        data: {},
      }),
    /schemaVersion must contain numeric dot-separated parts/,
  );
});
