import test from 'node:test';
import assert from 'node:assert/strict';
import { observeNorthwindDetailPositions } from '../../api-server/src/services/addressableNorthwind.ts';
import { inspectAddressRoles } from './northwind-address-role-inspector.mjs';
import { compareScopedPositionSnapshots } from './scoped-position-snapshot-comparison.mjs';

const rows = [
  { OrderID: 10248, ProductID: 11, Quantity: 12 },
  { OrderID: 10248, ProductID: 42, Quantity: 10 },
  { OrderID: 10248, ProductID: 72, Quantity: 5 },
];
const make = (snapshotId, details = rows, overrides = {}) => ({
  ...inspectAddressRoles(observeNorthwindDetailPositions({
    orderId: 10248, envelope: { orderDetails: details },
  })),
  systemId: 'northwind-a',
  environmentId: 'synthetic-test',
  sourceId: 'fixture-order-10248',
  snapshotId,
  ...overrides,
});

test('same scope: reorder and quantity change remain distinct candidate observations', () => {
  const a = make('T0');
  const b = make('T1', [{ ...rows[2], Quantity: 7 }, rows[1], rows[0]]);
  const result = compareScopedPositionSnapshots(a, b);
  assert.equal(result.state, 'SCOPED_CANDIDATE_COMPARISON_ONLY');
  assert.deepEqual(result.missingCandidates, []);
  assert.deepEqual(result.addedCandidates, []);
  assert.deepEqual(result.movedCandidates, ['[10248,11]', '[10248,72]']);
  assert.deepEqual(result.changedCandidates, ['[10248,72]']);
  assert.equal(result.releaseAllowed, false);
});

test('missing position is detected only within the same supplied scope', () => {
  const result = compareScopedPositionSnapshots(make('T0'), make('T1', rows.slice(0, 2)));
  assert.deepEqual(result.missingCandidates, ['[10248,72]']);
});

test('different environment, system, source or order blocks comparison', () => {
  for (const change of [
    { environmentId: 'production' }, { systemId: 'other' },
    { sourceId: 'different-fixture' }, { rootAddress: 'NW:A-10249' },
  ]) {
    assert.equal(compareScopedPositionSnapshots(make('T0'), make('T1', rows, change)).state,
      'BLOCKED_SCOPE_MISMATCH');
  }
});

test('same snapshot id is not treated as independent comparison', () => {
  assert.equal(compareScopedPositionSnapshots(make('T0'), make('T0')).state,
    'BLOCKED_SNAPSHOT_REUSE');
});

test('missing provenance and ambiguous candidate identity block', () => {
  assert.equal(compareScopedPositionSnapshots(make('T0'), make('T1', rows, { systemId: '' })).state,
    'BLOCKED_MISSING_SCOPE');
  const duplicate = make('T1');
  duplicate.entries = [...duplicate.entries, { ...duplicate.entries[0],
    physicalLocator: 'orderDetails[99].Quantity' }];
  assert.equal(compareScopedPositionSnapshots(make('T0'), duplicate).state,
    'BLOCKED_AMBIGUOUS_IDENTITY');
});
