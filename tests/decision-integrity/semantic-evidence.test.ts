import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkSemanticEvidence } from '../../api-server/src/services/semanticEvidence.js';

const base = {
  recordId: 'case-10266', snapshotId: 'snapshot-1', claimId: 'claim-1',
  ruleVersionId: 'rule-1', sourceAddress: 'NW:A-10266#ShippedDate',
  targetAddress: 'NW:A-10266#STATUS', proposition: 'STATUS=GESCHLOSSEN',
  requiredEvidenceIds: ['meaning-1'], coverage: 'COMPLETE' as const,
  unresolvedConflicts: 0,
  observations: [{
    evidenceId: 'meaning-1', recordId: 'case-10266', snapshotId: 'snapshot-1',
    claimId: 'claim-1', ruleVersionId: 'rule-1',
    sourceAddress: 'NW:A-10266#ShippedDate', targetAddress: 'NW:A-10266#STATUS',
    proposition: 'STATUS=GESCHLOSSEN', evidenceKind: 'MEANING' as const,
    verification: 'VERIFIED' as const, observedAt: '2026-10-14T10:00:00Z',
    provenance: { sourceReference: 'source-doc-1', sourceDigest: 'sha256:test-digest', verifierId: 'reviewer-1', verificationRecordId: 'verification-1', verifiedAt: '2026-10-14T10:04:00Z', authorityReference: 'authority-1' },
  }],
};
test('matching supplied meaning evidence only reaches independent review, never release', () => {
  const result = checkSemanticEvidence(base);
  assert.equal(result.state, 'READY_FOR_INDEPENDENT_REVIEW');
  assert.equal('releaseAllowed' in result, false);
  assert.equal('validationId' in result, false);
});
test('shipped date alone is not a semantic proof', () => {
  assert.equal(checkSemanticEvidence({ ...base, observations: [] }).state, 'BLOCKED_MISSING_EVIDENCE');
  assert.equal(checkSemanticEvidence({ ...base, observations: [{ ...base.observations[0], verification: 'UNVERIFIED' as const }] }).state, 'BLOCKED_MISSING_EVIDENCE');
});
test('scope, snapshot, rule and proposition mismatch block', () => {
  for (const change of [{ snapshotId: 'other' }, { ruleVersionId: 'other' },
    { proposition: 'STATUS=OFFEN' }, { sourceAddress: 'other' }]) {
    assert.equal(checkSemanticEvidence({ ...base, observations: [{ ...base.observations[0], ...change }] }).state, 'BLOCKED_BINDING_MISMATCH');
  }
});
test('counterevidence and unresolved conflicts block', () => {
  assert.equal(checkSemanticEvidence({ ...base, unresolvedConflicts: 1 }).state, 'BLOCKED_CONFLICT');
  assert.equal(checkSemanticEvidence({ ...base, observations: [{ ...base.observations[0], evidenceKind: 'COUNTEREXAMPLE' as const }] }).state, 'BLOCKED_CONFLICT');
});
test('unknown coverage, duplicates and absent requirements fail closed', () => {
  assert.equal(checkSemanticEvidence({ ...base, coverage: 'UNKNOWN' }).state, 'BLOCKED_MISSING_EVIDENCE');
  assert.equal(checkSemanticEvidence({ ...base, requiredEvidenceIds: [] }).state, 'BLOCKED_MISSING_EVIDENCE');
  assert.equal(checkSemanticEvidence({ ...base, observations: [...base.observations, ...base.observations] }).state, 'BLOCKED_MISSING_EVIDENCE');
});

test('a reviewer VERIFIED label without source provenance remains insufficient', () => {
  const observation = { ...base.observations[0], provenance: undefined };
  assert.equal(checkSemanticEvidence({ ...base, observations: [observation] }).state, 'BLOCKED_MISSING_EVIDENCE');
});
