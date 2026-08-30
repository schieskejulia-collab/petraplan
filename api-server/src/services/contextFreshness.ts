export type FreshnessStatus = 'fresh' | 'stale' | 'not_yet_valid' | 'unknown';

export interface ContextProvenanceInput {
  source_system?: string | null;
  source_reference?: string | null;
  source_hash?: string | null;
  content_hash?: string | null;
  source_version?: string | null;
  schema_version?: string | null;
  observed_at?: string | null;
  retrieved_at?: string | null;
  valid_from?: string | null;
  valid_until?: string | null;
}

export interface ContextFreshnessTruth {
  status: FreshnessStatus;
  source_system: string | null;
  source_reference: string | null;
  content_hash: string | null;
  source_version: string | null;
  schema_version: string | null;
  observed_at: string | null;
  retrieved_at: string | null;
  valid_from: string | null;
  valid_until: string | null;
  age_ms: number | null;
  provenance_complete: boolean;
  freshness_complete: boolean;
  safe_for_action: boolean;
  missing: string[];
  reason: string;
}

function parseTime(value?: string | null): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Derives freshness and provenance without inventing missing metadata.
 *
 * A context is action-safe only when its provenance is explicit and its validity
 * window proves that it is current. Missing timestamps never become "fresh" by
 * assumption.
 */
export function deriveContextFreshness(
  input: ContextProvenanceInput,
  now: string | Date = new Date(),
): ContextFreshnessTruth {
  const nowMs = now instanceof Date ? now.getTime() : Date.parse(now);
  if (!Number.isFinite(nowMs)) throw new Error('now must be a valid timestamp');

  const contentHash = input.content_hash ?? input.source_hash ?? null;
  const observedMs = parseTime(input.observed_at);
  const retrievedMs = parseTime(input.retrieved_at);
  const validFromMs = parseTime(input.valid_from);
  const validUntilMs = parseTime(input.valid_until);

  const missing: string[] = [];
  if (!input.source_system) missing.push('source_system');
  if (!input.source_reference) missing.push('source_reference');
  if (!contentHash) missing.push('content_hash');
  if (!input.schema_version) missing.push('schema_version');
  if (observedMs === null) missing.push('observed_at');
  if (retrievedMs === null) missing.push('retrieved_at');
  if (validUntilMs === null) missing.push('valid_until');

  const provenanceComplete = Boolean(
    input.source_system &&
      input.source_reference &&
      contentHash &&
      input.schema_version &&
      observedMs !== null &&
      retrievedMs !== null,
  );

  const freshnessComplete = observedMs !== null && retrievedMs !== null && validUntilMs !== null;

  let status: FreshnessStatus = 'unknown';
  let reason = 'Freshness cannot be proven because required validity metadata is missing.';

  if (validFromMs !== null && nowMs < validFromMs) {
    status = 'not_yet_valid';
    reason = 'Context validity window has not started yet.';
  } else if (validUntilMs !== null && nowMs > validUntilMs) {
    status = 'stale';
    reason = 'Context validity window has expired.';
  } else if (freshnessComplete) {
    status = 'fresh';
    reason = 'Context is inside its explicit validity window.';
  }

  const ageMs = observedMs === null ? null : Math.max(0, nowMs - observedMs);
  const safeForAction = status === 'fresh' && provenanceComplete;

  return {
    status,
    source_system: input.source_system ?? null,
    source_reference: input.source_reference ?? null,
    content_hash: contentHash,
    source_version: input.source_version ?? null,
    schema_version: input.schema_version ?? null,
    observed_at: input.observed_at ?? null,
    retrieved_at: input.retrieved_at ?? null,
    valid_from: input.valid_from ?? null,
    valid_until: input.valid_until ?? null,
    age_ms: ageMs,
    provenance_complete: provenanceComplete,
    freshness_complete: freshnessComplete,
    safe_for_action: safeForAction,
    missing,
    reason,
  };
}
