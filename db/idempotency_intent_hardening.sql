-- PetraPlan idempotency hardening draft.
-- IMPORTANT: schema draft only. Verify the live Supabase project/schema before applying.
--
-- Principle:
--   intent/request identity answers: "is this the same logical request?"
--   source precondition answers:      "is the source still in the state we validated?"
--   recovery evidence answers:       "did the abandoned attempt already cause a side effect?"
-- These must not be conflated.

create table if not exists public.idempotency_records (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text not null unique,
  intent_id text not null,
  operation text not null,
  status text not null check (status in (
    'in_flight',
    'completed',
    'failed',
    'retryable',
    'reconciliation_required'
  )),

  -- Exact source state that was validated for this attempt.
  source_system text,
  source_reference text,
  source_hash text,
  source_schema_version text,
  source_precondition_token text,

  -- Recovery metadata. A stale heartbeat is evidence of abandonment, not permission to retry.
  started_at timestamptz not null default now(),
  heartbeat_at timestamptz not null default now(),
  attempt_count integer not null default 1 check (attempt_count > 0),
  side_effect_evidence text check (side_effect_evidence in ('none', 'completed', 'unknown')),
  recovery_reason text,
  recovered_at timestamptz,

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

create index if not exists idempotency_records_heartbeat_idx
  on public.idempotency_records (status, heartbeat_at)
  where status = 'in_flight';

comment on table public.idempotency_records is
  'Draft persistence for intent-based idempotency with evidence-first recovery. Source state is a separate execution precondition, not request identity.';

comment on column public.idempotency_records.expires_at is
  'Retention boundary. TTL must be chosen from real client retry behavior and compliance requirements before production use.';

comment on column public.idempotency_records.source_precondition_token is
  'Fingerprint of the exact source state validated before execution. A mismatch requires revalidation.';

comment on column public.idempotency_records.heartbeat_at is
  'Liveness evidence for the current attempt. A stale heartbeat triggers investigation, never an automatic retry.';

comment on column public.idempotency_records.side_effect_evidence is
  'Recovery evidence: none means retry may be safe, completed means close/reconstruct result, unknown requires reconciliation.';

-- Intended reservation/recovery flow (application transaction / RPC to be implemented
-- only after the live schema and actual execution path are verified):
-- 1. Atomically INSERT intent_id + operation + idempotency_key as in_flight.
-- 2. Unique conflict means this logical request already exists.
-- 3. completed -> return stored response_snapshot; do not repeat the side effect.
-- 4. current in_flight heartbeat -> do not take ownership.
-- 5. stale in_flight heartbeat -> investigate the original attempt first:
--      side effect proven completed -> completed (reconstruct response if required)
--      side effect proven absent    -> retryable
--      side effect uncertain        -> reconciliation_required
-- 6. reconciliation_required must never auto-retry.
-- 7. A retry keeps the same intent identity and increments attempt_count; it does not create a second intent.
--
-- No fixed heartbeat timeout or TTL is encoded here. Those values depend on the
-- real legacy operation duration, client retry behavior and operational policy.
