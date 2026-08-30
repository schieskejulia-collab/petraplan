import test from 'node:test';
import assert from 'node:assert/strict';
import { createRevalidationKey, decideRevalidation } from './revalidationGuard.js';

const base = {
  source_system: 'sap-r3',
  source_reference: 'customer:4711',
  source_available: true,
  in_flight_for_key: false,
  source_in_flight_count: 0,
  max_source_concurrency: 4,
};

test('same source record produces same single-flight key', () => {
  assert.equal(
    createRevalidationKey('sap-r3', 'customer:4711'),
    createRevalidationKey('sap-r3', 'customer:4711'),
  );
});

test('first caller becomes leader and may hit source', () => {
  const decision = decideRevalidation(base);
  assert.equal(decision.action, 'lead');
  assert.equal(decision.should_hit_source, true);
});

test('same-key follower joins existing revalidation instead of hitting source', () => {
  const decision = decideRevalidation({ ...base, in_flight_for_key: true });
  assert.equal(decision.action, 'join');
  assert.equal(decision.should_hit_source, false);
  assert.equal(decision.should_wait_for_existing, true);
});

test('source-wide concurrency limit causes explicit backoff', () => {
  const decision = decideRevalidation({
    ...base,
    source_in_flight_count: 4,
    retry_after_ms: 750,
  });
  assert.equal(decision.action, 'backoff');
  assert.equal(decision.should_hit_source, false);
  assert.equal(decision.retry_after_ms, 750);
});

test('unavailable source fails closed', () => {
  const decision = decideRevalidation({ ...base, source_available: false });
  assert.equal(decision.action, 'block');
  assert.equal(decision.should_hit_source, false);
});

test('invalid concurrency policy is rejected instead of guessed', () => {
  assert.throws(
    () => decideRevalidation({ ...base, max_source_concurrency: 0 }),
    /max_source_concurrency must be an integer >= 1/,
  );
});
