import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveContextFreshness } from './contextFreshness.js';

test('fresh context is action-safe only with complete provenance', () => {
  const truth = deriveContextFreshness({
    source_system: 'sap-r3',
    source_reference: 'customer:4711',
    source_hash: 'sha256:abc',
    schema_version: 'customer-v1',
    observed_at: '2026-08-30T10:00:00Z',
    retrieved_at: '2026-08-30T10:00:10Z',
    valid_until: '2026-08-30T11:00:00Z',
  }, '2026-08-30T10:30:00Z');

  assert.equal(truth.status, 'fresh');
  assert.equal(truth.provenance_complete, true);
  assert.equal(truth.freshness_complete, true);
  assert.equal(truth.safe_for_action, true);
  assert.deepEqual(truth.missing, []);
});

test('expired context is stale and cannot be used for action', () => {
  const truth = deriveContextFreshness({
    source_system: 'sap-r3',
    source_reference: 'customer:4711',
    content_hash: 'sha256:def',
    schema_version: 'customer-v1',
    observed_at: '2026-08-30T09:00:00Z',
    retrieved_at: '2026-08-30T09:00:05Z',
    valid_until: '2026-08-30T09:30:00Z',
  }, '2026-08-30T10:00:00Z');

  assert.equal(truth.status, 'stale');
  assert.equal(truth.safe_for_action, false);
});

test('missing freshness metadata stays unknown instead of being assumed current', () => {
  const truth = deriveContextFreshness({
    source_system: 'legacy-db',
    source_reference: 'order:99',
    source_hash: 'sha256:ghi',
    retrieved_at: '2026-08-30T10:00:00Z',
  }, '2026-08-30T10:10:00Z');

  assert.equal(truth.status, 'unknown');
  assert.equal(truth.safe_for_action, false);
  assert.ok(truth.missing.includes('schema_version'));
  assert.ok(truth.missing.includes('observed_at'));
  assert.ok(truth.missing.includes('valid_until'));
});

test('future validity window is not yet valid', () => {
  const truth = deriveContextFreshness({
    source_system: 'legacy-db',
    source_reference: 'rate:2026-09',
    source_hash: 'sha256:jkl',
    schema_version: 'rate-v2',
    observed_at: '2026-08-30T10:00:00Z',
    retrieved_at: '2026-08-30T10:00:05Z',
    valid_from: '2026-09-01T00:00:00Z',
    valid_until: '2026-10-01T00:00:00Z',
  }, '2026-08-30T10:30:00Z');

  assert.equal(truth.status, 'not_yet_valid');
  assert.equal(truth.safe_for_action, false);
});
