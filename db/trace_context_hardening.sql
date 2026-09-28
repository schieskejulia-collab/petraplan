-- PetraPlan trace-context hardening.
-- Reviewed against the live Supabase schema on 2026-09-28.
--
-- Purpose:
-- Connect one technical run across ingestion -> operation -> runtime -> validation
-- -> review -> release without changing Source Truth or inventing historical links.
--
-- IMPORTANT:
-- 1. Historical rows without trace evidence stay NULL. Never backfill guessed IDs.
-- 2. Human/business identifiers such as A-10248 stay in source_reference / record metadata.
--    Trace-context identifiers are technical UUIDs only.
-- 3. Technical target resolution (for example /usr/bin/grep + /path/server.js, an API
--    handler, or an SAP program/function target) belongs in operation_result JSONB.
--    It is evidence produced by the operation, not a replacement for address_registry.
-- 4. This migration only adds nullable trace context. It does not change release,
--    review, validation, candidate, or source semantics.

alter table ingestion_logs
  add column if not exists correlation_id uuid,
  add column if not exists causation_id uuid,
  add column if not exists trace_id uuid,
  add column if not exists span_id uuid,
  add column if not exists parent_span_id uuid;

alter table operation_logs
  add column if not exists correlation_id uuid,
  add column if not exists causation_id uuid,
  add column if not exists trace_id uuid,
  add column if not exists span_id uuid,
  add column if not exists parent_span_id uuid;

alter table runtime_logs
  add column if not exists correlation_id uuid,
  add column if not exists causation_id uuid,
  add column if not exists trace_id uuid,
  add column if not exists span_id uuid,
  add column if not exists parent_span_id uuid;

alter table validation_results
  add column if not exists correlation_id uuid,
  add column if not exists causation_id uuid,
  add column if not exists trace_id uuid,
  add column if not exists span_id uuid,
  add column if not exists parent_span_id uuid;

alter table review_sessions
  add column if not exists correlation_id uuid,
  add column if not exists causation_id uuid,
  add column if not exists trace_id uuid,
  add column if not exists span_id uuid,
  add column if not exists parent_span_id uuid;

alter table release_certificates
  add column if not exists correlation_id uuid,
  add column if not exists causation_id uuid,
  add column if not exists trace_id uuid,
  add column if not exists span_id uuid,
  add column if not exists parent_span_id uuid;

comment on column ingestion_logs.correlation_id is 'Technical UUID grouping one logical PetraPlan flow; business/source identifiers remain separate.';
comment on column ingestion_logs.trace_id is 'Technical UUID identifying one end-to-end execution trace.';
comment on column ingestion_logs.span_id is 'Technical UUID identifying this ingestion step inside a trace.';

comment on column operation_logs.causation_id is 'UUID of the event/span/operation that directly caused this operation when evidenced.';
comment on column operation_logs.parent_span_id is 'Parent span UUID in the same technical trace.';
comment on column operation_logs.operation_result is 'Operation result JSONB; may include resolved_targets, stdout/stderr/exit status, response metadata, or equivalent system-specific evidence.';

comment on column runtime_logs.parent_span_id is 'Parent execution span UUID linking runtime evidence to the operation that produced it.';
comment on column validation_results.parent_span_id is 'Parent span UUID linking validation to the evidenced run it evaluates.';
comment on column review_sessions.parent_span_id is 'Parent span UUID linking review to the validated trace under review.';
comment on column release_certificates.parent_span_id is 'Parent span UUID linking release certification to the reviewed trace.';

-- Indexes are intentionally not created here yet.
-- Add them only after observing query patterns and table sizes in production.
-- Candidate indexes for later evaluation:
-- create index concurrently if not exists ingestion_logs_trace_id_idx on ingestion_logs(trace_id);
-- create index concurrently if not exists operation_logs_trace_id_idx on operation_logs(trace_id);
-- create index concurrently if not exists runtime_logs_trace_id_idx on runtime_logs(trace_id);
-- create index concurrently if not exists validation_results_trace_id_idx on validation_results(trace_id);
-- create index concurrently if not exists review_sessions_trace_id_idx on review_sessions(trace_id);
-- create index concurrently if not exists release_certificates_trace_id_idx on release_certificates(trace_id);
