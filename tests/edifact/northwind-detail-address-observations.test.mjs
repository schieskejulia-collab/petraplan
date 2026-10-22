import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAddressLayerProjection,
  observeNorthwindDetailPositions,
} from '../../api-server/src/services/addressableNorthwind.ts';

const details = [
  { OrderID: 10248, ProductID: 11, Quantity: 12 },
  { OrderID: 10248, ProductID: 42, Quantity: 10 },
  { OrderID: 10248, ProductID: 72, Quantity: 5 },
];
const observe = orderDetails => observeNorthwindDetailPositions({
  orderId: 10248, envelope: { orderDetails },
});

test('each position has a physical locator linked to existing collection address', () => {
  const result = observe(structuredClone(details));
  assert.equal(result.state, 'SOURCE_OBSERVATIONS_ONLY');
  assert.equal(result.positions.length, 3);
  assert.deepEqual(result.positions.map(p => p.sourcePath), [
    'orderDetails[0].Quantity', 'orderDetails[1].Quantity', 'orderDetails[2].Quantity',
  ]);
  assert.ok(result.positions.every(p => p.parentAddress === 'NW:A-10248#DetailQuantities'));
  assert.deepEqual(result.positions.map(p => p.observedValue), [12, 10, 5]);
  assert.equal(result.persisted, false);
  assert.equal(result.releaseAllowed, false);
});

test('reordering changes physical locators, not unique-in-snapshot identity candidates', () => {
  const first = observe(structuredClone(details));
  const reordered = observe(structuredClone(details).reverse());
  assert.equal(first.positions[0].candidateIdentity, reordered.positions[2].candidateIdentity);
  assert.notEqual(first.positions[0].sourcePath, reordered.positions[2].sourcePath);
  assert.equal(reordered.positions[2].identityStatus, 'unique_in_snapshot_only');
});

test('duplicate candidate identity fails closed', () => {
  const result = observe([...structuredClone(details), { ...details[2], Quantity: 8 }]);
  assert.equal(result.state, 'BLOCKED_AMBIGUOUS_IDENTITY');
  assert.deepEqual(result.positions, []);
});

test('invalid order relation and missing details fail closed', () => {
  assert.equal(observe([{ ...details[0], OrderID: 999 }]).state, 'BLOCKED_INVALID_POSITION');
  assert.equal(observeNorthwindDetailPositions({
    orderId: 10248, envelope: {},
  }).state, 'BLOCKED_INVALID_DETAILS');
});

test('existing projection is unchanged and provides parent collection address', () => {
  const projection = buildAddressLayerProjection({
    orderId: 10248,
    envelope: { order: { OrderID: 10248, CustomerID: 'VINET',
      OrderDate: '1996-07-04', ShippedDate: '1996-07-16' },
      orderDetails: structuredClone(details) },
    adaptation: { raw: { STATUS: '', MENGE: '' } },
    capturedAt: '2026-10-21T00:00:00Z',
  });
  const observed = observe(structuredClone(details));
  assert.ok(projection.addresses.some(a => a.address === observed.positions[0].parentAddress));
  assert.ok(!projection.addresses.some(a => a.sourcePath === 'orderDetails[0].Quantity'));
  assert.ok(projection.candidates.every(c => c.state === 'candidate'));
});
