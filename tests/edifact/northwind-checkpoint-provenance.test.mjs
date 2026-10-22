import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

// Synthetic read-only checkpoint contract. No production capture or DB writes.
// Hashes attest to fixture bytes only, not authenticity or trusted acquisition.
const baseRows = [
  { OrderID: 10248, ProductID: 11, Quantity: 12 },
  { OrderID: 10248, ProductID: 42, Quantity: 10 },
  { OrderID: 10248, ProductID: 72, Quantity: 5 },
];
const hash = rows => createHash('sha256').update(JSON.stringify(rows)).digest('hex');
const identity = row => JSON.stringify([row.OrderID, row.ProductID]);

function checkpoint({ systemId, environmentId, snapshotId, stage, rows }) {
  if (![systemId, environmentId, snapshotId, stage].every(v =>
    typeof v === 'string' && v.trim().length > 0)) {
    return { state: 'BLOCKED_MISSING_PROVENANCE' };
  }
  if (!Array.isArray(rows) || rows.some(row => !Number.isInteger(row.OrderID) ||
      !Number.isInteger(row.ProductID) || !Number.isFinite(row.Quantity))) {
    return { state: 'BLOCKED_INVALID_OBSERVATION' };
  }
  if (new Set(rows.map(identity)).size !== rows.length) {
    return { state: 'BLOCKED_AMBIGUOUS_IDENTITY' };
  }
  const captured = structuredClone(rows);
  return Object.freeze({
    state: 'OBSERVED', systemId, environmentId, snapshotId, stage,
    rawFingerprint: hash(captured), rows: captured,
  });
}

function compare(left, right) {
  if (left.state !== 'OBSERVED' || right.state !== 'OBSERVED') {
    return { state: 'BLOCKED_UNVERIFIED_CHECKPOINT' };
  }
  if (left.snapshotId === right.snapshotId &&
      (left.systemId !== right.systemId || left.environmentId !== right.environmentId ||
       left.stage !== right.stage)) {
    return { state: 'BLOCKED_SNAPSHOT_ID_COLLISION' };
  }
  if (hash(left.rows) !== left.rawFingerprint || hash(right.rows) !== right.rawFingerprint) {
    return { state: 'BLOCKED_CHECKPOINT_MUTATION' };
  }
  const target = new Map(right.rows.map(row => [identity(row), row]));
  const missing = left.rows.filter(row => !target.has(identity(row)))
    .map(row => ({ identity: identity(row), quantity: row.Quantity }));
  return { state: 'COMPARED', missing };
}

const make = (stage, rows, environmentId = 'isolated-test') => checkpoint({
  systemId: stage === 'bridge' ? 'petraplan' : 'synthetic-warehouse',
  environmentId, snapshotId: 'fixture-' + stage + '-' + environmentId,
  stage, rows,
});

test('separate checkpoint provenance detects exactly one missing position', () => {
  const a = make('source', baseRows);
  const bridge = make('bridge', baseRows);
  const b = make('target', baseRows.filter(row => row.ProductID !== 72));
  assert.deepEqual(compare(a, bridge), { state: 'COMPARED', missing: [] });
  assert.deepEqual(compare(bridge, b), {
    state: 'COMPARED', missing: [{ identity: '[10248,72]', quantity: 5 }],
  });
  assert.notEqual(a.rawFingerprint, b.rawFingerprint);
});

test('missing system identity blocks a checkpoint', () => {
  const invalid = checkpoint({ systemId: '', environmentId: 'test',
    snapshotId: 's1', stage: 'source', rows: baseRows });
  assert.equal(invalid.state, 'BLOCKED_MISSING_PROVENANCE');
  assert.equal(compare(invalid, make('target', baseRows)).state, 'BLOCKED_UNVERIFIED_CHECKPOINT');
});

test('duplicate logical identity blocks observation', () => {
  const invalid = make('source', [...baseRows, baseRows[2]]);
  assert.equal(invalid.state, 'BLOCKED_AMBIGUOUS_IDENTITY');
});

test('same snapshot identifier cannot describe different stages or environments', () => {
  const a = checkpoint({ systemId: 'warehouse', environmentId: 'production',
    snapshotId: 'shared-id', stage: 'source', rows: baseRows });
  const b = checkpoint({ systemId: 'warehouse', environmentId: 'isolated-test',
    snapshotId: 'shared-id', stage: 'target', rows: baseRows });
  assert.equal(compare(a, b).state, 'BLOCKED_SNAPSHOT_ID_COLLISION');
});

test('mutating a captured checkpoint after fingerprinting blocks comparison', () => {
  const a = make('source', baseRows);
  const b = make('target', baseRows);
  a.rows[2].Quantity = 999;
  assert.equal(compare(a, b).state, 'BLOCKED_CHECKPOINT_MUTATION');
});

// In real operation, snapshot IDs, capture authority, and provenance must be
// verified independently. A self-calculated hash cannot prove a system sent data.
