import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAddressClaimReadModel } from './addressClaimReadModel.js';

const baseClaim = {
  id: 'claim-1', record_id: 'case-1', snapshot_id: 'snap-1',
  subject_address: 'NW:A-10248#STATUS', scope_type: 'CASE_ONLY',
  scope_payload: { record_id: 'case-1', snapshot_id: 'snap-1' },
  status: 'CONFIRMED', confirmed_by: 'reviewer', confirmed_at: '2026-10-01T10:00:00Z',
  statement: 'Reviewed meaning', predicate: 'status', object_value: 'shipped',
  valid_from: '2026-09-01T00:00:00Z', valid_to: '2026-12-01T00:00:00Z',
};
const evidence = [{ claim_id: 'claim-1', relation: 'SUPPORTS', evidence_reference: 'proof-1' }];
function read(overrides: Record<string, any> = {}) {
  return buildAddressClaimReadModel({
    address: 'NW:A-10248#STATUS', recordId: 'case-1', snapshotId: 'snap-1',
    at: '2026-10-15T00:00:00Z', claims: [baseClaim], evidenceLinks: evidence,
    effectiveReleaseStatus: 'trusted', authoritativeValidationId: 'v1',
    certificateValidationId: 'v1', ...overrides,
  });
}
test('confirmed case-scoped claim with matching evidence and release is usable', () => {
  assert.equal(read().claims[0].classification, 'CURRENTLY_USABLE');
});
test('unproven claim cannot become usable', () => {
  assert.equal(read({claims: [{...baseClaim, status: 'UNPROVEN'}]}).status, 'NO_CURRENTLY_USABLE_CLAIMS');
});
test('revoked release preserves history but blocks current use', () => {
  const result = read({effectiveReleaseStatus: 'revoked'});
  assert.equal(result.claims[0].classification, 'CONFIRMED_NOT_CURRENTLY_USABLE');
  assert.ok(result.claims[0].blockers.includes('CURRENT_RELEASE_NOT_VERIFIED'));
});
test('mismatched snapshot fails closed', () => {
  assert.ok(read({snapshotId: 'snap-2'}).claims[0].blockers.includes('SCOPE_UNVERIFIED'));
});
test('expired claim fails closed', () => {
  assert.ok(read({at: '2027-01-01T00:00:00Z'}).claims[0].blockers.includes('TIME_UNVERIFIED'));
});
test('contradictory evidence blocks use', () => {
  const result = read({evidenceLinks: [...evidence, {claim_id: 'claim-1', relation: 'CONTRADICTS'}]});
  assert.ok(result.claims[0].blockers.includes('CONTRADICTORY_EVIDENCE'));
});
test('missing evidence blocks use', () => {
  assert.ok(read({evidenceLinks: []}).claims[0].blockers.includes('EVIDENCE_NOT_LINKED'));
});
test('different address does not leak case claims', () => {
  assert.deepEqual(read({address: 'NW:A-10249#STATUS'}).claims, []);
});
test('mismatched validation certificate blocks use', () => {
  assert.ok(read({certificateValidationId: 'v2'}).claims[0].blockers.includes('CURRENT_RELEASE_NOT_VERIFIED'));
});
test('invalid query timestamp blocks output', () => {
  assert.equal(read({at: 'not-a-date'}).status, 'BLOCKED');
});
