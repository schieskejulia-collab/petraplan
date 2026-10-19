/**
 * Read-only, fail-closed projection of claims already attached to a case.
 * This does not confirm claims, validate evidence, or grant release authority.
 */
export type AddressClaimReadInput = {
  address: string;
  recordId: string;
  snapshotId?: string | null;
  at?: string | null;
  claims: Array<Record<string, any>>;
  evidenceLinks: Array<Record<string, any>>;
  effectiveReleaseStatus?: string | null;
  authoritativeValidationId?: string | null;
  certificateValidationId?: string | null;
};

function instant(value: unknown): number | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const n = Date.parse(value);
  return Number.isFinite(n) ? n : null;
}

export function buildAddressClaimReadModel(input: AddressClaimReadInput) {
  const at = instant(input.at ?? new Date().toISOString());
  const address = String(input.address ?? '').trim();
  const recordId = String(input.recordId ?? '').trim();
  const scopeKnown = Boolean(address && recordId && at !== null);
  const releaseCurrent = input.effectiveReleaseStatus === 'trusted'
    && Boolean(input.authoritativeValidationId)
    && input.authoritativeValidationId === input.certificateValidationId;
  const allClaims = (input.claims ?? []).filter(c =>
    c.subject_address === address && c.record_id === recordId
  );
  const claims = allClaims.map(claim => {
    const scope = claim.scope_payload && typeof claim.scope_payload === 'object' && !Array.isArray(claim.scope_payload)
      ? claim.scope_payload : {};
    const scopeMatches = claim.scope_type === 'CASE_ONLY'
      && scope.record_id === recordId
      && Boolean(input.snapshotId)
      && scope.snapshot_id === input.snapshotId
      && claim.snapshot_id === input.snapshotId;
    const start = claim.valid_from == null ? null : instant(claim.valid_from);
    const end = claim.valid_to == null ? null : instant(claim.valid_to);
    const validTime = at !== null
      && (claim.valid_from == null || (start !== null && at >= start))
      && (claim.valid_to == null || (end !== null && at <= end));
    const evidence = (input.evidenceLinks ?? []).filter(e => e.claim_id === claim.id);
    const supporting = evidence.some(e => e.relation === 'SUPPORTS' || e.relation === 'DERIVED_FROM');
    const contradictory = evidence.some(e => e.relation === 'CONTRADICTS');
    const confirmed = claim.status === 'CONFIRMED'
      && Boolean(claim.confirmed_by && instant(claim.confirmed_at));
    const usable = scopeKnown && scopeMatches && validTime && confirmed
      && supporting && !contradictory && releaseCurrent;
    const blockers = [
      ...(!scopeMatches ? ['SCOPE_UNVERIFIED'] : []),
      ...(!validTime ? ['TIME_UNVERIFIED'] : []),
      ...(!confirmed ? ['CLAIM_NOT_CONFIRMED'] : []),
      ...(!supporting ? ['EVIDENCE_NOT_LINKED'] : []),
      ...(contradictory ? ['CONTRADICTORY_EVIDENCE'] : []),
      ...(!releaseCurrent ? ['CURRENT_RELEASE_NOT_VERIFIED'] : []),
    ];
    return {
      id: claim.id,
      subject_address: address,
      statement: claim.statement,
      predicate: claim.predicate,
      object_value: claim.object_value,
      status: claim.status,
      scope_type: claim.scope_type,
      valid_from: claim.valid_from ?? null,
      valid_to: claim.valid_to ?? null,
      evidence_links: evidence,
      classification: usable ? 'CURRENTLY_USABLE' : confirmed ? 'CONFIRMED_NOT_CURRENTLY_USABLE' : 'UNCONFIRMED',
      blockers,
    };
  });
  return {
    mode: 'READ_ONLY_NO_AUTHORITY',
    address, record_id: recordId, snapshot_id: input.snapshotId ?? null,
    evaluated_at: input.at ?? null,
    current_release_verified: releaseCurrent,
    claims,
    status: !scopeKnown ? 'BLOCKED' : claims.some(c => c.classification === 'CURRENTLY_USABLE')
      ? 'HAS_USABLE_CLAIMS' : 'NO_CURRENTLY_USABLE_CLAIMS',
    guard_rails: ['No source writes', 'No implicit semantic confirmation', 'Missing scope/evidence/release fails closed'],
  };
}
