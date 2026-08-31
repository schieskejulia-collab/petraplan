import { createIdempotencyKey } from './idempotency.js';

export interface IdempotencyClaimInput {
  intent_id: string;
  operation: string;
  expires_at: string;
  source_system?: string | null;
  source_reference?: string | null;
  source_hash?: string | null;
  source_schema_version?: string | null;
  source_precondition_token?: string | null;
}

export interface IdempotencyClaimResult {
  claimed: boolean;
  execution_id: string;
  status: string;
  response_snapshot: unknown;
  error_snapshot: unknown;
}

interface RpcClient {
  rpc(
    fn: string,
    args: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: { message?: string } | null }>;
}

function required(name: string, value: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${name} is required`);
  return trimmed;
}

function parseClaimRow(value: unknown): IdempotencyClaimResult {
  const row = Array.isArray(value) ? value[0] : value;
  if (!row || typeof row !== 'object') {
    throw new Error('claim_idempotent_execution returned no claim row');
  }

  const candidate = row as Record<string, unknown>;
  if (typeof candidate.claimed !== 'boolean') {
    throw new Error('claim_idempotent_execution returned invalid claimed flag');
  }
  if (typeof candidate.execution_id !== 'string' || !candidate.execution_id.trim()) {
    throw new Error('claim_idempotent_execution returned invalid execution_id');
  }
  if (typeof candidate.status !== 'string' || !candidate.status.trim()) {
    throw new Error('claim_idempotent_execution returned invalid status');
  }

  return {
    claimed: candidate.claimed,
    execution_id: candidate.execution_id,
    status: candidate.status,
    response_snapshot: candidate.response_snapshot ?? null,
    error_snapshot: candidate.error_snapshot ?? null,
  };
}

/**
 * Claims one logical execution through the database RPC.
 *
 * The RPC is the concurrency boundary: the application does not perform a
 * SELECT-before-INSERT check. Any external/legacy side effect must happen only
 * after this function returns claimed=true and outside the short claim transaction.
 */
export async function claimIdempotentExecution(
  client: RpcClient,
  input: IdempotencyClaimInput,
): Promise<IdempotencyClaimResult> {
  const intentId = required('intent_id', input.intent_id);
  const operation = required('operation', input.operation);
  const expiresAt = required('expires_at', input.expires_at);

  if (Number.isNaN(Date.parse(expiresAt))) {
    throw new Error('expires_at must be a valid timestamp');
  }

  const idempotencyKey = createIdempotencyKey({ intent_id: intentId, operation });
  const { data, error } = await client.rpc('claim_idempotent_execution', {
    p_intent_id: intentId,
    p_operation: operation,
    p_idempotency_key: idempotencyKey,
    p_expires_at: expiresAt,
    p_source_system: input.source_system ?? null,
    p_source_reference: input.source_reference ?? null,
    p_source_hash: input.source_hash ?? null,
    p_source_schema_version: input.source_schema_version ?? null,
    p_source_precondition_token: input.source_precondition_token ?? null,
  });

  if (error) {
    throw new Error(`idempotency claim failed: ${error.message ?? 'unknown RPC error'}`);
  }

  return parseClaimRow(data);
}
