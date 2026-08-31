export type SemanticDriftStatus = 'compatible' | 'drift_detected' | 'unknown';

export interface SemanticMeaningEvidence {
  semantic_id?: string | null;
  meaning_version?: string | null;
  value_type?: string | null;
  unit?: string | null;
  code_system?: string | null;
  allowed_values?: string[] | null;
  invariant_hash?: string | null;
}

export interface SemanticDriftDecision {
  status: SemanticDriftStatus;
  compatibleForAction: boolean;
  reason: string;
  differences: string[];
  missing: string[];
}

function normalizedValues(values?: string[] | null): string[] | null {
  if (!values) return null;
  return [...values].map(String).sort();
}

/**
 * Detects meaning changes that schema/version checks alone cannot prove safe.
 * A field may retain the same name and technical type while its business meaning,
 * unit, code system, domain, or invariant changes. Missing semantic evidence is
 * never treated as compatibility.
 */
export function detectSemanticDrift(
  expected: SemanticMeaningEvidence | null | undefined,
  observed: SemanticMeaningEvidence | null | undefined,
): SemanticDriftDecision {
  const missing: string[] = [];
  const differences: string[] = [];

  if (!expected?.semantic_id) missing.push('expected_semantic_id');
  if (!expected?.meaning_version) missing.push('expected_meaning_version');
  if (!observed?.semantic_id) missing.push('observed_semantic_id');
  if (!observed?.meaning_version) missing.push('observed_meaning_version');

  if (missing.length > 0) {
    return {
      status: 'unknown',
      compatibleForAction: false,
      reason: 'Semantic compatibility cannot be proven because required meaning evidence is missing.',
      differences,
      missing,
    };
  }

  if (expected!.semantic_id !== observed!.semantic_id) differences.push('semantic_id');
  if (expected!.meaning_version !== observed!.meaning_version) differences.push('meaning_version');

  const comparable: Array<keyof SemanticMeaningEvidence> = [
    'value_type',
    'unit',
    'code_system',
    'invariant_hash',
  ];

  for (const key of comparable) {
    const a = expected?.[key] ?? null;
    const b = observed?.[key] ?? null;
    if (a !== b) differences.push(String(key));
  }

  const expectedValues = normalizedValues(expected?.allowed_values);
  const observedValues = normalizedValues(observed?.allowed_values);
  if (JSON.stringify(expectedValues) !== JSON.stringify(observedValues)) {
    differences.push('allowed_values');
  }

  if (differences.length > 0) {
    return {
      status: 'drift_detected',
      compatibleForAction: false,
      reason: 'Business meaning changed even though the technical schema may still look compatible.',
      differences,
      missing,
    };
  }

  return {
    status: 'compatible',
    compatibleForAction: true,
    reason: 'Observed meaning matches the explicitly expected semantic evidence.',
    differences,
    missing,
  };
}
