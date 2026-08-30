-- PetraPlan trace-context hardening draft.
-- IMPORTANT: review against the live Supabase schema before applying.
-- Historical rows without trace evidence must stay NULL; do not backfill guessed IDs.

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

-- Optional indexes for later tracing queries. Apply only after confirming table size and usage.
-- create index concurrently if not exists ingestion_logs_trace_id_idx on ingestion_logs(trace_id);
-- create index concurrently if not exists operation_logs_trace_id_idx on operation_logs(trace_id);
-- create index concurrently if not exists runtime_logs_trace_id_idx on runtime_logs(trace_id);
