import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createChildTrace,
  createRootTrace,
  isValidTraceContext,
} from './traceContext.js';

const CORRELATION_ID = '11111111-1111-4111-8111-111111111111';
const TRACE_ID = '22222222-2222-4222-8222-222222222222';
const OPERATION_ID = '33333333-3333-4333-8333-333333333333';

test('root trace creates stable UUID correlation and trace identifiers', () => {
  const root = createRootTrace({ correlationId: CORRELATION_ID, traceId: TRACE_ID });

  assert.equal(root.correlation_id, CORRELATION_ID);
  assert.equal(root.trace_id, TRACE_ID);
  assert.equal(root.causation_id, null);
  assert.equal(root.parent_span_id, null);
  assert.ok(root.span_id);
  assert.equal(isValidTraceContext(root), true);
});

test('root trace rejects business-readable identifiers in UUID trace fields', () => {
  assert.throws(
    () => createRootTrace({ correlationId: 'A-10248' }),
    /correlationId must be a UUID/,
  );
});

test('child trace preserves correlation and trace while linking causation', () => {
  const root = createRootTrace();
  const child = createChildTrace(root, OPERATION_ID);

  assert.equal(child.correlation_id, root.correlation_id);
  assert.equal(child.trace_id, root.trace_id);
  assert.equal(child.causation_id, OPERATION_ID);
  assert.equal(child.parent_span_id, root.span_id);
  assert.notEqual(child.span_id, root.span_id);
  assert.equal(isValidTraceContext(child), true);
});

test('child falls back to parent span as causation reference', () => {
  const root = createRootTrace();
  const child = createChildTrace(root);

  assert.equal(child.causation_id, root.span_id);
});

test('child rejects non-UUID explicit causation identifiers', () => {
  const root = createRootTrace();

  assert.throws(
    () => createChildTrace(root, 'operation-456'),
    /causationId must be a UUID/,
  );
});

test('incomplete or malformed trace context is rejected', () => {
  assert.equal(isValidTraceContext({ correlation_id: CORRELATION_ID }), false);
  assert.equal(
    isValidTraceContext({
      correlation_id: 'x',
      trace_id: TRACE_ID,
      span_id: OPERATION_ID,
    }),
    false,
  );
  assert.equal(isValidTraceContext(null), false);
});
