import test from 'node:test';
import assert from 'node:assert/strict';
import { validateResolutionBeforeValidation } from './truthOrder.js';

test('accepts validation anchored to a prior matching resolution', () => {
  const decision = validateResolutionBeforeValidation(
    {
      id: 'resolution-1',
      conflict_id: 'conflict-1',
      created_at: '2026-08-31T08:00:00Z',
    },
    {
      id: 'validation-1',
      conflict_id: 'conflict-1',
      resolution_id: 'resolution-1',
      created_at: '2026-08-31T08:01:00Z',
    },
  );

  assert.equal(decision.valid, true);
  assert.deepEqual(decision.missing, []);
});

test('blocks validation that predates its resolution', () => {
  const decision = validateResolutionBeforeValidation(
    {
      id: 'resolution-1',
      conflict_id: 'conflict-1',
      created_at: '2026-08-31T08:01:00Z',
    },
    {
      id: 'validation-1',
      conflict_id: 'conflict-1',
      resolution_id: 'resolution-1',
      created_at: '2026-08-31T08:00:00Z',
    },
  );

  assert.equal(decision.valid, false);
  assert.ok(decision.missing.includes('validation_after_resolution'));
});

test('blocks validation without an explicit resolution reference', () => {
  const decision = validateResolutionBeforeValidation(
    {
      id: 'resolution-1',
      conflict_id: 'conflict-1',
      created_at: '2026-08-31T08:00:00Z',
    },
    {
      id: 'validation-1',
      conflict_id: 'conflict-1',
      resolution_id: null,
      created_at: '2026-08-31T08:01:00Z',
    },
  );

  assert.equal(decision.valid, false);
  assert.ok(decision.missing.includes('validation_resolution_reference'));
});

test('blocks validation anchored to a different resolution or conflict', () => {
  const decision = validateResolutionBeforeValidation(
    {
      id: 'resolution-1',
      conflict_id: 'conflict-1',
      created_at: '2026-08-31T08:00:00Z',
    },
    {
      id: 'validation-1',
      conflict_id: 'conflict-2',
      resolution_id: 'resolution-2',
      created_at: '2026-08-31T08:01:00Z',
    },
  );

  assert.equal(decision.valid, false);
  assert.ok(decision.missing.includes('resolution_reference_match'));
  assert.ok(decision.missing.includes('conflict_reference_match'));
});
