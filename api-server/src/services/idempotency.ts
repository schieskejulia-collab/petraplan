import { createHash } from 'node:crypto';

export interface IdempotencyKeyInput {
  operation: string;
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
 * Produces a deterministic key for one logical operation against one exact source
 * state. Retries with the same source hash and contract resolve to the same key;
 * a changed source state or schema version produces a different key.
 */
export function createIdempotencyKey(input: IdempotencyKeyInput): string {
  const canonical = JSON.stringify({
    operation: required('operation', input.operation),
    source_system: required('source_system', input.source_system),
    source_reference: required('source_reference', input.source_reference),
    source_hash: required('source_hash', input.source_hash),
    schema_version: input.schema_version?.trim() || null,
  });

  return `pp_${createHash('sha256').update(canonical).digest('hex')}`;
}
