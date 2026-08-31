export type ContextCompletenessStatus = 'complete' | 'partial' | 'unavailable';

export interface ContextSourceObservation {
  source_key: string;
  required?: boolean;
  available: boolean;
  error_code?: string | null;
}

export interface ContextCompletenessTruth {
  status: ContextCompletenessStatus;
  expected_source_keys: string[];
  available_source_keys: string[];
  missing_required_source_keys: string[];
  unavailable_optional_source_keys: string[];
  complete_for_action: boolean;
  reason: string;
}

function cleanKey(value: string): string {
  const key = value.trim();
  if (!key) throw new Error('source_key is required');
  return key;
}

/**
 * Derives explicit completeness for a context assembled from multiple sources.
 * Missing required sources must never be silently represented as a complete
 * context. Optional-source failures remain visible but do not by themselves make
 * the context incomplete for action.
 */
export function deriveContextCompleteness(
  observations: ContextSourceObservation[],
): ContextCompletenessTruth {
  if (observations.length === 0) {
    return {
      status: 'unavailable',
      expected_source_keys: [],
      available_source_keys: [],
      missing_required_source_keys: [],
      unavailable_optional_source_keys: [],
      complete_for_action: false,
      reason: 'No source observations were supplied; context completeness cannot be proven.',
    };
  }

  const seen = new Set<string>();
  const normalized = observations.map((observation) => {
    const sourceKey = cleanKey(observation.source_key);
    if (seen.has(sourceKey)) throw new Error(`duplicate source_key: ${sourceKey}`);
    seen.add(sourceKey);
    return {
      source_key: sourceKey,
      required: observation.required !== false,
      available: observation.available,
      error_code: observation.error_code ?? null,
    };
  });

  const expected = normalized.map((item) => item.source_key);
  const available = normalized.filter((item) => item.available).map((item) => item.source_key);
  const missingRequired = normalized
    .filter((item) => item.required && !item.available)
    .map((item) => item.source_key);
  const unavailableOptional = normalized
    .filter((item) => !item.required && !item.available)
    .map((item) => item.source_key);

  if (available.length === 0) {
    return {
      status: 'unavailable',
      expected_source_keys: expected,
      available_source_keys: available,
      missing_required_source_keys: missingRequired,
      unavailable_optional_source_keys: unavailableOptional,
      complete_for_action: false,
      reason: 'No expected context source is currently available.',
    };
  }

  if (missingRequired.length > 0) {
    return {
      status: 'partial',
      expected_source_keys: expected,
      available_source_keys: available,
      missing_required_source_keys: missingRequired,
      unavailable_optional_source_keys: unavailableOptional,
      complete_for_action: false,
      reason: `Context is partial because required sources are missing: ${missingRequired.join(', ')}.`,
    };
  }

  return {
    status: 'complete',
    expected_source_keys: expected,
    available_source_keys: available,
    missing_required_source_keys: [],
    unavailable_optional_source_keys: unavailableOptional,
    complete_for_action: true,
    reason: unavailableOptional.length > 0
      ? `All required sources are available; optional sources unavailable: ${unavailableOptional.join(', ')}.`
      : 'All expected required context sources are available.',
  };
}
