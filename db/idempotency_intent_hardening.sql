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
  execution_id uuid not null default gen_random_uuid(),
  claim_token uuid not null default gen_random_uuid(),
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

create unique index if not exists idempotency_records_execution_id_uidx
  on public.idempotency_records (execution_id);

create index if not exists idempotency_records_expires_at_idx
  on public.idempotency_records (expires_at);

create index if not exists idempotency_records_status_idx
  on public.idempotency_records (status, updated_at);

create index if not exists idempotency_records_heartbeat_idx
  on public.idempotency_records (status, heartbeat_at)
  where status = 'in_flight';

comment on table public.idempotency_records is
  'Draft persistence for intent-based idempotency with evidence-first recovery. Source state is a separate execution precondition, not request identity.';

comment on column public.idempotency_records.execution_id is
  'Stable logical execution identity returned to all duplicate deliveries of the same intent + operation.';

comment on column public.idempotency_records.claim_token is
  'Unique token of the request that originally won the atomic claim. Used to distinguish new claim from duplicate delivery.';

comment on column public.idempotency_records.expires_at is
  'Retention boundary. TTL must be chosen from real client retry behavior and compliance requirements before production use.';

comment on column public.idempotency_records.source_precondition_token is
  'Fingerprint of the exact source state validated before execution. A mismatch requires revalidation.';

comment on column public.idempotency_records.heartbeat_at is
  'Liveness evidence for the current attempt. A stale heartbeat triggers investigation, never an automatic retry.';

comment on column public.idempotency_records.side_effect_evidence is
  'Recovery evidence: none means retry may be safe, completed means close/reconstruct result, unknown requires reconciliation.';

-- Atomic runtime claim.
--
-- Why ON CONFLICT DO UPDATE instead of SELECT-then-INSERT:
-- SELECT-then-INSERT has a race window. Two workers can both observe "missing"
-- before either insert commits. The UNIQUE(intent_id, operation) constraint must
-- be the arbiter. PostgreSQL serializes the conflicting write and this single
-- statement returns one stable execution_id to every duplicate delivery.
--
-- The no-op update intentionally leaves business state untouched. claim_token
-- tells the caller whether this request created the row (claimed = true) or
-- collided with an already-owned logical execution (claimed = false).
create or replace function public.claim_idempotent_execution(
  p_intent_id text,
  p_operation text,
  p_idempotency_key text,
  p_expires_at timestamptz,
  p_source_system text default null,
  p_source_reference text default null,
  p_source_hash text default null,
  p_source_schema_version text default null,
  p_source_precondition_token text default null
)
returns table (
  claimed boolean,
  execution_id uuid,
  status text,
  response_snapshot jsonb,
  error_snapshot jsonb
)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_claim_token uuid := gen_random_uuid();
begin
  if p_intent_id is null or btrim(p_intent_id) = '' then
    raise exception 'intent_id is required';
  end if;

  if p_operation is null or btrim(p_operation) = '' then
    raise exception 'operation is required';
  end if;

  if p_idempotency_key is null or btrim(p_idempotency_key) = '' then
    raise exception 'idempotency_key is required';
  end if;

  if p_expires_at is null then
    raise exception 'expires_at is required';
  end if;

  return query
  insert into public.idempotency_records (
    claim_token,
    idempotency_key,
    intent_id,
    operation,
    status,
    source_system,
    source_reference,
    source_hash,
    source_schema_version,
    source_precondition_token,
    side_effect_evidence,
    expires_at
  ) values (
    v_claim_token,
    btrim(p_idempotency_key),
    btrim(p_intent_id),
    btrim(p_operation),
    'in_flight',
    p_source_system,
    p_source_reference,
    p_source_hash,
    p_source_schema_version,
    p_source_precondition_token,
    'unknown',
    p_expires_at
  )
  on conflict (intent_id, operation)
  do update set
    intent_id = public.idempotency_records.intent_id
  returning
    public.idempotency_records.claim_token = v_claim_token,
    public.idempotency_records.execution_id,
    public.idempotency_records.status,
    public.idempotency_records.response_snapshot,
    public.idempotency_records.error_snapshot;
end;
$$;

comment on function public.claim_idempotent_execution(
  text, text, text, timestamptz, text, text, text, text, text
) is
  'Atomically claims one logical execution per intent_id + operation. Duplicate concurrent deliveries receive the same execution_id and claimed=false.';

-- Intended reservation/recovery flow:
-- 1. Call claim_idempotent_execution(...).
-- 2. claimed=true  -> this request owns the new logical execution.
-- 3. claimed=false -> never execute a second side effect; inspect returned status.
-- 4. completed -> return stored response_snapshot.
-- 5. current in_flight heartbeat -> do not take ownership.
-- 6. stale in_flight heartbeat -> investigate the original attempt first:
--      side effect proven completed -> completed (reconstruct response if required)
--      side effect proven absent    -> retryable
--      side effect uncertain        -> reconciliation_required
-- 7. reconciliation_required must never auto-retry.
-- 8. A retry keeps the same intent identity and increments attempt_count; it does not create a second intent.
--
-- No fixed heartbeat timeout or TTL is encoded here. Those values depend on the
-- real legacy operation duration, client retry behavior and operational policy.
