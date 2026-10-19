import test from 'node:test';
import assert from 'node:assert/strict';
import { claimFreshnessBlockers, claimsAfterValidation } from './claimFreshness.js';

const claim = {
  id: 'claim-after', status: 'CONFIRMED', claim_type: 'SEMANTIC_MAPPING',
  created_at: '2026-10-17T12:00:00Z', subject_address: 'NW:A-10248#STATUS',
};

test('claim after a timestamped validation is detected as stale', () => {
  const validation = { id: 'validation-1', created_at: '2026-10-17T11:00:00Z' };
  assert.equal(claimsAfterValidation([claim], validation).length, 1);
  assert.equal(claimFreshnessBlockers([claim], validation).length, 1);
});

test('claim before a timestamped validation is not falsely classified as later', () => {
  const validation = { id: 'validation-1', created_at: '2026-10-17T13:00:00Z' };
  assert.deepEqual(claimsAfterValidation([claim], validation), []);
});

test('missing validation timestamp is not evidence that claims are fresh', () => {
  const validation = { id: 'validation-1' };
  assert.deepEqual(claimsAfterValidation([claim], validation), []);
  // The present helper returns no blockers: the API caller MUST independently
  // fail closed when the authoritative validation timestamp is missing.
  assert.deepEqual(claimFreshnessBlockers([claim], validation), []);
});
