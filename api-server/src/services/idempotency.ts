import { createHash } from 'node:crypto';

export interface IdempotencyKeyInput {
  intent_id: string;
  operation: string;
}

export interface SourcePrecondition {
  source_system: string;
  source_reference: string;
  source_hash: string;
  schema_version?: string | null;
}

function required(name: string, value: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${name} is required`);
  return trimmed;
}

/**
 * Produces a deterministic retry key from the stable client/business intent.
 *
 * Source state is deliberately excluded: the same intent must keep the same
 * idempotency identity even when the source changes between attempts.
 */
export function createIdempotencyKey(input: IdempotencyKeyInput): string {
  const canonical = JSON.stringify({
    intent_id: required('intent_id', input.intent_id),
    operation: required('operation', input.operation),
  });

  return `pp_${createHash('sha256').update(canonical).digest('hex')}`;
}

/**
 * Creates a separate precondition token for the exact source state an operation
 * was validated against. This token is not the idempotency identity.
 */
export function createSourcePreconditionToken(input: SourcePrecondition): string {
  const canonical = JSON.stringify({
    source_system: required('source_system', input.source_system),
    source_reference: required('source_reference', input.source_reference),
    source_hash: required('source_hash', input.source_hash),
    schema_version: input.schema_version?.trim() || null,
  });

  return `src_${createHash('sha256').update(canonical).digest('hex')}`;
}

/**
 * Checks whether the source state observed immediately before execution is the
 * same state that policy/review validated earlier. A mismatch requires
 * revalidation; it must never be silently accepted.
 */
export function sourcePreconditionMatches(
  expected: SourcePrecondition,
  current: SourcePrecondition,
): boolean {
  return createSourcePreconditionToken(expected) === createSourcePreconditionToken(current);
}
