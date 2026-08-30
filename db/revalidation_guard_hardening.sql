-- PetraPlan revalidation herd-protection draft.
-- IMPORTANT: schema draft only. Verify the live Supabase project/schema before applying.
--
-- Goal:
--   many callers needing the same stale source record must not fan out into many
--   simultaneous Legacy reads. One lease holder revalidates; followers join/wait.
--   Source-wide concurrency is capped separately.

create table if not exists public.revalidation_leases (
  id uuid primary key default gen_random_uuid(),
  revalidation_key text not null unique,
  source_system text not null,
  source_reference text not null,
  status text not null check (status in ('in_flight', 'completed', 'failed')),
  leader_id text not null,
  started_at timestamptz not null default now(),
  heartbeat_at timestamptz not null default now(),
  completed_at timestamptz,
  expires_at timestamptz not null,
  result_source_hash text,
  result_observed_at timestamptz,
  error_snapshot jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists revalidation_leases_source_status_idx
  on public.revalidation_leases (source_system, status, started_at);

create index if not exists revalidation_leases_expires_at_idx
  on public.revalidation_leases (expires_at);

comment on table public.revalidation_leases is
  'Draft single-flight lease registry for guarded Source Truth revalidation. One logical source record gets at most one active leader.';

comment on column public.revalidation_leases.expires_at is
  'Lease/retention boundary. Duration must be chosen from real source latency and timeout behavior; no production value is assumed here.';

-- Intended application/RPC flow after live schema verification:
-- 1. Compute stable revalidation_key from source_system + source_reference.
-- 2. Atomically reserve the key as in_flight. Unique conflict means another caller is leader.
-- 3. Followers do not hit Legacy; they join/wait for the leader result.
-- 4. Before a new leader is admitted, count active leases for source_system and
--    enforce a configured max_source_concurrency.
-- 5. When source capacity is exhausted, return explicit backoff/retry metadata.
-- 6. Leader heartbeats while reading and publishes result hash/observed_at on completion.
-- 7. Stale leases must enter an explicit recovery path; never assume a dead lease
--    means it is safe to create duplicate Legacy traffic.
--
-- This draft intentionally does not hard-code concurrency, timeout, or retry values.
-- They depend on the real Legacy system's capacity and latency profile.
