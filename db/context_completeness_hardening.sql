-- PetraPlan context completeness hardening draft.
-- IMPORTANT: schema draft only. Verify the live Supabase project/schema before applying.
--
-- Principle:
-- Context assembled from multiple sources must carry explicit completeness truth.
-- Missing required sources must never be silently represented as complete context.

create table if not exists public.context_completeness_records (
  id uuid primary key default gen_random_uuid(),
  correlation_id text,
  context_key text not null,
  status text not null check (status in ('complete', 'partial', 'unavailable')),
  expected_source_keys text[] not null default '{}',
  available_source_keys text[] not null default '{}',
  missing_required_source_keys text[] not null default '{}',
  unavailable_optional_source_keys text[] not null default '{}',
  complete_for_action boolean not null default false,
  reason text not null,
  observed_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists context_completeness_records_context_idx
  on public.context_completeness_records (context_key, observed_at desc);

create index if not exists context_completeness_records_correlation_idx
  on public.context_completeness_records (correlation_id, observed_at desc);

comment on table public.context_completeness_records is
  'Draft audit truth for multi-source context completeness. Partial or unavailable required context must remain explicit.';

-- Intended integration after the live schema is verified:
-- 1. Define the expected source set for a context/operation.
-- 2. Record each source as available/unavailable and required/optional.
-- 3. Derive complete/partial/unavailable before policy or AI consumption.
-- 4. A partial required context is never silently promoted to complete.
-- 5. Sentinel/policy may later decide whether a specific partial context is usable
--    for display only, but complete_for_action remains false while a required source is missing.
