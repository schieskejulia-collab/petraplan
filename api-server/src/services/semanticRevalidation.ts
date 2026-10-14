import { assessRevalidationReadiness } from './revalidationEvidence.js';
import { checkSemanticEvidence } from './semanticEvidence.js';

export type CombinedRevalidationInput = {
  readiness: Parameters<typeof assessRevalidationReadiness>[0];
  semantic: Parameters<typeof checkSemanticEvidence>[0] | null;
};

/**
 * Read-only, fail-closed coordination of structural readiness and supplied
 * semantic evidence. This is NOT an executable rule interpreter, trusted
 * external evidence verification, validation, review or release gate.
 */
export function assessSemanticRevalidation(input: CombinedRevalidationInput) {
  const readiness = assessRevalidationReadiness(input.readiness);
  if (readiness.state !== 'READY_FOR_SEMANTIC_EVIDENCE') {
    return {
      state: readiness.state,
      reason: readiness.reason,
      readiness,
      semantic: null,
      validationAllowed: false as const,
      releaseAllowed: false as const,
    };
  }
  const expected = input.readiness.rule;
  const evidence = input.semantic;
  if (!evidence || evidence.recordId !== expected.recordId
      || evidence.snapshotId !== expected.snapshotId
      || evidence.claimId !== expected.claimId
      || evidence.ruleVersionId !== expected.rule?.id
      || evidence.targetAddress !== expected.rule?.target_address
      || !String(expected.rule?.source_address ?? '').trim()
      || evidence.sourceAddress !== expected.rule?.source_address
      || !String(expected.rule?.conclusion ?? '').trim()
      || evidence.proposition !== expected.rule?.conclusion) {
    return {
      state: 'BLOCKED_SEMANTIC_BINDING' as const,
      reason: 'Semantic evidence must match the exact approved rule, claim, addresses, conclusion and snapshot',
      readiness,
      semantic: null,
      validationAllowed: false as const,
      releaseAllowed: false as const,
    };
  }
  const semantic = checkSemanticEvidence(evidence);
  return {
    state: semantic.state === 'READY_FOR_INDEPENDENT_REVIEW'
      ? 'READY_FOR_EXTERNAL_SEMANTIC_VERIFICATION' as const
      : 'BLOCKED_SEMANTIC_EVIDENCE' as const,
    reason: semantic.reason,
    readiness,
    semantic,
    validationAllowed: false as const,
    releaseAllowed: false as const,
  };
}
