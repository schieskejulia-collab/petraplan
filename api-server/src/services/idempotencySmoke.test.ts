import test from 'node:test';
import assert from 'node:assert/strict';
import { validateIdempotencySmokeRequest } from './idempotencySmoke.js';

const now = new Date('2026-08-31T20:00:00.000Z');

function valid(overrides: Partial<Parameters<typeof validateIdempotencySmokeRequest>[0]> = {}) {
  return {
    intent_id: 'petraplan-runtime-123',
    operation: 'idempotency-smoke',
    expires_at: '2026-08-31T20:10:00.000Z',
    now,
    ...overrides,
  };
}

test('accepts only the dedicated runtime smoke namespace', () => {
  assert.deepEqual(validateIdempotencySmokeRequest(valid()), {
    intent_id: 'petraplan-runtime-123',
    operation: 'idempotency-smoke',
    expires_at: '2026-08-31T20:10:00.000Z',
  });

  assert.throws(
    () => validateIdempotencySmokeRequest(valid({ intent_id: 'customer-write-123' })),
    /test namespace/,
  );
});

test('rejects arbitrary operations so the endpoint cannot become a business command path', () => {
  assert.throws(
    () => validateIdempotencySmokeRequest(valid({ operation: 'write-customer' })),
    /operation must be idempotency-smoke/,
  );
});

test('rejects expired claims', () => {
  assert.throws(
    () => validateIdempotencySmokeRequest(valid({ expires_at: '2026-08-31T19:59:59.000Z' })),
    /must be in the future/,
  );
});

test('rejects claims that live longer than the bounded smoke-test window', () => {
  assert.throws(
    () => validateIdempotencySmokeRequest(valid({ expires_at: '2026-08-31T20:15:00.001Z' })),
    /within 15 minutes/,
  );
});

test('rejects malformed expiry timestamps', () => {
  assert.throws(
    () => validateIdempotencySmokeRequest(valid({ expires_at: 'not-a-date' })),
    /valid timestamp/,
  );
});
