import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAddressLayerProjection } from '../../api-server/src/services/addressableNorthwind.ts';
import { projectStinoDinoSourceAddresses } from './stinodino-bridge-handoff.mjs';

const edi = "UNH+1+ORDERS:D:96A:UN'BGM+220+STINODINO-001+9'LIN+1++4000862141404:EN'QTY+21:48:PCE'LIN+2++4000862141411:EN'QTY+21:12:PCE'UNT+7+1'";

const nw = buildAddressLayerProjection({
  orderId: 10248,
  envelope: {
    order: { OrderID: 10248, CustomerID: 'VINET', OrderDate: '1996-07-04', ShippedDate: null },
    orderDetails: [{ OrderID: 10248, ProductID: 11, Quantity: 12 },
      { OrderID: 10248, ProductID: 42, Quantity: 10 }],
  },
  adaptation: { raw: { STATUS: '', MENGE: '' } },
  capturedAt: '2026-10-21T00:00:00Z',
});
const ed = projectStinoDinoSourceAddresses(edi);

function assertAddressTree(projection) {
  assert.equal(typeof projection.rootAddress, 'string');
  const addresses = projection.addresses;
  assert.ok(addresses.length > 1);
  assert.equal(addresses[0].address, projection.rootAddress);
  assert.equal(addresses[0].parentAddress, null);
  assert.equal(addresses[0].kind, 'object');
  assert.equal(new Set(addresses.map(x => x.address)).size, addresses.length);
  for (const entry of addresses.slice(1)) {
    assert.equal(entry.parentAddress, projection.rootAddress);
    assert.ok(['field', 'collection', 'bridge_field'].includes(entry.kind));
    assert.ok(entry.sourcePath);
  }
}

test('actual Northwind and EDIFACT projections share a minimal address-tree contract', () => {
  assertAddressTree(nw);
  assertAddressTree({ ...ed, rootAddress: ed.addresses[0].address });
  assert.notEqual(nw.rootAddress, ed.addresses[0].address);
  assert.equal(ed.releaseAllowed, false);
  assert.deepEqual(ed.candidates, []);
  assert.ok(nw.candidates.every(candidate => candidate.state === 'candidate'));
});

test('Northwind quantity collection and EDIFACT segment locations remain distinct source representations', () => {
  const quantity = nw.addresses.find(x => x.sourcePath === 'orderDetails[].Quantity');
  assert.equal(quantity.kind, 'collection');
  assert.equal(quantity.address, 'NW:A-10248#DetailQuantities');
  assert.deepEqual(ed.addresses.slice(1).map(x => x.sourcePath), ['segment-3', 'segment-5']);
  assert.ok(ed.observations.every(x => x.meaning === 'unconfirmed'));
});
