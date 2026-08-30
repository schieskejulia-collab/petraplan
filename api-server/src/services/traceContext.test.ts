import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createChildTrace,
  createRootTrace,
  isValidTraceContext,
} from './traceContext.js';

test('root trace creates stable correlation and trace identifiers', () => {
  const root = createRootTrace({ correlationId: 'case-123', traceId: 'trace-123' });

  assert.equal(root.correlation_id, 'case-123');
  assert.equal(root.trace_id, 'trace-123');
  assert.equal(root.causation_id, null);
  assert.equal(root.parent_span_id, null);
  assert.ok(root.span_id);
  assert.equal(isValidTraceContext(root), true);
});

test('child trace preserves correlation and trace while linking causation', () => {
  const root = createRootTrace();
  const child = createChildTrace(root, 'operation-456');

  assert.equal(child.correlation_id, root.correlation_id);
  assert.equal(child.trace_id, root.trace_id);
  assert.equal(child.causation_id, 'operation-456');
  assert.equal(child.parent_span_id, root.span_id);
  assert.notEqual(child.span_id, root.span_id);
});

test('child falls back to parent span as causation reference', () => {
  const root = createRootTrace();
  const child = createChildTrace(root);

  assert.equal(child.causation_id, root.span_id);
});

test('incomplete trace context is rejected', () => {
  assert.equal(isValidTraceContext({ correlation_id: 'x' }), false);
  assert.equal(isValidTraceContext(null), false);
});
