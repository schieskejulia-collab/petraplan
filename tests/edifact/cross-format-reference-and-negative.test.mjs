import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAddressLayerProjection } from '../../api-server/src/services/addressableNorthwind.ts';
import { projectStinoDinoSourceAddresses } from './stinodino-bridge-handoff.mjs';

const base = {
  orderId: 10248,
  envelope: {
    order: { OrderID: 10248, CustomerID: 'VINET', OrderDate: '1996-07-04', ShippedDate: '1996-07-16' },
    orderDetails: [
      { OrderID: 10248, ProductID: 11, Quantity: 12 },
      { OrderID: 10248, ProductID: 42, Quantity: 10 },
      { OrderID: 10248, ProductID: 72, Quantity: 5 },
    ],
  },
  adaptation: { raw: { STATUS: '', MENGE: '' } },
  capturedAt: '2026-10-21T00:00:00Z',
};
// Pinned reference: docs/evidence/external-northwind-mass-proof/README.md
// and api-server/src/services/northwindOrderV2.test.ts.
// This does not authenticate an upstream dataset at test runtime.

test('Northwind 10248 retains three observed quantities and never confirms their sum', () => {
  const projection = buildAddressLayerProjection(structuredClone(base));
  const quantity = projection.candidates.find(x => x.conversionKind === 'aggregate');
  assert.deepEqual(quantity.observedValue, [12, 10, 5]);
  assert.equal(quantity.proposedValue, 'MENGE=27');
  assert.equal(quantity.state, 'candidate');
  assert.ok(!projection.addresses.some(x => x.sourcePath === 'orderDetails[2].Quantity'));
});

test('changing one Northwind detail changes observation but does not authorize a semantic rule', () => {
  const changed = structuredClone(base);
  changed.envelope.orderDetails[2].Quantity = 6;
  const original = buildAddressLayerProjection(base);
  const revised = buildAddressLayerProjection(changed);
  assert.deepEqual(original.addresses, revised.addresses);
  assert.deepEqual(revised.candidates.find(x => x.conversionKind === 'aggregate').observedValue, [12, 10, 6]);
  assert.equal(revised.candidates.find(x => x.conversionKind === 'aggregate').state, 'candidate');
});

test('EDIFACT invalid numeric quantity blocks address projection', () => {
  const raw = "UNH+1+ORDERS:D:96A:UN'BGM+220+STINODINO-001+9'LIN+1++4000862141404:EN'QTY+21:BAD:PCE'UNT+5+1'";
  const projection = projectStinoDinoSourceAddresses(raw);
  assert.equal(projection.state, 'BLOCKED');
  assert.equal(projection.rootAddress, null);
  assert.deepEqual(projection.addresses, []);
  assert.equal(projection.releaseAllowed, false);
});
