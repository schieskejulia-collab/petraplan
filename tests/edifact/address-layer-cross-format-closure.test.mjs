import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAddressLayerProjection, observeNorthwindDetailPositions } from '../../api-server/src/services/addressableNorthwind.ts';
import { projectStinoDinoSourceAddresses } from './stinodino-bridge-handoff.mjs';

// Both sources must project into the EXISTING Address Layer shape:
// address, parentAddress, kind, sourcePath. No persistence or semantic approval.
const northwind = {
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
const edifact = "UNH+1+ORDERS:D:96A:UN'BGM+220+PO1+9'LIN+1++ABC:IN'QTY+21:5:PCE'UNT+5+1'";
const required = ['address', 'parentAddress', 'kind', 'sourcePath'];
const validate = projection => {
  assert.ok(typeof projection.rootAddress === 'string');
  assert.ok(Array.isArray(projection.addresses));
  const addresses = new Set(projection.addresses.map(a => a.address));
  assert.equal(addresses.size, projection.addresses.length);
  for (const item of projection.addresses) {
    assert.ok(required.every(field => Object.hasOwn(item, field)));
    assert.ok(['object', 'field', 'collection', 'bridge_field'].includes(item.kind));
    assert.ok(item.parentAddress === null || addresses.has(item.parentAddress));
  }
};

test('Northwind and EDIFACT expose same Address Layer projection fields', () => {
  const nw = buildAddressLayerProjection(northwind);
  const ed = projectStinoDinoSourceAddresses(edifact, { sourceId: 'synthetic:cross-format' });
  assert.equal(ed.state, 'SOURCE_OBSERVATIONS_ONLY');
  validate(nw);
  validate(ed);
  assert.ok(nw.candidates.every(candidate => candidate.state === 'candidate'));
  assert.deepEqual(ed.candidates, []);
  assert.equal(ed.releaseAllowed, false);
  assert.equal(ed.persisted, false);
});

test('Northwind position locators remain observations, not registered stable addresses', () => {
  const nw = buildAddressLayerProjection(northwind);
  const positions = observeNorthwindDetailPositions(northwind);
  assert.equal(positions.state, 'SOURCE_OBSERVATIONS_ONLY');
  assert.equal(positions.positions.length, 3);
  assert.ok(positions.positions.every(item =>
    nw.addresses.some(parent => parent.address === item.parentAddress)));
  assert.ok(positions.positions.every(item =>
    !nw.addresses.some(address => address.address === item.address)));
  assert.ok(positions.positions.every(item =>
    item.identityStatus === 'unique_in_snapshot_only'));
});

test('same physical index after reorder cannot be treated as same logical position', () => {
  const first = observeNorthwindDetailPositions(northwind);
  const reversed = observeNorthwindDetailPositions({
    ...northwind,
    envelope: { ...northwind.envelope,
      orderDetails: [...northwind.envelope.orderDetails].reverse() },
  });
  assert.equal(first.positions[0].address, reversed.positions[0].address);
  assert.notEqual(first.positions[0].candidateIdentity, reversed.positions[0].candidateIdentity);
});
