import { createHash } from 'node:crypto';

export type RevalidationAction = 'lead' | 'join' | 'backoff' | 'block';

export interface RevalidationGuardInput {
  source_system: string;
  source_reference: string;
  source_available: boolean;
  in_flight_for_key: boolean;
  source_in_flight_count: number;
  max_source_concurrency: number;
  retry_after_ms?: number | null;
}

export interface RevalidationDecision {
  action: RevalidationAction;
  revalidation_key: string;
  should_hit_source: boolean;
  should_wait_for_existing: boolean;
  retry_after_ms: number | null;
  reason: string;
}

function required(name: string, value: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${name} is required`);
  return normalized;
}

/**
 * Stable key for one logical source record. Requests for the same source record
 * must converge on the same key so only one caller becomes the source reader.
 */
export function createRevalidationKey(sourceSystem: string, sourceReference: string): string {
  const canonical = JSON.stringify({
    source_system: required('source_system', sourceSystem),
    source_reference: required('source_reference', sourceReference),
  });
  return `rv_${createHash('sha256').update(canonical).digest('hex')}`;
}

/**
 * Decides whether a caller may revalidate against Source Truth.
 *
 * - Same-key requests coalesce: one leader hits the source, followers join/wait.
 * - Source-wide concurrency is capped before starting another source read.
 * - Backoff is explicit; no hidden retry timing is invented here.
 * - Source unavailability fails closed.
 */
export function decideRevalidation(input: RevalidationGuardInput): RevalidationDecision {
  const key = createRevalidationKey(input.source_system, input.source_reference);

  if (!Number.isInteger(input.source_in_flight_count) || input.source_in_flight_count < 0) {
    throw new Error('source_in_flight_count must be a non-negative integer');
  }
  if (!Number.isInteger(input.max_source_concurrency) || input.max_source_concurrency < 1) {
    throw new Error('max_source_concurrency must be an integer >= 1');
  }
  if (input.retry_after_ms != null && (!Number.isFinite(input.retry_after_ms) || input.retry_after_ms < 0)) {
    throw new Error('retry_after_ms must be a non-negative number when provided');
  }

  if (!input.source_available) {
    return {
      action: 'block',
      revalidation_key: key,
      should_hit_source: false,
      should_wait_for_existing: false,
      retry_after_ms: input.retry_after_ms ?? null,
      reason: 'Source Truth is unavailable; revalidation is blocked rather than guessed.',
    };
  }

  if (input.in_flight_for_key) {
    return {
      action: 'join',
      revalidation_key: key,
      should_hit_source: false,
      should_wait_for_existing: true,
      retry_after_ms: null,
      reason: 'A revalidation for this source record is already in flight; join the existing result instead of hitting the source again.',
    };
  }

  if (input.source_in_flight_count >= input.max_source_concurrency) {
    return {
      action: 'backoff',
      revalidation_key: key,
      should_hit_source: false,
      should_wait_for_existing: false,
      retry_after_ms: input.retry_after_ms ?? null,
      reason: 'Source revalidation concurrency limit is reached; caller must back off instead of increasing legacy load.',
    };
  }

  return {
    action: 'lead',
    revalidation_key: key,
    should_hit_source: true,
    should_wait_for_existing: false,
    retry_after_ms: null,
    reason: 'Caller may become the single-flight leader and perform one guarded revalidation against Source Truth.',
  };
}
