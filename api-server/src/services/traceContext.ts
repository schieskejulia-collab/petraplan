import { randomUUID } from 'node:crypto';

export interface TraceContext {
  correlation_id: string;
  causation_id: string | null;
  trace_id: string;
  span_id: string;
  parent_span_id: string | null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function clean(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function uuidOrNull(value: string | null | undefined, field: string): string | null {
  const normalized = clean(value);
  if (!normalized) return null;
  if (!UUID_RE.test(normalized)) {
    throw new Error(`${field} must be a UUID`);
  }
  return normalized;
}

/**
 * Creates a root trace for a new logical PetraPlan flow.
 *
 * The persisted trace columns are UUIDs. Business-readable identifiers such as
 * A-10248 belong in source_reference / record metadata, not in correlation_id.
 *
 * correlation_id groups the business flow, while trace_id groups one technical
 * trace through ingestion -> execution -> runtime -> validation -> review -> release.
 */
export function createRootTrace(input: {
  correlationId?: string | null;
  traceId?: string | null;
} = {}): TraceContext {
  return {
    correlation_id: uuidOrNull(input.correlationId, 'correlationId') ?? randomUUID(),
    causation_id: null,
    trace_id: uuidOrNull(input.traceId, 'traceId') ?? randomUUID(),
    span_id: randomUUID(),
    parent_span_id: null,
  };
}

/**
 * Creates a child trace step without changing the logical correlation or trace.
 * causation_id points to the UUID of the event/operation that caused this step.
 * If no explicit cause is supplied, the parent span is used.
 */
export function createChildTrace(parent: TraceContext, causationId?: string | null): TraceContext {
  if (!isValidTraceContext(parent)) {
    throw new Error('parent trace context is invalid');
  }

  return {
    correlation_id: parent.correlation_id,
    causation_id: uuidOrNull(causationId, 'causationId') ?? parent.span_id,
    trace_id: parent.trace_id,
    span_id: randomUUID(),
    parent_span_id: parent.span_id,
  };
}

export function isValidTraceContext(value: Partial<TraceContext> | null | undefined): value is TraceContext {
  if (!value) return false;

  const required = [value.correlation_id, value.trace_id, value.span_id];
  if (required.some((item) => !item || !UUID_RE.test(item))) return false;

  if (value.causation_id && !UUID_RE.test(value.causation_id)) return false;
  if (value.parent_span_id && !UUID_RE.test(value.parent_span_id)) return false;

  return true;
}
