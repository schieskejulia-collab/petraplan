import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAddressLayerProjection } from '../../api-server/src/services/addressableNorthwind.ts';

// Read-only synthetic target copies of the pinned Northwind 10248 fixture.
// The OrderID+ProductID key is unique in THIS fixture; no general schema claim.
const source = [
  { OrderID: 10248, ProductID: 11, Quantity: 12 },
  { OrderID: 10248, ProductID: 42, Quantity: 10 },
  { OrderID: 10248, ProductID: 72, Quantity: 5 },
];
const identity = row => JSON.stringify([row.OrderID, row.ProductID]);

function compareCheckpoint(sourceRows, targetRows) {
  const keys = rows => rows.map(identity);
  const sourceKeys = keys(sourceRows);
  const targetKeys = keys(targetRows);
  if (new Set(sourceKeys).size !== sourceKeys.length ||
      new Set(targetKeys).size !== targetKeys.length) {
    return { state: 'BLOCKED_AMBIGUOUS_IDENTITY', missing: [], changed: [] };
  }
  const targetByKey = new Map(targetRows.map(row => [identity(row), row]));
  const missing = sourceRows.filter(row => !targetByKey.has(identity(row)))
    .map(row => ({ address: identity(row), observedQuantity: row.Quantity }));
  const changed = sourceRows.filter(row => targetByKey.has(identity(row)) &&
    row.Quantity !== targetByKey.get(identity(row)).Quantity)
    .map(row => ({ address: identity(row), sourceQuantity: row.Quantity,
      targetQuantity: targetByKey.get(identity(row)).Quantity }));
  return { state: missing.length || changed.length ? 'DIFFERENCE_DETECTED' : 'MATCHED',
    missing, changed };
}

test('isolated target copy missing one position identifies exactly which source position has no match', () => {
  const targetCopy = structuredClone(source).filter(row => row.ProductID !== 72);
  const result = compareCheckpoint(source, targetCopy);
  assert.equal(result.state, 'DIFFERENCE_DETECTED');
  assert.deepEqual(result.missing, [{ address: '[10248,72]', observedQuantity: 5 }]);
  assert.deepEqual(result.changed, []);
  assert.deepEqual(source.map(row => row.Quantity), [12, 10, 5]);
});

test('reordering positions is not confused with missing data', () => {
  const result = compareCheckpoint(source, structuredClone(source).reverse());
  assert.equal(result.state, 'MATCHED');
  assert.deepEqual(result.missing, []);
});

test('same identity with changed quantity is distinguished from missing position', () => {
  const targetCopy = structuredClone(source);
  targetCopy[2].Quantity = 6;
  const result = compareCheckpoint(source, targetCopy);
  assert.deepEqual(result.missing, []);
  assert.deepEqual(result.changed, [
    { address: '[10248,72]', sourceQuantity: 5, targetQuantity: 6 },
  ]);
});

test('duplicate identity blocks comparison rather than guessing which row corresponds', () => {
  const result = compareCheckpoint(source, [...structuredClone(source), structuredClone(source[2])]);
  assert.equal(result.state, 'BLOCKED_AMBIGUOUS_IDENTITY');
});

test('existing Northwind address projection does not yet individually address detail quantities', () => {
  const projection = buildAddressLayerProjection({
    orderId: 10248,
    envelope: {
      order: { OrderID: 10248, CustomerID: 'VINET', OrderDate: '1996-07-04', ShippedDate: '1996-07-16' },
      orderDetails: structuredClone(source),
    },
    adaptation: { raw: { STATUS: '', MENGE: '' } },
    capturedAt: '2026-10-21T00:00:00Z',
  });
  assert.ok(projection.addresses.some(row => row.sourcePath === 'orderDetails[].Quantity'));
  assert.ok(!projection.addresses.some(row => row.sourcePath === 'orderDetails[2].Quantity'));
  assert.ok(projection.candidates.every(candidate => candidate.state === 'candidate'));
});

// A source/target mismatch locates a difference between TWO checkpoints.
// Without additional observations it cannot establish at which intermediate hop loss occurred.
