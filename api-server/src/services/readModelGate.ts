import { deriveContextFreshness, type ContextProvenanceInput } from './contextFreshness.js';

export type ReadIntent = 'context' | 'decision_support' | 'critical_action';
export type ReadSource = 'read_model' | 'source';

export interface ReadModelGateInput {
  intent: ReadIntent;
  readModelAvailable: boolean;
  sourceAvailable: boolean;
  readModelContext?: ContextProvenanceInput | null;
  sourceRevalidationRequired?: boolean;
}

export interface ReadModelGateDecision {
  allowed: boolean;
  source: ReadSource | null;
  requires_source_revalidation: boolean;
  read_model_safe: boolean;
  reason: string;
}

/**
 * Chooses a safe read path without ever treating a cache/read-model as Source Truth.
 *
 * Rules:
 * - Context/decision-support reads may use the read model only when freshness and
 *   provenance are explicitly proven.
 * - Critical actions always require source revalidation before execution.
 * - A stale/unknown read model may never silently fall back to "good enough".
 * - If neither a safe read model nor the source is available, the read is blocked.
 */
export function decideReadPath(input: ReadModelGateInput, now: string | Date = new Date()): ReadModelGateDecision {
  const readModelTruth = input.readModelContext
    ? deriveContextFreshness(input.readModelContext, now)
    : null;
  const readModelSafe = Boolean(readModelTruth?.safe_for_action);

  if (input.intent === 'critical_action') {
    if (!input.sourceAvailable) {
      return {
        allowed: false,
        source: null,
        requires_source_revalidation: true,
        read_model_safe: readModelSafe,
        reason: 'Critical action requires direct source revalidation, but the source is unavailable.',
      };
    }

    return {
      allowed: true,
      source: 'source',
      requires_source_revalidation: true,
      read_model_safe: readModelSafe,
      reason: 'Critical action must be revalidated against Source Truth before execution.',
    };
  }

  if (input.sourceRevalidationRequired === true) {
    if (!input.sourceAvailable) {
      return {
        allowed: false,
        source: null,
        requires_source_revalidation: true,
        read_model_safe: readModelSafe,
        reason: 'Policy requires source revalidation, but the source is unavailable.',
      };
    }

    return {
      allowed: true,
      source: 'source',
      requires_source_revalidation: true,
      read_model_safe: readModelSafe,
      reason: 'Policy requires a fresh read from Source Truth.',
    };
  }

  if (input.readModelAvailable && readModelSafe) {
    return {
      allowed: true,
      source: 'read_model',
      requires_source_revalidation: false,
      read_model_safe: true,
      reason: 'Read model may serve this read because freshness and provenance are explicitly proven.',
    };
  }

  if (input.sourceAvailable) {
    return {
      allowed: true,
      source: 'source',
      requires_source_revalidation: true,
      read_model_safe: readModelSafe,
      reason: readModelTruth
        ? `Read model is not action-safe (${readModelTruth.status}); read from Source Truth instead.`
        : 'No proven read-model context is available; read from Source Truth instead.',
    };
  }

  return {
    allowed: false,
    source: null,
    requires_source_revalidation: false,
    read_model_safe: readModelSafe,
    reason: 'Neither a proven current read model nor Source Truth is available.',
  };
}
