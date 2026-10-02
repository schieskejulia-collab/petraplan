export type ClaimFreshnessInput = {
  id?: unknown;
  created_at?: unknown;
  status?: unknown;
  subject_address?: unknown;
};

const ACTIVE_CLAIM_STATUSES = new Set(['UNPROVEN', 'SUPPORTED', 'CONFIRMED', 'CONTESTED']);

function time(value: unknown) {
  const parsed = Date.parse(String(value ?? ''));
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * A later claim does not rewrite an earlier validation. It only makes that
 * validation insufficient as the current basis for a new Review/Release.
 */
export function claimsAfterValidation(claims: ClaimFreshnessInput[], validation: any) {
  const validationTime = time(validation?.created_at ?? validation?.validated_at ?? validation?.updated_at);
  if (validationTime === null) return [];

  return claims.filter((claim) => {
    if (!ACTIVE_CLAIM_STATUSES.has(String(claim.status ?? '').toUpperCase())) return false;
    const claimTime = time(claim.created_at);
    return claimTime !== null && claimTime > validationTime;
  });
}

export function claimFreshnessBlockers(claims: ClaimFreshnessInput[], validation: any) {
  const laterClaims = claimsAfterValidation(claims, validation);
  if (!laterClaims.length) return [];
  return [
    `${laterClaims.length} relevante${laterClaims.length === 1 ? 'r Claim ist' : ' Claims sind'} nach der maßgeblichen Validierung entstanden. Neuvalidierung ist erforderlich.`,
  ];
}
