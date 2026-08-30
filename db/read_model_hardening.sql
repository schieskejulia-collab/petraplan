-- DRAFT ONLY. Verify the live Supabase schema before applying.
-- A read model is never Source Truth. It is a derived, disposable projection.

create table if not exists read_model_entries (
  id uuid primary key default gen_random_uuid(),
  source_system text not null,
  source_reference text not null,
  source_version text,
  schema_version text not null,
  content_hash text not null,
  payload jsonb not null,
  observed_at timestamptz not null,
  retrieved_at timestamptz not null default now(),
  valid_from timestamptz,
  valid_until timestamptz not null,
  invalidated_at timestamptz,
  invalidation_reason text,
  correlation_id uuid,
  trace_id uuid,
  created_at timestamptz not null default now(),
  unique (source_system, source_reference, content_hash)
);

create index if not exists idx_read_model_entries_lookup
  on read_model_entries (source_system, source_reference, valid_until desc);

create index if not exists idx_read_model_entries_trace
  on read_model_entries (correlation_id, trace_id);

comment on table read_model_entries is
  'Derived read projection only. Never authoritative Source Truth and never a direct write target.';

comment on column read_model_entries.invalidated_at is
  'Set when a source/process event proves this projection must no longer be served.';

-- No automatic fallback to stale rows should be implemented in SQL.
-- Application policy decides whether to serve the read model, revalidate the source, or block.
