import test from 'node:test';
import assert from 'node:assert/strict';
import { claimIdempotentExecution } from './idempotencyClaim.js';

const expiresAt = '2030-01-01T00:00:00.000Z';

test('new claim returns database execution identity', async () => {
  let rpcName = '';
  let rpcArgs: Record<string, unknown> = {};
  const client = {
    async rpc(name: string, args: Record<string, unknown>) {
      rpcName = name;
      rpcArgs = args;
      return {
        data: [{
          claimed: true,
          execution_id: '11111111-1111-1111-1111-111111111111',
          status: 'in_flight',
          response_snapshot: null,
          error_snapshot: null,
        }],
        error: null,
      };
    },
  };

  const result = await claimIdempotentExecution(client, {
    intent_id: 'intent-4711',
    operation: 'write-customer',
    expires_at: expiresAt,
  });

  assert.equal(rpcName, 'claim_idempotent_execution');
  assert.equal(rpcArgs.p_intent_id, 'intent-4711');
  assert.equal(rpcArgs.p_operation, 'write-customer');
  assert.match(String(rpcArgs.p_idempotency_key), /^pp_[a-f0-9]{64}$/);
  assert.equal(result.claimed, true);
  assert.equal(result.execution_id, '11111111-1111-1111-1111-111111111111');
});

test('duplicate delivery preserves execution identity and is not owner', async () => {
  const client = {
    async rpc() {
      return {
        data: [{
          claimed: false,
          execution_id: '22222222-2222-2222-2222-222222222222',
          status: 'in_flight',
          response_snapshot: null,
          error_snapshot: null,
        }],
        error: null,
      };
    },
  };

  const result = await claimIdempotentExecution(client, {
    intent_id: 'same-intent',
    operation: 'same-operation',
    expires_at: expiresAt,
  });

  assert.equal(result.claimed, false);
  assert.equal(result.execution_id, '22222222-2222-2222-2222-222222222222');
});

test('RPC errors fail closed', async () => {
  const client = {
    async rpc() {
      return { data: null, error: { message: 'database unavailable' } };
    },
  };

  await assert.rejects(
    claimIdempotentExecution(client, {
      intent_id: 'intent',
      operation: 'operation',
      expires_at: expiresAt,
    }),
    /idempotency claim failed: database unavailable/,
  );
});

test('invalid expiry is rejected before touching the database', async () => {
  let called = false;
  const client = {
    async rpc() {
      called = true;
      return { data: null, error: null };
    },
  };

  await assert.rejects(
    claimIdempotentExecution(client, {
      intent_id: 'intent',
      operation: 'operation',
      expires_at: 'not-a-date',
    }),
    /expires_at must be a valid timestamp/,
  );
  assert.equal(called, false);
});
