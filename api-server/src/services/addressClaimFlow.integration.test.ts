import test from 'node:test';
import assert from 'node:assert/strict';
import { buildExplicitClaimDraft } from './claimFromCandidate.js';
import { buildAddressClaimReadModel } from './addressClaimReadModel.js';

const recordId = '00000000-0000-4000-8000-000000000001';
const snapshotId = '00000000-0000-4000-8000-000000000002';
const address = 'NW:A-10248#STATUS';

function scenario() {
  const draft = buildExplicitClaimDraft({
    candidate: {
      id: 'candidate-1', candidate_key: 'STATUS-DERIVATION',
      record_id: recordId, snapshot_id: snapshotId, source_address_id: 'address-1',
      proposed_value: 'shipped', evidence: 'Observed source data', state: 'confirmed',
    },
    sourceAddress: { id: 'address-1', address },
    allowedSubjectAddresses: [],
    subjectAddress: address,
    statement: 'The status has been reviewed in its case context.',
    claimType: 'SEMANTIC_MAPPING',
    createdBy: 'reviewer-1',
  });
  const claim = { id: 'claim-1', ...draft.claim };
  const evidenceLinks = draft.evidenceLinks.map((link, i) => ({ id: 'e-' + i, claim_id: claim.id, ...link }));
  const input = {
    address, recordId, snapshotId, at: '2026-10-17T12:00:00Z',
    claims: [claim], evidenceLinks,
    effectiveReleaseStatus: 'trusted',
    authoritativeValidationId: 'validation-1',
    certificateValidationId: 'validation-1',
  };
  return { draft, input };
}

test('confirmed candidate produces UNPROVEN claim; case read cannot silently promote it', () => {
  const { draft, input } = scenario();
  assert.equal(draft.claim.status, 'UNPROVEN');
  const read = buildAddressClaimReadModel(input);
  assert.equal(read.claims.length, 1);
  assert.equal(read.claims[0].classification, 'UNCONFIRMED');
  assert.ok(read.claims[0].blockers.includes('CLAIM_NOT_CONFIRMED'));
});

test('source-derived claim cannot escape its recorded case and snapshot', () => {
  const { input } = scenario();
  const wrongCase = buildAddressClaimReadModel({ ...input, recordId: 'other-case' });
  assert.equal(wrongCase.claims.length, 0);
  const wrongSnapshot = buildAddressClaimReadModel({ ...input, snapshotId: 'other-snapshot' });
  assert.ok(wrongSnapshot.claims[0].blockers.includes('SCOPE_UNVERIFIED'));
});

test('historical confirmed claim remains visible but unusable after release revocation', () => {
  const { input } = scenario();
  const claim = { ...input.claims[0], status: 'CONFIRMED', confirmed_by: 'reviewer-2',
    confirmed_at: '2026-10-17T11:00:00Z' };
  const read = buildAddressClaimReadModel({
    ...input, claims: [claim], effectiveReleaseStatus: 'revoked',
  });
  assert.equal(read.claims[0].classification, 'CONFIRMED_NOT_CURRENTLY_USABLE');
  assert.ok(read.claims[0].blockers.includes('CURRENT_RELEASE_NOT_VERIFIED'));
});
