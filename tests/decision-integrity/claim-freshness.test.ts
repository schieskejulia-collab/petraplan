import { test } from 'node:test';
import assert from 'node:assert/strict';
import { claimFreshnessBlockers, claimsAfterValidation } from '../../api-server/src/services/claimFreshness.js';

test('a later active claim makes the validation basis stale without changing the validation', () => {
  const validation = { id: 'validation-1', status: 'passed', created_at: '2026-09-29T18:00:00.000Z' };
  const claims = [{ id: 'claim-1', status: 'UNPROVEN', created_at: '2026-09-29T18:05:00.000Z', subject_address: 'STATUS' }];
  assert.equal(claimsAfterValidation(claims, validation).length, 1);
  assert.deepEqual(claimFreshnessBlockers(claims, validation), [
    '1 relevanter Claim ist nach der maßgeblichen Validierung entstanden. Neuvalidierung ist erforderlich.',
  ]);
  assert.equal(validation.status, 'passed');
});

test('claims already present at validation time do not stale the basis', () => {
  const validation = { created_at: '2026-09-29T18:00:00.000Z' };
  const claims = [{ status: 'CONFIRMED', created_at: '2026-09-29T17:59:59.000Z' }];
  assert.deepEqual(claimFreshnessBlockers(claims, validation), []);
});

test('rejected or superseded later claims do not block a new decision', () => {
  const validation = { created_at: '2026-09-29T18:00:00.000Z' };
  const claims = [
    { status: 'REJECTED', created_at: '2026-09-29T18:05:00.000Z' },
    { status: 'SUPERSEDED', created_at: '2026-09-29T18:06:00.000Z' },
  ];
  assert.deepEqual(claimFreshnessBlockers(claims, validation), []);
});
