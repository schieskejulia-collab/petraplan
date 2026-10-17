import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAddressClaimReadModel } from './addressClaimReadModel.js';

// Contract test for the case API's fail-closed release input.
// The HTTP handler must supply null effectiveReleaseStatus if the
// authoritative validation lacks a parseable timestamp.
function caseReleaseStatus(validation: Record<string, unknown> | null, releaseStatus: string) {
  const stamp = validation?.created_at ?? validation?.validated_at ?? validation?.updated_at;
  const parsed = typeof stamp === 'string' ? Date.parse(stamp) : NaN;
  return Boolean(validation?.id) && Number.isFinite(parsed) ? releaseStatus : null;
}
const claim = {
  id: 'c1', record_id: 'r1', snapshot_id: 's1',
  subject_address: 'NW:A-10248#STATUS', scope_type: 'CASE_ONLY',
  scope_payload: { record_id: 'r1', snapshot_id: 's1' },
  status: 'CONFIRMED', confirmed_by: 'reviewer',
  confirmed_at: '2026-10-17T10:00:00Z', statement: 'Status confirmed',
};
function read(validation: Record<string, unknown> | null) {
  return buildAddressClaimReadModel({
    address: claim.subject_address, recordId: 'r1', snapshotId: 's1',
    at: '2026-10-17T12:00:00Z', claims: [claim],
    evidenceLinks: [{ claim_id: 'c1', relation: 'SUPPORTS' }],
    effectiveReleaseStatus: caseReleaseStatus(validation, 'trusted'),
    authoritativeValidationId: 'v1', certificateValidationId: 'v1',
  });
}
test('missing validation timestamp must block address claim use', () => {
  const result = read({ id: 'v1' });
  assert.equal(result.claims[0].classification, 'CONFIRMED_NOT_CURRENTLY_USABLE');
  assert.ok(result.claims[0].blockers.includes('CURRENT_RELEASE_NOT_VERIFIED'));
});
test('invalid validation timestamp must block address claim use', () => {
  assert.equal(read({ id: 'v1', created_at: 'invalid' }).status, 'NO_CURRENTLY_USABLE_CLAIMS');
});
test('timestamp alone does not authorize release without validation identity', () => {
  assert.equal(read({ created_at: '2026-10-17T11:00:00Z' }).status, 'NO_CURRENTLY_USABLE_CLAIMS');
});
