import test from 'node:test';
import assert from 'node:assert/strict';
import { createIdempotencyKey } from './idempotency.js';

const base = {
  operation: 'write-customer',
  source_system: 'sap-r3',
  source_reference: 'customer:4711',
  source_hash: 'sha256:abc',
  schema_version: 'customer-v1',
};

test('same logical operation and source state produce the same retry key', () => {
  assert.equal(createIdempotencyKey(base), createIdempotencyKey({ ...base }));
});

test('changed source state produces a different key', () => {
  assert.notEqual(
    createIdempotencyKey(base),
    createIdempotencyKey({ ...base, source_hash: 'sha256:def' }),
  );
});

test('changed schema contract produces a different key', () => {
  assert.notEqual(
    createIdempotencyKey(base),
    createIdempotencyKey({ ...base, schema_version: 'customer-v2' }),
  );
});

test('missing identity fields are rejected', () => {
  assert.throws(() => createIdempotencyKey({ ...base, source_reference: ' ' }), /source_reference is required/);
});
