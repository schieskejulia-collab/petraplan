export interface ResolutionRef {
  id?: string | null;
  conflict_id?: string | null;
  created_at?: string | null;
}

export interface ValidationRef {
  id?: string | null;
  conflict_id?: string | null;
  resolution_id?: string | null;
  created_at?: string | null;
}

export interface TruthOrderDecision {
  valid: boolean;
  reason: string;
  missing: string[];
}

/**
 * Guard the causal order of Resolution Truth -> Validation Truth.
 *
 * Validation must not float independently from the resolution it claims to
 * validate. Missing references or evidence are treated as unknown/invalid,
 * never inferred as safe.
 */
export function validateResolutionBeforeValidation(
  resolution: ResolutionRef | null | undefined,
  validation: ValidationRef | null | undefined,
): TruthOrderDecision {
  const missing: string[] = [];

  if (!resolution?.id) missing.push('resolution_id');
  if (!validation?.id) missing.push('validation_id');
  if (!resolution?.conflict_id) missing.push('resolution_conflict_id');
  if (!validation?.conflict_id) missing.push('validation_conflict_id');
  if (!validation?.resolution_id) missing.push('validation_resolution_reference');
  if (!resolution?.created_at) missing.push('resolution_created_at');
  if (!validation?.created_at) missing.push('validation_created_at');

  if (
    resolution?.id &&
    validation?.resolution_id &&
    validation.resolution_id !== resolution.id
  ) {
    missing.push('resolution_reference_match');
  }

  if (
    resolution?.conflict_id &&
    validation?.conflict_id &&
    validation.conflict_id !== resolution.conflict_id
  ) {
    missing.push('conflict_reference_match');
  }

  if (
    resolution?.created_at &&
    validation?.created_at &&
    validation.created_at < resolution.created_at
  ) {
    missing.push('validation_after_resolution');
  }

  const valid = missing.length === 0;

  return {
    valid,
    reason: valid
      ? 'Validation is causally anchored to the resolution it validates.'
      : 'Validation is not sufficiently anchored to a prior resolution; ordering must not be inferred.',
    missing,
  };
}
