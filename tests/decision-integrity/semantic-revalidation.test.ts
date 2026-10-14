import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assessSemanticRevalidation } from '../../api-server/src/services/semanticRevalidation.js';

const recordId = 'case-10266', snapshotId = 'snapshot-1', candidateId = 'candidate-1';
const claimId = 'claim-1', ruleId = 'rule-1';
const sourceAddress = 'NW:A-10266#ShippedDate';
const targetAddress = 'NW:A-10266#STATUS';
const proposition = 'STATUS=GESCHLOSSEN';
const base = {
  readiness: {
    transition: {
      objectKey: { order: 10266 },
      before: { snapshotId: 'before-1', observedAt: '2026-10-14T10:00:00Z',
    provenance: { sourceReference: 'source-doc-1', sourceDigest: 'sha256:test-digest', verifierId: 'reviewer-1', verificationRecordId: 'verification-1', verifiedAt: '2026-10-14T10:04:00Z', authorityReference: 'authority-1' }, value: 'OPEN' },
      operation: { kind: 'STATUS_CHANGE', occurredAt: '2026-10-14T10:01:00Z', fromValue: 'OPEN', toValue: 'CLOSED' },
      after: { snapshotId: 'after-1', observedAt: '2026-10-14T10:02:00Z', value: 'CLOSED' },
    },
    rule: {
      recordId, snapshotId, candidateId, claimId, claimBasis: 'basis-1',
      rule: { id: ruleId, record_id: recordId, snapshot_id: snapshotId,
        candidate_id: candidateId, claim_id: claimId, claim_basis: 'basis-1',
        scope_type: 'CASE_ONLY', source_address: sourceAddress, target_address: targetAddress,
        conclusion: proposition },
      latestDecision: { rule_version_id: ruleId, authority_id: 'auth-1',
        actor_id: 'actor-1', decision: 'APPROVED' },
      authority: { id: 'auth-1', user_id: 'actor-1', record_id: recordId,
        snapshot_id: snapshotId, target_address: targetAddress, authority_reference: 'delegation-1',
        granted_at: '2026-10-01T00:00:00Z', valid_until: '2026-11-01T00:00:00Z' },
      revoked: false, checkedAt: '2026-10-14T10:03:00Z',
    },
  },
  semantic: {
    recordId, snapshotId, claimId, ruleVersionId: ruleId, sourceAddress, targetAddress,
    proposition, requiredEvidenceIds: ['meaning-1'],
    coverage: 'COMPLETE' as const, unresolvedConflicts: 0,
    observations: [{ evidenceId: 'meaning-1', recordId, snapshotId, claimId,
      ruleVersionId: ruleId, sourceAddress, targetAddress, proposition,
      evidenceKind: 'MEANING' as const, verification: 'VERIFIED' as const,
      observedAt: '2026-10-14T10:02:30Z' }],
  },
};

test('all supplied gates coherent still never authorize validation or release', () => {
  const result = assessSemanticRevalidation(base);
  assert.equal(result.state, 'READY_FOR_EXTERNAL_SEMANTIC_VERIFICATION');
  assert.equal(result.validationAllowed, false);
  assert.equal(result.releaseAllowed, false);
});
test('transition mismatch blocks before semantic assessment', () => {
  const result = assessSemanticRevalidation({ ...base, readiness: {
    ...base.readiness, transition: { ...base.readiness.transition,
      after: { ...base.readiness.transition.after, value: 'OPEN' } },
  } });
  assert.equal(result.state, 'BLOCKED_TRANSITION');
  assert.equal(result.semantic, null);
});
test('stale authority blocks even with coherent semantic observations', () => {
  const result = assessSemanticRevalidation({ ...base, readiness: { ...base.readiness,
    rule: { ...base.readiness.rule, revoked: true } } });
  assert.equal(result.state, 'BLOCKED_RULE_GOVERNANCE');
});
test('wrong rule, claim, source, target or proposition cannot cross the binding', () => {
  for (const change of [{ ruleVersionId: 'other' }, { claimId: 'other' },
    { sourceAddress: 'other' }, { targetAddress: 'other' }, { proposition: 'STATUS=OFFEN' }]) {
    const result = assessSemanticRevalidation({ ...base, semantic: { ...base.semantic, ...change } });
    assert.equal(result.state, 'BLOCKED_SEMANTIC_BINDING');
    assert.equal(result.validationAllowed, false);
  }
});
test('missing or conflicted evidence blocks', () => {
  assert.equal(assessSemanticRevalidation({ ...base, semantic: null }).state, 'BLOCKED_SEMANTIC_BINDING');
  assert.equal(assessSemanticRevalidation({ ...base, semantic: { ...base.semantic,
    unresolvedConflicts: 1 } }).state, 'BLOCKED_SEMANTIC_EVIDENCE');
  assert.equal(assessSemanticRevalidation({ ...base, semantic: { ...base.semantic,
    coverage: 'UNKNOWN' as const } }).state, 'BLOCKED_SEMANTIC_EVIDENCE');
});
test('rule without explicit source address and conclusion cannot claim semantic binding', () => {
  const result = assessSemanticRevalidation({ ...base, readiness: { ...base.readiness,
    rule: { ...base.readiness.rule, rule: { ...base.readiness.rule.rule, source_address: '' } } } });
  assert.equal(result.state, 'BLOCKED_SEMANTIC_BINDING');
});
