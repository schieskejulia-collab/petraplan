import test from 'node:test';
import assert from 'node:assert/strict';
import { buildExplicitClaimDraft } from './claimFromCandidate.js';

const candidate = {
  id: '11111111-1111-4111-8111-111111111111',
  candidate_key: 'NW:CC:A-10305:QUANTITY-AGGREGATION',
  record_id: '22222222-2222-4222-8222-222222222222',
  snapshot_id: '33333333-3333-4333-8333-333333333333',
  source_address_id: '44444444-4444-4444-8444-444444444444',
  source_path: 'orderDetails[].Quantity',
  proposed_value: 80,
  conversion_kind: 'aggregate',
  evidence: 'Multiple position quantities were observed; aggregation is not yet a global rule.',
  state: 'confirmed',
};

const sourceAddress = {
  id: candidate.source_address_id,
  address: 'NW:A-10305#DetailQuantities',
  kind: 'collection',
};

const targetAddress = {
  id: '55555555-5555-4555-8555-555555555555',
  address: 'NW:A-10305#MENGE',
  kind: 'bridge_field',
};

test('creates an UNPROVEN CASE_ONLY claim with explicit evidence links', () => {
  const result = buildExplicitClaimDraft({
    candidate,
    sourceAddress,
    allowedSubjectAddresses: [targetAddress],
    subjectAddress: targetAddress.address,
    statement: 'For this case, the observed detail quantities may be used as the basis for Bridge-MENGE 80.',
    claimType: 'AGGREGATION',
    createdBy: 'reviewer-1',
    producerRole: 'owner_reviewer',
    sourceSystem: 'northwind',
    confirmation: {
      id: '66666666-6666-4666-8666-666666666666',
      changed_by: 'reviewer-1',
      changed_at: '2026-09-29T10:00:00Z',
      reason: 'Confirmed only for this case after reviewing the source rows.',
    },
  });

  assert.equal(result.claim.status, 'UNPROVEN');
  assert.equal(result.claim.scope_type, 'CASE_ONLY');
  assert.equal(result.claim.candidate_id, candidate.id);
  assert.equal(result.claim.subject_address, targetAddress.address);
  assert.equal(result.evidenceLinks.some((link) => link.evidence_type === 'SOURCE_ADDRESS' && link.relation === 'DERIVED_FROM'), true);
  assert.equal(result.evidenceLinks.some((link) => link.evidence_type === 'SOURCE_SNAPSHOT' && link.relation === 'DERIVED_FROM'), true);
  assert.equal(result.evidenceLinks.some((link) => link.evidence_type === 'CANDIDATE_EVIDENCE' && link.relation === 'SUPPORTS'), true);
  assert.equal(result.evidenceLinks.some((link) => link.evidence_type === 'HUMAN_CONFIRMATION' && link.relation === 'SUPPORTS'), true);
  assert.equal(Object.prototype.hasOwnProperty.call(result.claim, 'confirmed_by'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(result.claim, 'rule_id'), false);
});

test('refuses to create a claim from an open candidate', () => {
  assert.throws(() => buildExplicitClaimDraft({
    candidate: { ...candidate, state: 'candidate' },
    sourceAddress,
    allowedSubjectAddresses: [targetAddress],
    subjectAddress: targetAddress.address,
    statement: 'This statement is explicit and long enough.',
    claimType: 'AGGREGATION',
    createdBy: 'reviewer-1',
  }), /Only confirmed candidates/);
});

test('refuses a subject address outside the candidate source/impact graph', () => {
  assert.throws(() => buildExplicitClaimDraft({
    candidate,
    sourceAddress,
    allowedSubjectAddresses: [targetAddress],
    subjectAddress: 'NW:A-99999#MENGE',
    statement: 'This statement is explicit and long enough.',
    claimType: 'AGGREGATION',
    createdBy: 'reviewer-1',
  }), /source\/impact addresses/);
});
