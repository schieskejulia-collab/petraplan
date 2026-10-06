export type RevalidationEvidenceBlocker = {
  candidate_id: string;
  claim_ids: string[];
  code: 'CLAIM_MISSING' | 'CLAIM_AMBIGUOUS' | 'CLAIM_UNRESOLVED' | 'CLAIM_SCOPE_MISMATCH' | 'RULE_REFERENCE_MISSING' | 'RULE_AUTHORITY_UNVERIFIED';
  evidence_state: 'UNKNOWN';
  reason: string;
};

/**
 * Candidate confirmation is not semantic authority. The persisted semantic
 * rule catalogue and its scope-authority verifier are not implemented yet.
 * Consequently even a CONFIRMED claim with rule IDs cannot authorize applying
 * a proposed STATUS/MENGE value. No reference string is treated as a proof.
 */
export function revalidationEvidenceBlockers(input: {
  recordId: string;
  snapshotId: string;
  candidates: Array<Record<string, any>>;
  claims: Array<Record<string, any>>;
}): RevalidationEvidenceBlocker[] {
  return input.candidates.filter(candidate => candidate.state === 'confirmed').map(candidate => {
    const claims = input.claims.filter(claim => claim.candidate_id === candidate.id && claim.status !== 'SUPERSEDED');
    const base = {
      candidate_id: String(candidate.id),
      claim_ids: claims.map(claim => String(claim.id)),
      evidence_state: 'UNKNOWN' as const,
    };
    if (!claims.length) return { ...base, code: 'CLAIM_MISSING', reason: 'Für den bestätigten Kandidaten fehlt ein expliziter fachlicher Claim.' };
    if (claims.length !== 1) return { ...base, code: 'CLAIM_AMBIGUOUS', reason: 'Mehrere aktuelle Claims für diesen Kandidaten sind ungeklärt.' };
    const claim = claims[0];
    if (claim.status !== 'CONFIRMED') return { ...base, code: 'CLAIM_UNRESOLVED', reason: 'Der fachliche Claim ist noch nicht bestätigt. Eine Kandidatenbestätigung ersetzt diese Prüfung nicht.' };
    const scope = claim.scope_payload;
    if (candidate.record_id !== input.recordId || candidate.snapshot_id !== input.snapshotId
      || claim.record_id !== input.recordId || claim.snapshot_id !== input.snapshotId
      || claim.scope_type !== 'CASE_ONLY' || !scope
      || scope.record_id !== input.recordId || scope.snapshot_id !== input.snapshotId
      || scope.candidate_id !== candidate.id) {
      return { ...base, code: 'CLAIM_SCOPE_MISMATCH', reason: 'Claim und Kandidat sind nicht eindeutig an diesen Fall und Quell-Snapshot gebunden.' };
    }
    if (!String(claim.rule_id ?? '').trim() || !String(claim.rule_version ?? '').trim()) {
      return { ...base, code: 'RULE_REFERENCE_MISSING', reason: 'Dem Claim fehlt die Referenz auf eine versionierte fachliche Bedeutungsregel.' };
    }
    return { ...base, code: 'RULE_AUTHORITY_UNVERIFIED', reason: 'Regelbeleg, Geltungsbereich und fachliche Berechtigung sind noch nicht prüfbar. Der Regelkatalog ist bisher spezifiziert; eine Regelreferenz allein ist kein Bedeutungsbeleg.' };
  });
}
