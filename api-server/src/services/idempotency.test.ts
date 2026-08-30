import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createIdempotencyKey,
  createSourcePreconditionToken,
  sourcePreconditionMatches,
} from './idempotency.js';

const intent = {
  intent_id: 'intent-4711-update-customer',
  operation: 'write-customer',
};

const source = {
  source_system: 'sap-r3',
  source_reference: 'customer:4711',
  source_hash: 'sha256:abc',
  schema_version: 'customer-v1',
};

test('same client intent produces the same retry key', () => {
  assert.equal(createIdempotencyKey(intent), createIdempotencyKey({ ...intent }));
});

test('same intent keeps its idempotency identity when source state changes', () => {
  const before = createIdempotencyKey(intent);
  const after = createIdempotencyKey(intent);
  assert.equal(before, after);
});

test('different intent produces a different idempotency key', () => {
  assert.notEqual(
    createIdempotencyKey(intent),
    createIdempotencyKey({ ...intent, intent_id: 'intent-4711-second-update' }),
  );
});

test('source state is tracked independently as a precondition token', () => {
  assert.notEqual(
    createSourcePreconditionToken(source),
    createSourcePreconditionToken({ ...source, source_hash: 'sha256:def' }),
  );
});

test('source precondition rejects a changed source state', () => {
  assert.equal(sourcePreconditionMatches(source, { ...source }), true);
  assert.equal(sourcePreconditionMatches(source, { ...source, source_hash: 'sha256:def' }), false);
});

test('source precondition rejects contract drift', () => {
  assert.equal(sourcePreconditionMatches(source, { ...source, schema_version: 'customer-v2' }), false);
});

test('missing intent identity is rejected', () => {
  assert.throws(() => createIdempotencyKey({ ...intent, intent_id: ' ' }), /intent_id is required/);
});
