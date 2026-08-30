import test from 'node:test';
import assert from 'node:assert/strict';
import { decideReadPath } from './readModelGate.js';

const freshContext = {
  source_system: 'legacy-erp',
  source_reference: 'customer:4711',
  content_hash: 'sha256:abc',
  schema_version: '1',
  observed_at: '2026-08-30T18:00:00Z',
  retrieved_at: '2026-08-30T18:00:01Z',
  valid_until: '2026-08-30T19:00:00Z',
};

test('serves context reads from a proven fresh read model', () => {
  const decision = decideReadPath(
    {
      intent: 'context',
      readModelAvailable: true,
      sourceAvailable: true,
      readModelContext: freshContext,
    },
    '2026-08-30T18:30:00Z',
  );

  assert.equal(decision.allowed, true);
  assert.equal(decision.source, 'read_model');
  assert.equal(decision.requires_source_revalidation, false);
});

test('falls back to Source Truth when read model is stale', () => {
  const decision = decideReadPath(
    {
      intent: 'decision_support',
      readModelAvailable: true,
      sourceAvailable: true,
      readModelContext: freshContext,
    },
    '2026-08-30T20:00:00Z',
  );

  assert.equal(decision.allowed, true);
  assert.equal(decision.source, 'source');
  assert.equal(decision.requires_source_revalidation, true);
});

test('blocks when stale read model is the only available path', () => {
  const decision = decideReadPath(
    {
      intent: 'context',
      readModelAvailable: true,
      sourceAvailable: false,
      readModelContext: freshContext,
    },
    '2026-08-30T20:00:00Z',
  );

  assert.equal(decision.allowed, false);
  assert.equal(decision.source, null);
});

test('critical actions always require Source Truth', () => {
  const decision = decideReadPath(
    {
      intent: 'critical_action',
      readModelAvailable: true,
      sourceAvailable: true,
      readModelContext: freshContext,
    },
    '2026-08-30T18:30:00Z',
  );

  assert.equal(decision.allowed, true);
  assert.equal(decision.source, 'source');
  assert.equal(decision.requires_source_revalidation, true);
});

test('critical actions block when Source Truth is unavailable', () => {
  const decision = decideReadPath(
    {
      intent: 'critical_action',
      readModelAvailable: true,
      sourceAvailable: false,
      readModelContext: freshContext,
    },
    '2026-08-30T18:30:00Z',
  );

  assert.equal(decision.allowed, false);
  assert.equal(decision.source, null);
  assert.equal(decision.requires_source_revalidation, true);
});
