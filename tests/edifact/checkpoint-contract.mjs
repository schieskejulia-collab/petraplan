import { createHash } from 'node:crypto';

// Pure, read-only prototype for synthetic Northwind-like row checkpoints.
// Not a trusted capture mechanism, identity registry, or production adapter.
const rowKey = row => JSON.stringify([row.OrderID, row.ProductID]);
const fingerprint = rows => createHash('sha256').update(JSON.stringify(rows)).digest('hex');
const validLabel = value => typeof value === 'string' && value.trim().length > 0;

export function observeCheckpoint({ systemId, environmentId, sourceId, snapshotId, stage, rows }) {
  if (![systemId, environmentId, sourceId, snapshotId, stage].every(validLabel)) {
    return { state: 'BLOCKED_MISSING_PROVENANCE' };
  }
  if (!Array.isArray(rows) || rows.some(row =>
    !row || !Number.isInteger(row.OrderID) || !Number.isInteger(row.ProductID) ||
    !Number.isFinite(row.Quantity))) {
    return { state: 'BLOCKED_INVALID_OBSERVATION' };
  }
  const captured = structuredClone(rows);
  if (new Set(captured.map(rowKey)).size !== captured.length) {
    return { state: 'BLOCKED_AMBIGUOUS_IDENTITY' };
  }
  return {
    state: 'OBSERVED', systemId, environmentId, sourceId, snapshotId, stage,
    fingerprint: fingerprint(captured), rows: captured,
    authority: 'unverified_synthetic_fixture', persisted: false, releaseAllowed: false,
  };
}

export function compareCheckpoints(left, right) {
  if (left?.state !== 'OBSERVED' || right?.state !== 'OBSERVED') {
    return { state: 'BLOCKED_UNVERIFIED_CHECKPOINT' };
  }
  if (left.snapshotId === right.snapshotId &&
      [left.systemId, left.environmentId, left.sourceId, left.stage].some((value, index) =>
        value !== [right.systemId, right.environmentId, right.sourceId, right.stage][index])) {
    return { state: 'BLOCKED_SNAPSHOT_ID_COLLISION' };
  }
  if (fingerprint(left.rows) !== left.fingerprint ||
      fingerprint(right.rows) !== right.fingerprint) {
    return { state: 'BLOCKED_CHECKPOINT_MUTATION' };
  }
  const target = new Map(right.rows.map(row => [rowKey(row), row]));
  const source = new Map(left.rows.map(row => [rowKey(row), row]));
  return {
    state: 'COMPARED',
    missing: left.rows.filter(row => !target.has(rowKey(row))).map(row => ({
      address: rowKey(row), sourceQuantity: row.Quantity,
    })),
    added: right.rows.filter(row => !source.has(rowKey(row))).map(row => ({
      address: rowKey(row), targetQuantity: row.Quantity,
    })),
    changed: left.rows.filter(row => target.has(rowKey(row)) &&
      row.Quantity !== target.get(rowKey(row)).Quantity).map(row => ({
      address: rowKey(row), sourceQuantity: row.Quantity,
      targetQuantity: target.get(rowKey(row)).Quantity,
    })),
  };
}

export function traceCheckpoints(checkpoints, stages = ['system-a', 'petraplan', 'system-b']) {
  return stages.slice(1).map((to, index) => {
    const from = stages[index];
    if (!checkpoints[from] || !checkpoints[to]) {
      return { from, to, state: 'UNKNOWN_CHECKPOINT' };
    }
    return { from, to, ...compareCheckpoints(checkpoints[from], checkpoints[to]) };
  });
}
