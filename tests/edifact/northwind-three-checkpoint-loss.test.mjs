import test from 'node:test';
import assert from 'node:assert/strict';

// Isolated, synthetic checkpoints only. No database, network or production writes.
// This checks observation boundaries, not an actual transport or production pipeline.
const original = [
  { OrderID: 10248, ProductID: 11, Quantity: 12 },
  { OrderID: 10248, ProductID: 42, Quantity: 10 },
  { OrderID: 10248, ProductID: 72, Quantity: 5 },
];
const key = row => JSON.stringify([row.OrderID, row.ProductID]);
const copy = rows => structuredClone(rows);
const without72 = rows => rows.filter(row => row.ProductID !== 72);

function compare(before, after) {
  const beforeIds = before.map(key), afterIds = after.map(key);
  if (new Set(beforeIds).size !== beforeIds.length ||
      new Set(afterIds).size !== afterIds.length) {
    return { state: 'BLOCKED_AMBIGUOUS_IDENTITY', missing: [], changed: [] };
  }
  const afterMap = new Map(after.map(row => [key(row), row]));
  return {
    state: 'COMPARED',
    missing: before.filter(row => !afterMap.has(key(row))).map(row => ({
      address: key(row), sourceQuantity: row.Quantity,
    })),
    changed: before.filter(row => afterMap.has(key(row)) &&
      row.Quantity !== afterMap.get(key(row)).Quantity).map(row => ({
      address: key(row), before: row.Quantity, after: afterMap.get(key(row)).Quantity,
    })),
  };
}

function trace(checkpoints) {
  const labels = ['system-a', 'petraplan', 'system-b'];
  const boundaries = [];
  for (let i = 1; i < labels.length; i++) {
    const before = checkpoints[labels[i - 1]];
    const after = checkpoints[labels[i]];
    if (!before || !after) {
      boundaries.push({ from: labels[i - 1], to: labels[i], state: 'UNKNOWN_CHECKPOINT' });
      continue;
    }
    boundaries.push({ from: labels[i - 1], to: labels[i], ...compare(before, after) });
  }
  return boundaries;
}

test('complete snapshots at all three checkpoints yield no missing positions', () => {
  const results = trace({ 'system-a': copy(original), petraplan: copy(original),
    'system-b': copy(original) });
  assert.ok(results.every(result => result.state === 'COMPARED' &&
    result.missing.length === 0 && result.changed.length === 0));
});

test('missing at PetraPlan checkpoint localizes first observed loss to A -> PetraPlan', () => {
  const results = trace({ 'system-a': copy(original), petraplan: without72(copy(original)),
    'system-b': without72(copy(original)) });
  assert.deepEqual(results[0].missing, [{ address: '[10248,72]', sourceQuantity: 5 }]);
  assert.deepEqual(results[1].missing, []);
});

test('missing only at B checkpoint localizes first observed loss to PetraPlan -> B', () => {
  const results = trace({ 'system-a': copy(original), petraplan: copy(original),
    'system-b': without72(copy(original)) });
  assert.deepEqual(results[0].missing, []);
  assert.deepEqual(results[1].missing, [{ address: '[10248,72]', sourceQuantity: 5 }]);
});

test('unknown intermediate checkpoint prevents precise localization', () => {
  const results = trace({ 'system-a': copy(original), 'system-b': without72(copy(original)) });
  assert.equal(results[0].state, 'UNKNOWN_CHECKPOINT');
  assert.equal(results[1].state, 'UNKNOWN_CHECKPOINT');
});

test('quantity modification is distinguished from missing data', () => {
  const changed = copy(original);
  changed[2].Quantity = 6;
  const results = trace({ 'system-a': copy(original), petraplan: changed,
    'system-b': copy(changed) });
  assert.deepEqual(results[0].missing, []);
  assert.deepEqual(results[0].changed, [
    { address: '[10248,72]', before: 5, after: 6 },
  ]);
  assert.deepEqual(results[1].changed, []);
});

test('ambiguous position identity blocks comparison instead of claiming loss', () => {
  const results = trace({ 'system-a': copy(original),
    petraplan: [...copy(original), copy(original[2])], 'system-b': copy(original) });
  assert.equal(results[0].state, 'BLOCKED_AMBIGUOUS_IDENTITY');
  assert.equal(results[1].state, 'BLOCKED_AMBIGUOUS_IDENTITY');
});

// OrderID+ProductID uniqueness is proven only for these fixtures.
// In a real integration each checkpoint requires trusted capture, snapshot identity,
// provenance, and independently verified system/environment identity.
