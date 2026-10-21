import test from 'node:test';
import assert from 'node:assert/strict';
import { observeCheckpoint, compareCheckpoints, traceCheckpoints } from './checkpoint-contract.mjs';

const rows = [
  { OrderID: 10248, ProductID: 11, Quantity: 12 },
  { OrderID: 10248, ProductID: 42, Quantity: 10 },
  { OrderID: 10248, ProductID: 72, Quantity: 5 },
];
const make = (stage, data = rows, environmentId = 'isolated-test') =>
  observeCheckpoint({ systemId: stage === 'petraplan' ? 'petraplan' : 'warehouse',
    environmentId, sourceId: 'fixture:northwind', snapshotId: stage + ':' + environmentId,
    stage, rows: data });

test('three checkpoints pinpoint the first observed missing position', () => {
  const result = traceCheckpoints({
    'system-a': make('system-a'), petraplan: make('petraplan'),
    'system-b': make('system-b', rows.slice(0, 2)),
  });
  assert.deepEqual(result[0].missing, []);
  assert.deepEqual(result[1].missing, [{ address: '[10248,72]', sourceQuantity: 5 }]);
  assert.deepEqual(result[1].added, []);
});

test('changed, added, and missing positions are separate findings', () => {
  const next = [{ ...rows[0], Quantity: 13 }, rows[1],
    { OrderID: 10248, ProductID: 99, Quantity: 2 }];
  const result = compareCheckpoints(make('system-a'), make('system-b', next));
  assert.deepEqual(result.changed, [{ address: '[10248,11]', sourceQuantity: 12, targetQuantity: 13 }]);
  assert.deepEqual(result.missing, [{ address: '[10248,72]', sourceQuantity: 5 }]);
  assert.deepEqual(result.added, [{ address: '[10248,99]', targetQuantity: 2 }]);
});

test('reordering does not invent missing or changed rows', () => {
  const result = compareCheckpoints(make('system-a'), make('system-b', [...rows].reverse()));
  assert.deepEqual([result.missing, result.added, result.changed], [[], [], []]);
});

test('missing checkpoint cannot locate loss', () => {
  const result = traceCheckpoints({ 'system-a': make('system-a'),
    'system-b': make('system-b', rows.slice(0, 2)) });
  assert.ok(result.every(item => item.state === 'UNKNOWN_CHECKPOINT'));
});

test('missing provenance and duplicate identities block observation', () => {
  const missing = observeCheckpoint({ systemId: '', environmentId: 'test',
    sourceId: 'fixture', snapshotId: 's', stage: 'system-a', rows });
  assert.equal(missing.state, 'BLOCKED_MISSING_PROVENANCE');
  assert.equal(make('system-a', [...rows, rows[0]]).state, 'BLOCKED_AMBIGUOUS_IDENTITY');
  assert.equal(compareCheckpoints(missing, make('system-b')).state, 'BLOCKED_UNVERIFIED_CHECKPOINT');
});

test('fingerprint catches mutation and snapshot identity collision', () => {
  const a = make('system-a');
  const b = make('system-b');
  a.rows[0].Quantity = 999;
  assert.equal(compareCheckpoints(a, b).state, 'BLOCKED_CHECKPOINT_MUTATION');
  const prod = observeCheckpoint({ systemId: 'warehouse', environmentId: 'production',
    sourceId: 'fixture:northwind', snapshotId: 'same', stage: 'system-a', rows });
  const testCopy = observeCheckpoint({ systemId: 'warehouse', environmentId: 'isolated-test',
    sourceId: 'fixture:northwind', snapshotId: 'same', stage: 'system-b', rows });
  assert.equal(compareCheckpoints(prod, testCopy).state, 'BLOCKED_SNAPSHOT_ID_COLLISION');
});

test('a successful comparison does not authorize release or prove provenance', () => {
  const a = make('system-a'), b = make('system-b');
  assert.equal(compareCheckpoints(a, b).state, 'COMPARED');
  assert.equal(a.releaseAllowed, false);
  assert.equal(b.persisted, false);
  assert.equal(a.authority, 'unverified_synthetic_fixture');
});
