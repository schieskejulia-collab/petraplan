export interface IdempotencySmokeRequestInput {
  intent_id: string;
  operation: string;
  expires_at: string;
  now?: Date;
}

export interface IdempotencySmokeRequest {
  intent_id: string;
  operation: 'idempotency-smoke';
  expires_at: string;
}

const MAX_LIFETIME_MS = 15 * 60 * 1000;

export function validateIdempotencySmokeRequest(
  input: IdempotencySmokeRequestInput,
): IdempotencySmokeRequest {
  const intentId = input.intent_id.trim();
  const operation = input.operation.trim();
  const expiresAt = input.expires_at.trim();
  const now = input.now ?? new Date();

  if (!intentId.startsWith('petraplan-runtime-')) {
    throw new Error('intent_id must use the petraplan-runtime- test namespace');
  }

  if (operation !== 'idempotency-smoke') {
    throw new Error('operation must be idempotency-smoke');
  }

  const expiresMs = Date.parse(expiresAt);
  if (Number.isNaN(expiresMs)) {
    throw new Error('expires_at must be a valid timestamp');
  }

  const nowMs = now.getTime();
  if (expiresMs <= nowMs) {
    throw new Error('expires_at must be in the future');
  }

  if (expiresMs - nowMs > MAX_LIFETIME_MS) {
    throw new Error('expires_at must be within 15 minutes');
  }

  return {
    intent_id: intentId,
    operation: 'idempotency-smoke',
    expires_at: new Date(expiresMs).toISOString(),
  };
}
