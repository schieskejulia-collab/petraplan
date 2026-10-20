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

import { assessPositionChanges, proposePositionClaimBindings } from './stinodino-position-dependencies.mjs';

test('position observation change does not prove independent release', () => {
  const result = assessPositionChanges(base, base.replace('48:PCE', '48:CT'));
  assert.deepEqual(result.positions.map(item => item.changed), [true, false]);
  assert.equal(result.independenceProven, false);
  assert.equal(result.releaseAllowed, false);
  assert.ok(result.positions.every(item => item.releasePreserved === false));
});

test('duplicate position identifiers block positional binding', () => {
  const result = assessPositionChanges(base, base.replace('LIN+2++', 'LIN+1++'));
  assert.equal(result.assessment, 'BLOCKED_POSITION_BINDING_UNPROVEN');
  assert.equal(result.independenceProven, false);
});

test('qualifier-only drift isolates observation but does not prove release independence', () => {
  const result = assessPositionChanges(base, base.replace('QTY+21:48:PCE', 'QTY+59:48:PCE'));
  assert.deepEqual(result.positions.map(item => item.changed), [true, false]);
  assert.equal(result.independenceProven, false);
  assert.ok(result.positions.every(item => !item.releasePreserved));
});

test('reordered LIN identifiers cannot be silently paired by array index', () => {
  const changed = base.replace('LIN+1++', 'LIN+TEMP++')
    .replace('LIN+2++', 'LIN+1++').replace('LIN+TEMP++', 'LIN+2++');
  const result = assessPositionChanges(base, changed);
  assert.equal(result.assessment, 'BLOCKED_POSITION_BINDING_UNPROVEN');
  assert.deepEqual(result.positions, []);
});

test('missing LIN identifier cannot establish independent position', () => {
  const result = assessPositionChanges(base, base.replace('LIN+2++', 'LIN+++'));
  assert.equal(result.assessment, 'BLOCKED_POSITION_BINDING_UNPROVEN');
  assert.equal(result.releaseAllowed, false);
});

test('position-to-claim binding stays a proposal without release authority', () => {
  const result = proposePositionClaimBindings(base, base.replace('48:PCE', '48:CT'));
  assert.equal(result.state, 'CANDIDATE_ONLY');
  assert.deepEqual(result.candidates.map(item => item.observationChanged), [true, false]);
  assert.deepEqual(result.candidates.map(item => item.subjectAddress), [
    'synthetic:stinodino-001#LIN-1/QTY',
    'synthetic:stinodino-001#LIN-2/QTY',
  ]);
  assert.ok(result.candidates.every(item => item.claimStatus === 'UNPROVEN' &&
    item.scopeStatus === 'UNVERIFIED' && item.releaseAllowed === false));
  assert.equal(result.independentReleaseProven, false);
});

test('ambiguous LIN identity cannot create position claim bindings', () => {
  const result = proposePositionClaimBindings(base, base.replace('LIN+2++', 'LIN+1++'));
  assert.equal(result.state, 'BLOCKED_POSITION_BINDING_UNPROVEN');
  assert.deepEqual(result.candidates, []);
  assert.equal(result.releaseAllowed, false);
});
