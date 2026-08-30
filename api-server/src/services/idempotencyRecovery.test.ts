import test from 'node:test';
import assert from 'node:assert/strict';
import { decideInFlightRecovery } from './idempotencyRecovery.js';

const now = '2026-08-30T20:00:00.000Z';
const staleHeartbeat = '2026-08-30T19:50:00.000Z';
const freshHeartbeat = '2026-08-30T19:59:30.000Z';
const staleAfterMs = 60_000;

test('fresh heartbeat is not taken over by recovery', () => {
  const decision = decideInFlightRecovery({
    status: 'in_flight',
    heartbeat_at: freshHeartbeat,
    stale_after_ms: staleAfterMs,
    side_effect_evidence: 'unknown',
  }, now);

  assert.equal(decision.stale, false);
  assert.equal(decision.outcome, null);
  assert.equal(decision.retry_allowed, false);
});

test('proven completed side effect closes the intent instead of retrying', () => {
  const decision = decideInFlightRecovery({
    status: 'in_flight',
    heartbeat_at: staleHeartbeat,
    stale_after_ms: staleAfterMs,
    side_effect_evidence: 'completed',
    result_reconstructable: true,
  }, now);

  assert.equal(decision.outcome, 'completed');
  assert.equal(decision.retry_allowed, false);
  assert.equal(decision.requires_reconciliation, false);
});

test('proven absence of a side effect makes the same intent retryable', () => {
  const decision = decideInFlightRecovery({
    status: 'in_flight',
    heartbeat_at: staleHeartbeat,
    stale_after_ms: staleAfterMs,
    side_effect_evidence: 'none',
  }, now);

  assert.equal(decision.outcome, 'retryable');
  assert.equal(decision.retry_allowed, true);
  assert.equal(decision.requires_reconciliation, false);
});

test('unknown side-effect state requires reconciliation and forbids automatic retry', () => {
  const decision = decideInFlightRecovery({
    status: 'in_flight',
    heartbeat_at: staleHeartbeat,
    stale_after_ms: staleAfterMs,
    side_effect_evidence: 'unknown',
  }, now);

  assert.equal(decision.outcome, 'reconciliation_required');
  assert.equal(decision.retry_allowed, false);
  assert.equal(decision.requires_reconciliation, true);
});

test('staleness threshold must be explicit and positive', () => {
  assert.throws(() => decideInFlightRecovery({
    status: 'in_flight',
    heartbeat_at: staleHeartbeat,
    stale_after_ms: 0,
    side_effect_evidence: 'none',
  }, now), /stale_after_ms must be greater than zero/);
});
