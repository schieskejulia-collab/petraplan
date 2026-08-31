-- PetraPlan semantic drift hardening draft.
-- IMPORTANT: schema draft only. Verify the live Supabase project/schema before applying.
--
-- Principle:
-- Technical schema compatibility does not prove semantic compatibility.
-- A field can keep the same name/type while its business meaning, unit, code system,
-- allowed domain, or invariant changes.

create table if not exists public.semantic_meaning_evidence (
  id uuid primary key default gen_random_uuid(),
  contract_key text not null,
  field_key text not null,
  semantic_id text not null,
  meaning_version text not null,
  value_type text,
  unit text,
  code_system text,
  allowed_values text[],
  invariant_hash text,
  source_system text,
  valid_from timestamptz,
  valid_until timestamptz,
  observed_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists public.semantic_drift_results (
  id uuid primary key default gen_random_uuid(),
  correlation_id text,
  contract_key text not null,
  field_key text not null,
  expected_evidence_id uuid references public.semantic_meaning_evidence(id),
  observed_evidence_id uuid references public.semantic_meaning_evidence(id),
  status text not null check (status in ('compatible', 'drift_detected', 'unknown')),
  compatible_for_action boolean not null default false,
  differences text[] not null default '{}',
  missing_evidence text[] not null default '{}',
  reason text not null,
  observed_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists semantic_meaning_evidence_lookup_idx
  on public.semantic_meaning_evidence (contract_key, field_key, observed_at desc);

create index if not exists semantic_drift_results_lookup_idx
  on public.semantic_drift_results (contract_key, field_key, observed_at desc);

comment on table public.semantic_drift_results is
  'Draft audit truth for business-meaning drift. Unknown semantic evidence must not be promoted to compatible.';
