import test from 'node:test';
import assert from 'node:assert/strict';
import { compareStinoDinoRevisions } from './stinodino-revision-comparison.mjs';
import { submitStinoDinoRevisionObservation } from './stinodino-claim-test-adapter.mjs';

const base = "UNH+1+ORDERS:D:96A:UN'BGM+220+STINODINO-001+9'LIN+1++4000862141404:EN'QTY+21:48:PCE'LIN+2++4000862141411:EN'QTY+21:12:PCE'UNT+7+1'";

test('same numeric quantity, different unit triggers revalidation without implicit conversion', () => {
  const t1 = base.replace('48:PCE', '48:CT');
  const comparison = compareStinoDinoRevisions(base, t1);
  assert.equal(comparison.t0.observations[0].value, '48');
  assert.equal(comparison.t1.observations[0].value, '48');
  assert.equal(comparison.t0.observations[0].unit, 'PCE');
  assert.equal(comparison.t1.observations[0].unit, 'CT');
  assert.equal(comparison.assessment, 'BLOCKED_REVALIDATION_REQUIRED');
  assert.equal(comparison.oldEvidenceUsableForCurrentSource, false);
  assert.equal(comparison.releaseAllowed, false);
});

test('same numeric quantity, different qualifier changes semantic basis', () => {
  const t1 = base.replace('QTY+21:48:PCE', 'QTY+59:48:PCE');
  const comparison = compareStinoDinoRevisions(base, t1);
  assert.equal(comparison.sourceChanged, true);
  assert.equal(comparison.assessment, 'BLOCKED_REVALIDATION_REQUIRED');
  assert.equal(comparison.releaseAllowed, false);
});

test('test adapter passes changed unit into UNPROVEN claim without approval', async () => {
  const writes = [];
  const db = { query: async (sql, params) => {
    writes.push({ sql, params });
    return { rows: [{ id: 'synthetic-claim-id' }] };
  }};
  const result = await submitStinoDinoRevisionObservation({
    db, t0Raw: base, t1Raw: base.replace('48:PCE', '48:CT'),
    recordId: 'test-record', snapshotId: 'test-snapshot',
  });
  assert.equal(result.submitted, true);
  assert.equal(writes.length, 1);
  const payload = JSON.parse(writes[0].params[3]);
  assert.equal(payload.changedObservations[0].value, '48');
  assert.equal(payload.changedObservations[0].unit, 'CT');
  assert.equal(payload.semanticAuthority, 'none');
  assert.match(writes[0].sql, /'UNPROVEN'/);
});

test('qualifier-only changes still require a claim, even when value and unit match', async () => {
  const writes = [];
  const db = { query: async (sql, params) => {
    writes.push({ sql, params });
    return { rows: [{ id: 'synthetic-claim-id' }] };
  }};
  const result = await submitStinoDinoRevisionObservation({
    db, t0Raw: base, t1Raw: base.replace('QTY+21:48:PCE', 'QTY+59:48:PCE'),
    recordId: 'test-record', snapshotId: 'test-snapshot',
  });
  assert.equal(result.submitted, true);
  assert.equal(writes.length, 1);
  const payload = JSON.parse(writes[0].params[3]);
  assert.equal(payload.assessment, 'BLOCKED_REVALIDATION_REQUIRED');
  assert.equal(payload.changedObservations.length, 1);
  assert.equal(payload.changedObservations[0].qualifier, '59');
  assert.equal(payload.changedObservations[0].value, '48');
});
