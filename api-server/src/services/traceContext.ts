import { randomUUID } from 'node:crypto';

export interface TraceContext {
  correlation_id: string;
  causation_id: string | null;
  trace_id: string;
  span_id: string;
  parent_span_id: string | null;
}

function clean(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

/**
 * Creates a root trace for a new logical PetraPlan flow.
 * correlation_id groups the business flow, trace_id groups the technical trace.
 */
export function createRootTrace(input: {
  correlationId?: string | null;
  traceId?: string | null;
} = {}): TraceContext {
  return {
    correlation_id: clean(input.correlationId) ?? randomUUID(),
    causation_id: null,
    trace_id: clean(input.traceId) ?? randomUUID(),
    span_id: randomUUID(),
    parent_span_id: null,
  };
}

/**
 * Creates a child trace step without changing the logical correlation or trace.
 * causation_id points to the event/operation that caused the child step.
 */
export function createChildTrace(parent: TraceContext, causationId?: string | null): TraceContext {
  return {
    correlation_id: parent.correlation_id,
    causation_id: clean(causationId) ?? parent.span_id,
    trace_id: parent.trace_id,
    span_id: randomUUID(),
    parent_span_id: parent.span_id,
  };
}

export function isValidTraceContext(value: Partial<TraceContext> | null | undefined): value is TraceContext {
  if (!value) return false;
  return Boolean(
    clean(value.correlation_id) &&
      clean(value.trace_id) &&
      clean(value.span_id),
  );
}
