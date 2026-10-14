/**
 * Read-only semantic evidence assessment. This checks the coherence of supplied
 * verified observations; it does not authenticate external evidence, execute a
 * semantic rule, mutate a Claim, or authorize Validation/Release.
 */
export type SemanticEvidenceState =
  | 'BLOCKED_MISSING_EVIDENCE'
  | 'BLOCKED_BINDING_MISMATCH'
  | 'BLOCKED_CONFLICT'
  | 'READY_FOR_INDEPENDENT_REVIEW';

export type SemanticObservation = {
  evidenceId: string;
  recordId: string;
  snapshotId: string;
  claimId: string;
  ruleVersionId: string;
  sourceAddress: string;
  targetAddress: string;
  proposition: string;
  evidenceKind: 'MEANING' | 'COUNTEREXAMPLE';
  verification: 'VERIFIED' | 'UNVERIFIED';
  observedAt: string;
};

export function checkSemanticEvidence(input: {
  recordId: string;
  snapshotId: string;
  claimId: string;
  ruleVersionId: string;
  sourceAddress: string;
  targetAddress: string;
  proposition: string;
  requiredEvidenceIds: string[];
  observations: SemanticObservation[];
  coverage: 'COMPLETE' | 'INCOMPLETE' | 'UNKNOWN';
  unresolvedConflicts: number;
}): { state: SemanticEvidenceState; reason: string; evidenceIds: string[] } {
  const block = (state: SemanticEvidenceState, reason: string) =>
    ({ state, reason, evidenceIds: [] as string[] });
  const fields = [input.recordId, input.snapshotId, input.claimId, input.ruleVersionId,
    input.sourceAddress, input.targetAddress, input.proposition];
  if (fields.some(v => typeof v !== 'string' || !v.trim())
      || !Array.isArray(input.requiredEvidenceIds) || input.requiredEvidenceIds.length === 0
      || !Array.isArray(input.observations)) {
    return block('BLOCKED_MISSING_EVIDENCE', 'Identity, proposition or required evidence is missing');
  }
  if (!Number.isSafeInteger(input.unresolvedConflicts) || input.unresolvedConflicts < 0
      || !['COMPLETE', 'INCOMPLETE', 'UNKNOWN'].includes(input.coverage)) {
    return block('BLOCKED_MISSING_EVIDENCE', 'Conflict count or source coverage is unknown');
  }
  const required = new Set(input.requiredEvidenceIds);
  if (required.size !== input.requiredEvidenceIds.length
      || [...required].some(id => typeof id !== 'string' || !id.trim())) {
    return block('BLOCKED_MISSING_EVIDENCE', 'Required evidence identifiers must be unique and nonempty');
  }
  const seen = new Set<string>();
  for (const obs of input.observations) {
    if (!obs || typeof obs.evidenceId !== 'string' || !obs.evidenceId.trim()
        || seen.has(obs.evidenceId)) {
      return block('BLOCKED_MISSING_EVIDENCE', 'Evidence identifiers are missing or duplicated');
    }
    seen.add(obs.evidenceId);
    if (obs.recordId !== input.recordId || obs.snapshotId !== input.snapshotId
        || obs.claimId !== input.claimId || obs.ruleVersionId !== input.ruleVersionId
        || obs.sourceAddress !== input.sourceAddress || obs.targetAddress !== input.targetAddress
        || obs.proposition !== input.proposition) {
      return block('BLOCKED_BINDING_MISMATCH', 'Evidence belongs to a different claim, rule, scope or proposition');
    }
    if (!Number.isFinite(Date.parse(obs.observedAt))) {
      return block('BLOCKED_MISSING_EVIDENCE', 'Evidence timestamp is not verifiable');
    }
  }
  if (input.unresolvedConflicts > 0
      || input.observations.some(obs => obs.evidenceKind === 'COUNTEREXAMPLE')) {
    return block('BLOCKED_CONFLICT', 'Contradictory evidence or unresolved conflicts remain');
  }
  if (input.coverage !== 'COMPLETE'
      || input.observations.some(obs => obs.verification !== 'VERIFIED' || obs.evidenceKind !== 'MEANING')
      || [...required].some(id => !seen.has(id))) {
    return block('BLOCKED_MISSING_EVIDENCE', 'Coverage or independent meaning evidence is insufficient');
  }
  return {
    state: 'READY_FOR_INDEPENDENT_REVIEW',
    reason: 'Supplied evidence is structurally coherent; external authenticity, semantic truth and atomic binding remain unproven',
    evidenceIds: [...required].sort(),
  };
}
