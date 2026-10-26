import { checkDecisionBasis, type DecisionBasis } from './decisionBasisCheck.js';
import { databaseTimestamp } from './databaseTimestamp.js';
export type ValidationStatus = 'passed' | 'failed' | 'warning' | 'unknown';
export type ReleaseStatus = 'trusted' | 'blocked' | 'revoked' | 'superseded' | 'exception' | null;

export interface ReleaseExceptionApproval {
  approved: boolean;
  approvedBy?: string | null;
  reason?: string | null;
  evidence?: unknown;
  approvedAt?: string | null;
  scope?: string | null;
}

export interface ReleaseGateInput {
  latestValidationStatus: ValidationStatus | string | null | undefined;
  existingReleaseStatus: ReleaseStatus | string | null | undefined;
  hasReleaseCertificate: boolean;
  exceptionApproval?: ReleaseExceptionApproval | null;
  latestValidationId?: string | null;
  certificateValidationId?: string | null;
  /** Explicitly supplied T0/T1 basis. Never inferred from an ordinary release certificate. */
  semanticBasis?: { bound: DecisionBasis; current: DecisionBasis } | null;
  /** Require independently verified T0/T1 input for this evaluation. */
  requireSemanticBasis?: boolean;
}

export interface ReleaseGateDecision {
  effectiveStatus: ReleaseStatus;
  shouldTransition: boolean;
  reason: string;
  validationIsPassing: boolean;
  exceptionIsDocumented: boolean;
}

export interface ValidationRef {
  id?: string | null;
  status?: string | null;
  created_at?: string | null;
}

export interface ReleaseCertificateRef {
  validation_result_id?: string | null;
  certified_at?: string | null;
}

const PASSING = new Set(['passed', 'pass', 'success', 'validated', 'valid', 'approved']);
const PERSISTABLE_RELEASE_STATUSES = new Set<Exclude<ReleaseStatus, null>>([
  'trusted',
  'blocked',
  'revoked',
  'superseded',
  'exception',
]);

export function hasDocumentedException(exceptionApproval?: ReleaseExceptionApproval | null): boolean {
  if (!exceptionApproval?.approved) return false;
  return Boolean(
    exceptionApproval.approvedBy &&
      exceptionApproval.reason &&
      exceptionApproval.approvedAt &&
      exceptionApproval.scope,
  );
}

function latestByCreatedAt<T extends ValidationRef>(items: T[]): T | null {
  if (!items.length) return null;
  const unorderable = items.filter((item) => databaseTimestamp(item.created_at) === null);
  if (unorderable.length) return unorderable.find((item) => !PASSING.has(String(item.status ?? 'unknown').toLowerCase())) ?? null;
  const ordered = [...items].sort((a, b) => {
    const aTime = databaseTimestamp(a.created_at);
    const bTime = databaseTimestamp(b.created_at);
    const byTime = aTime === bTime ? 0 : aTime === null ? 1 : bTime === null ? -1 : aTime < bTime ? 1 : -1;
    if (byTime) return byTime;
    const aPasses = PASSING.has(String(a.status ?? 'unknown').toLowerCase());
    const bPasses = PASSING.has(String(b.status ?? 'unknown').toLowerCase());
    if (aPasses !== bPasses) return aPasses ? 1 : -1;
    return String(a.id ?? '').localeCompare(String(b.id ?? ''));
  });
  const latest = ordered[0];
  if (PASSING.has(String(latest.status ?? 'unknown').toLowerCase()) && ordered.length > 1
      && databaseTimestamp(latest.created_at) === databaseTimestamp(ordered[1].created_at)) return null;
  return latest;
}

/**
 * Selects the validation that is allowed to govern the current release state.
 *
 * Before a certificate exists, the latest validation is authoritative.
 * After release, the certificate's referenced validation is the baseline. Only a
 * validation that is provably newer than certified_at may replace that baseline.
 * Equal timestamps are deliberately not treated as newer because ordering would
 * be ambiguous and must never revoke a release by accident.
 */
export function selectAuthoritativeValidation<T extends ValidationRef>(
  validations: T[],
  certificate?: ReleaseCertificateRef | null,
): T | null {
  if (!validations.length) return null;
  if (!certificate) return latestByCreatedAt(validations);

  // An unorderable observation cannot be silently assumed to predate release.
  if (validations.some((item) => databaseTimestamp(item.created_at) === null))
    return latestByCreatedAt(validations);

  const certifiedValidation = certificate.validation_result_id
    ? validations.find((item) => item.id === certificate.validation_result_id) ?? null
    : null;

  const certifiedAt = databaseTimestamp(certificate.certified_at);
  if (certifiedAt === null || !certifiedValidation) return null;
  const provablyLater = validations.filter((item) => {
    const createdAt = databaseTimestamp(item.created_at);
    return createdAt !== null && createdAt > certifiedAt;
  });
  if (provablyLater.length) return latestByCreatedAt(provablyLater);

  return certifiedValidation;
}

export function decideReleaseGate(input: ReleaseGateInput): ReleaseGateDecision {
  const normalizedValidation = String(input.latestValidationStatus ?? 'unknown').toLowerCase();
  const rawCurrentStatus = String(input.existingReleaseStatus ?? '').toLowerCase();
  const currentStatus = PERSISTABLE_RELEASE_STATUSES.has(rawCurrentStatus as Exclude<ReleaseStatus, null>)
    ? rawCurrentStatus as Exclude<ReleaseStatus, null>
    : null;
  const validationIsPassing = PASSING.has(normalizedValidation);
  const exceptionIsDocumented = hasDocumentedException(input.exceptionApproval);

  // Preserve terminal identity before any current-basis assessment.
  if (input.hasReleaseCertificate && (currentStatus === 'revoked' || currentStatus === 'superseded')) {
    return {
      effectiveStatus: currentStatus,
      shouldTransition: false,
      reason: 'Terminal release status cannot be reactivated; a new certificate requires a fresh decision basis.',
      validationIsPassing,
      exceptionIsDocumented,
    };
  }

  // Fail closed for callers that explicitly require semantic verification.
  // This is a read-only assessment: it does not revoke historical certificates.
  if (input.requireSemanticBasis && !input.semanticBasis) {
    return {
      effectiveStatus: currentStatus === 'revoked' ? 'revoked' : 'blocked',
      shouldTransition: false,
      reason: 'Semantic decision basis is missing: BLOCKED_INCOMPLETE_EVIDENCE. A new review is required.',
      validationIsPassing,
      exceptionIsDocumented,
    };
  }

  // A supplied semantic basis is a mandatory pre-review gate, not a write permit.
  // Historical certificates and exception approvals cannot override a failed T1 check.
  if (input.semanticBasis) {
    const basisDecision = checkDecisionBasis(input.semanticBasis.bound, input.semanticBasis.current);
    if (basisDecision !== 'ELIGIBLE_FOR_NEXT_REVIEW') {
      return {
        effectiveStatus: currentStatus === 'revoked' ? 'revoked' : 'blocked',
        shouldTransition: false,
        reason: `Semantic decision basis is not current: ${basisDecision}. A new review is required.`,
        validationIsPassing,
        exceptionIsDocumented,
      };
    }
  }

  if (validationIsPassing && input.hasReleaseCertificate && input.latestValidationId !== undefined
    && (!input.latestValidationId || input.latestValidationId !== input.certificateValidationId)) {
    return {
      effectiveStatus: currentStatus === 'revoked' ? 'revoked' : 'superseded',
      shouldTransition: false,
      reason: 'The current validation is not the certified validation; a new review and explicit release are required.',
      validationIsPassing,
      exceptionIsDocumented,
    };
  }

  if (validationIsPassing) {
    const effectiveStatus: ReleaseStatus = input.hasReleaseCertificate
      ? (currentStatus === 'revoked' || currentStatus === 'superseded' ? currentStatus : 'trusted')
      : null;
    return {
      effectiveStatus,
      shouldTransition: currentStatus === 'blocked',
      reason: 'Latest authoritative validation is passing.',
      validationIsPassing,
      exceptionIsDocumented,
    };
  }

  if (exceptionIsDocumented) {
    return {
      effectiveStatus: 'exception',
      shouldTransition: currentStatus !== 'exception',
      reason: 'Latest authoritative validation is negative, but a complete explicit exception approval is documented.',
      validationIsPassing,
      exceptionIsDocumented,
    };
  }

  if (input.hasReleaseCertificate) {
    return {
      effectiveStatus: 'revoked',
      shouldTransition: currentStatus !== 'revoked',
      reason: 'Latest authoritative validation is negative after release; release must be revoked.',
      validationIsPassing,
      exceptionIsDocumented,
    };
  }

  return {
    effectiveStatus: 'blocked',
    shouldTransition: currentStatus !== 'blocked',
    reason: 'Latest authoritative validation is negative before release; release is blocked.',
    validationIsPassing,
    exceptionIsDocumented,
  };
}
