-- PetraPlan idempotency hardening draft.
-- IMPORTANT: schema draft only. Verify the live Supabase project/schema before applying.
--
-- Principle:
--   intent/request identity answers: "is this the same logical request?"
--   source precondition answers:      "is the source still in the state we validated?"
-- These must not be conflated.

create table if not exists public.idempotency_records (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text not null unique,
  intent_id text not null,
  operation text not null,
  status text not null check (status in ('in_flight', 'completed', 'failed')),

  -- Exact source state that was validated for this attempt.
  source_system text,
  source_reference text,
  source_hash text,
  source_schema_version text,
  source_precondition_token text,

  -- Stored result lets a retry return the prior outcome instead of executing again.
  response_snapshot jsonb,
  error_snapshot jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  expires_at timestamptz not null,

  constraint idempotency_intent_operation_unique unique (intent_id, operation)
);

create index if not exists idempotency_records_expires_at_idx
  on public.idempotency_records (expires_at);

create index if not exists idempotency_records_status_idx
  on public.idempotency_records (status, updated_at);

comment on table public.idempotency_records is
  'Draft persistence for intent-based idempotency. Source state is a separate execution precondition, not request identity.';

comment on column public.idempotency_records.expires_at is
  'Retention boundary. TTL must be chosen from real client retry behavior and compliance requirements before production use.';

comment on column public.idempotency_records.source_precondition_token is
  'Fingerprint of the exact source state validated before execution. A mismatch requires revalidation.';

-- Intended reservation flow (application transaction / RPC to be implemented after
-- the live schema is verified):
-- 1. Atomically INSERT intent_id + operation + idempotency_key as in_flight.
-- 2. Unique conflict means this logical request already exists.
-- 3. completed -> return stored response_snapshot; do not repeat the side effect.
-- 4. in_flight -> wait/reject/recover according to an explicit stuck-request policy.
-- 5. failed -> retry only according to policy; never silently create a second intent.
--
-- Stuck in_flight recovery and cleanup are intentionally not implemented here.
-- They require explicit timeout/retention policy and a verified production schema.
