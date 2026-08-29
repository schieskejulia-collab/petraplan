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
