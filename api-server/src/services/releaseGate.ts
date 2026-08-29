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

export function hasDocumentedException(exceptionApproval?: ReleaseExceptionApproval | null): boolean {
  if (!exceptionApproval?.approved) return false;
  return Boolean(
    exceptionApproval.approvedBy &&
      exceptionApproval.reason &&
      exceptionApproval.approvedAt &&
      exceptionApproval.scope,
  );
}

function latestByCreatedAt<T extends { created_at?: string | null }>(items: T[]): T | null {
  if (!items.length) return null;
  return [...items].sort((a, b) => String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')))[0] ?? null;
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

  const certifiedValidation = certificate.validation_result_id
    ? validations.find((item) => item.id === certificate.validation_result_id) ?? null
    : null;

  if (certificate.certified_at) {
    const provablyLater = validations.filter(
      (item) => item.created_at && String(item.created_at) > String(certificate.certified_at),
    );
    const laterValidation = latestByCreatedAt(provablyLater);
    if (laterValidation) return laterValidation;
  }

  return certifiedValidation ?? latestByCreatedAt(validations);
}

export function decideReleaseGate(input: ReleaseGateInput): ReleaseGateDecision {
  const normalizedValidation = String(input.latestValidationStatus ?? 'unknown').toLowerCase();
  const currentStatus = (input.existingReleaseStatus ?? null) as ReleaseStatus;
  const validationIsPassing = PASSING.has(normalizedValidation);
  const exceptionIsDocumented = hasDocumentedException(input.exceptionApproval);

  if (validationIsPassing) {
    return {
      effectiveStatus: currentStatus ?? (input.hasReleaseCertificate ? 'trusted' : null),
      shouldTransition: false,
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
