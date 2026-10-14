export type RevalidationEvidenceBlocker = {
  candidate_id: string;
  claim_ids: string[];
  code: 'CLAIM_MISSING' | 'CLAIM_AMBIGUOUS' | 'CLAIM_UNRESOLVED' | 'CLAIM_SCOPE_MISMATCH' | 'RULE_REFERENCE_MISSING' | 'RULE_AUTHORITY_UNVERIFIED';
  evidence_state: 'UNKNOWN';
  reason: string;
};

/**
 * Candidate confirmation is not semantic authority. The rule governance catalogue exists, but the executable rule/Claim
 * verifier has not yet been connected to revalidation.
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
    return { ...base, code: 'RULE_AUTHORITY_UNVERIFIED', reason: 'Regelbeleg, Geltungsbereich und fachliche Berechtigung sind noch nicht prüfbar. Der Regel-Genehmigungsweg ist noch nicht an eine ausführbare fachliche Neuvalidierung angeschlossen; eine Regelreferenz allein ist kein Bedeutungsbeleg.' };
  });
}


export type RuleFreshnessResult = {
  state: 'BLOCKED_INCOMPLETE_EVIDENCE' | 'BLOCKED_BINDING_MISMATCH' | 'BLOCKED_STALE_BASIS' | 'READY_FOR_EVIDENCE_REVIEW';
  reason: string;
};

/** Read-only governance check. READY does not authorize validation or release. */
export function checkRuleFreshness(input: {
  recordId: string;
  snapshotId: string;
  candidateId: string;
  claimId: string;
  claimBasis: string;
  rule: Record<string, any> | null;
  latestDecision: Record<string, any> | null;
  authority: Record<string, any> | null;
  revoked: boolean;
  checkedAt: string;
}): RuleFreshnessResult {
  const block = (state: RuleFreshnessResult['state'], reason: string): RuleFreshnessResult => ({ state, reason });
  const { rule, latestDecision: decision, authority } = input;
  if (!rule || !decision || !authority || !input.claimBasis) {
    return block('BLOCKED_INCOMPLETE_EVIDENCE', 'Missing rule, decision, authority or claim basis');
  }
  if (rule.record_id !== input.recordId || rule.snapshot_id !== input.snapshotId
    || rule.candidate_id !== input.candidateId || rule.claim_id !== input.claimId
    || rule.scope_type !== 'CASE_ONLY' || authority.record_id !== input.recordId
    || authority.snapshot_id !== input.snapshotId || authority.target_address !== rule.target_address
    || authority.user_id !== decision.actor_id || decision.rule_version_id !== rule.id
    || decision.authority_id !== authority.id) {
    return block('BLOCKED_BINDING_MISMATCH', 'Rule, decision and authority do not share one scope');
  }
  if (rule.claim_basis !== input.claimBasis || decision.decision !== 'APPROVED' || input.revoked) {
    return block('BLOCKED_STALE_BASIS', 'Rule basis or approval is no longer current');
  }
  const now = Date.parse(input.checkedAt);
  const from = Date.parse(authority.granted_at ?? '');
  const until = Date.parse(authority.valid_until ?? '');
  if (![now, from, until].every(Number.isFinite) || !String(authority.authority_reference ?? '').trim()) {
    return block('BLOCKED_INCOMPLETE_EVIDENCE', 'Authority validity cannot be established');
  }
  if (now < from || now >= until) {
    return block('BLOCKED_STALE_BASIS', 'Authority is not valid at evaluation time');
  }
  return { state: 'READY_FOR_EVIDENCE_REVIEW',
    reason: 'Governance metadata checked; independent semantic evidence and atomic database verification still required' };
}


export type TransitionEvidenceResult = {
  state: 'BLOCKED_INCOMPLETE_TRANSITION' | 'BLOCKED_IDENTITY_MISMATCH' | 'BLOCKED_STATE_MISMATCH' | 'READY_FOR_SEMANTIC_REVIEW';
  reason: string;
};

/**
 * Checks whether one claimed state transition is internally coherent:
 * same object identity, explicit before/after snapshots, one operation, and
 * expected post-state matching observed post-state.
 *
 * This does not prove business meaning and never authorizes release.
 */
export function checkTransitionEvidence(input: {
  objectKey: Record<string, unknown>;
  before: { snapshotId: string; observedAt: string; value: unknown } | null;
  operation: { kind: string; occurredAt: string; delta?: number; fromValue?: unknown; toValue?: unknown } | null;
  after: { snapshotId: string; observedAt: string; value: unknown } | null;
  expectedObjectKey?: Record<string, unknown>;
}): TransitionEvidenceResult {
  const block = (state: TransitionEvidenceResult['state'], reason: string): TransitionEvidenceResult => ({ state, reason });
  const key = JSON.stringify(input.objectKey ?? {});
  const expectedKey = JSON.stringify(input.expectedObjectKey ?? input.objectKey ?? {});
  if (!key || key === '{}' || !input.before || !input.operation || !input.after) {
    return block('BLOCKED_INCOMPLETE_TRANSITION', 'Object key, before state, operation and after state are all required');
  }
  if (key !== expectedKey) {
    return block('BLOCKED_IDENTITY_MISMATCH', 'Observed transition is not bound to the expected object identity');
  }
  if (input.before.snapshotId === input.after.snapshotId
    || ![input.before.observedAt, input.operation.occurredAt, input.after.observedAt].every(v => Number.isFinite(Date.parse(v)))) {
    return block('BLOCKED_INCOMPLETE_TRANSITION', 'Distinct snapshots and valid event times are required');
  }
  const beforeAt = Date.parse(input.before.observedAt);
  const eventAt = Date.parse(input.operation.occurredAt);
  const afterAt = Date.parse(input.after.observedAt);
  if (!(beforeAt <= eventAt && eventAt <= afterAt)) {
    return block('BLOCKED_STATE_MISMATCH', 'Operation time is outside the observed state interval');
  }

  let expected = input.operation.toValue;
  if (expected === undefined && typeof input.before.value === 'number' && typeof input.operation.delta === 'number') {
    expected = input.before.value + input.operation.delta;
  }
  if (input.operation.fromValue !== undefined && input.operation.fromValue !== input.before.value) {
    return block('BLOCKED_STATE_MISMATCH', 'Operation input does not match the observed before state');
  }
  if (expected === undefined) {
    return block('BLOCKED_INCOMPLETE_TRANSITION', 'Operation lacks a verifiable expected post-state');
  }
  if (expected !== input.after.value) {
    return block('BLOCKED_STATE_MISMATCH', 'Observed after state does not match the operation result');
  }
  return { state: 'READY_FOR_SEMANTIC_REVIEW',
    reason: 'Identity and state transition are coherent; semantic meaning and authority still require independent verification' };
}


export type RevalidationReadinessResult = {
  state: 'BLOCKED_TRANSITION' | 'BLOCKED_RULE_GOVERNANCE' | 'READY_FOR_SEMANTIC_EVIDENCE';
  transition: TransitionEvidenceResult;
  rule: RuleFreshnessResult;
  reason: string;
};

/**
 * Combines lifecycle coherence and semantic-rule freshness.
 * READY means only that both structural gates passed; semantic evidence,
 * conflict review and atomic persistence are still required.
 */
export function assessRevalidationReadiness(input: {
  transition: Parameters<typeof checkTransitionEvidence>[0];
  rule: Parameters<typeof checkRuleFreshness>[0];
}): RevalidationReadinessResult {
  const transition = checkTransitionEvidence(input.transition);
  const rule = checkRuleFreshness(input.rule);

  if (transition.state !== 'READY_FOR_SEMANTIC_REVIEW') {
    return {
      state: 'BLOCKED_TRANSITION',
      transition,
      rule,
      reason: 'Object identity or lifecycle transition is not sufficiently proven',
    };
  }
  if (rule.state !== 'READY_FOR_EVIDENCE_REVIEW') {
    return {
      state: 'BLOCKED_RULE_GOVERNANCE',
      transition,
      rule,
      reason: 'Semantic rule basis or authority is not sufficiently current',
    };
  }
  return {
    state: 'READY_FOR_SEMANTIC_EVIDENCE',
    transition,
    rule,
    reason: 'Lifecycle and rule governance gates passed; semantic evidence and atomic persistence remain mandatory',
  };
}
