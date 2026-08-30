export type SideEffectEvidence = 'none' | 'completed' | 'unknown';
export type RecoveryOutcome = 'completed' | 'retryable' | 'reconciliation_required';

export interface InFlightRecoveryInput {
  status: 'in_flight';
  heartbeat_at: string;
  stale_after_ms: number;
  side_effect_evidence: SideEffectEvidence;
  result_reconstructable?: boolean;
}

export interface InFlightRecoveryDecision {
  stale: boolean;
  outcome: RecoveryOutcome | null;
  retry_allowed: boolean;
  requires_reconciliation: boolean;
  reason: string;
}

function parseTime(name: string, value: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(`${name} must be a valid timestamp`);
  return parsed;
}

/**
 * Resolves a potentially abandoned in-flight idempotency record from evidence.
 *
 * A stale in_flight record is never itself permission to retry. First establish
 * whether the original attempt produced a side effect:
 * - proven completed side effect -> completed (reconstruct result if necessary)
 * - proven no side effect -> retryable
 * - uncertain side effect -> reconciliation_required
 */
export function decideInFlightRecovery(
  input: InFlightRecoveryInput,
  now: string | Date = new Date(),
): InFlightRecoveryDecision {
  if (!Number.isFinite(input.stale_after_ms) || input.stale_after_ms <= 0) {
    throw new Error('stale_after_ms must be greater than zero');
  }

  const heartbeatMs = parseTime('heartbeat_at', input.heartbeat_at);
  const nowMs = now instanceof Date ? now.getTime() : parseTime('now', now);
  if (!Number.isFinite(nowMs)) throw new Error('now must be a valid timestamp');

  const stale = nowMs - heartbeatMs > input.stale_after_ms;
  if (!stale) {
    return {
      stale: false,
      outcome: null,
      retry_allowed: false,
      requires_reconciliation: false,
      reason: 'The in-flight intent still has a current heartbeat; recovery must not take ownership yet.',
    };
  }

  if (input.side_effect_evidence === 'completed') {
    return {
      stale: true,
      outcome: 'completed',
      retry_allowed: false,
      requires_reconciliation: false,
      reason: input.result_reconstructable === false
        ? 'The side effect is proven complete, but the response must be reconstructed before closing the intent.'
        : 'The side effect is proven complete; mark the intent completed and never repeat it.',
    };
  }

  if (input.side_effect_evidence === 'none') {
    return {
      stale: true,
      outcome: 'retryable',
      retry_allowed: true,
      requires_reconciliation: false,
      reason: 'No side effect is proven to have occurred; the same intent may be retried under policy.',
    };
  }

  return {
    stale: true,
    outcome: 'reconciliation_required',
    retry_allowed: false,
    requires_reconciliation: true,
    reason: 'Whether the original attempt produced a side effect is unknown; automatic retry is unsafe.',
  };
}
