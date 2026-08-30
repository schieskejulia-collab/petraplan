import test from 'node:test';
import assert from 'node:assert/strict';
import { createCommandSaga, reduceCommandSaga } from './commandSaga.js';

function baseSaga() {
  return createCommandSaga({
    id: 'cmd-1',
    idempotencyKey: 'pp_test',
    steps: [
      { id: 'validate', name: 'Validate command' },
      { id: 'write', name: 'Write to source', compensatable: true },
      { id: 'verify', name: 'Read-after-write verification' },
    ],
  });
}

test('successful multi-step command reaches completed', () => {
  let state = reduceCommandSaga(baseSaga(), { type: 'start' });
  for (const stepId of ['validate', 'write', 'verify']) {
    state = reduceCommandSaga(state, { type: 'step_started', stepId });
    state = reduceCommandSaga(state, { type: 'step_completed', stepId });
  }
  assert.equal(state.status, 'completed');
  assert.equal(state.current_step_id, null);
});

test('failure after a completed compensatable write enters compensation', () => {
  let state = reduceCommandSaga(baseSaga(), { type: 'start' });
  state = reduceCommandSaga(state, { type: 'step_started', stepId: 'validate' });
  state = reduceCommandSaga(state, { type: 'step_completed', stepId: 'validate' });
  state = reduceCommandSaga(state, { type: 'step_started', stepId: 'write' });
  state = reduceCommandSaga(state, { type: 'step_completed', stepId: 'write' });
  state = reduceCommandSaga(state, { type: 'step_started', stepId: 'verify' });
  state = reduceCommandSaga(state, {
    type: 'step_failed',
    stepId: 'verify',
    reason: 'source verification timed out',
  });

  assert.equal(state.status, 'compensating');
  assert.equal(state.failure_reason, 'source verification timed out');
});

test('completed write can be explicitly compensated', () => {
  let state = reduceCommandSaga(baseSaga(), { type: 'start' });
  state = reduceCommandSaga(state, { type: 'step_started', stepId: 'validate' });
  state = reduceCommandSaga(state, { type: 'step_completed', stepId: 'validate' });
  state = reduceCommandSaga(state, { type: 'step_started', stepId: 'write' });
  state = reduceCommandSaga(state, { type: 'step_completed', stepId: 'write' });
  state = reduceCommandSaga(state, { type: 'step_started', stepId: 'verify' });
  state = reduceCommandSaga(state, { type: 'step_failed', stepId: 'verify', reason: 'failed' });
  state = reduceCommandSaga(state, { type: 'compensation_started', stepId: 'write' });
  state = reduceCommandSaga(state, { type: 'compensation_completed', stepId: 'write' });

  assert.equal(state.status, 'compensated');
  assert.equal(state.steps.find((step) => step.id === 'write')?.status, 'compensated');
});

test('failure before any side effect fails without fake compensation', () => {
  let state = reduceCommandSaga(baseSaga(), { type: 'start' });
  state = reduceCommandSaga(state, { type: 'step_started', stepId: 'validate' });
  state = reduceCommandSaga(state, { type: 'step_failed', stepId: 'validate', reason: 'policy denied' });
  assert.equal(state.status, 'failed');
});

test('invalid transition is rejected instead of silently repairing state', () => {
  const state = baseSaga();
  assert.throws(
    () => reduceCommandSaga(state, { type: 'step_completed', stepId: 'write' }),
    /running saga/,
  );
});
