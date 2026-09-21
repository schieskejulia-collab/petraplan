-- PetraPlan Representation Evidence
--
-- Field-level proof of what the source contained, what the Bridge read and
-- what the persisted case presents. This table is append-only evidence; it
-- never changes source data and never decides semantic meaning or release.

create extension if not exists pgcrypto;

create table if not exists public.representation_evidence (
  id uuid primary key default gen_random_uuid(),
  ingestion_log_id uuid not null references public.ingestion_logs(id),
  record_id uuid not null references public.records(id),
  field_address text not null,
  source_path text not null,
  raw_representation jsonb,
  bridge_representation jsonb,
  display_representation jsonb,
  representation_format text not null default 'json',
  fidelity_status text not null
    check (fidelity_status in ('preserved', 'changed', 'lossy', 'unknown')),
  assessment_note text not null,
  evidence_hash text not null check (length(evidence_hash) = 64),
  observed_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists representation_evidence_record_id_observed_at_idx
  on public.representation_evidence (record_id, observed_at);

create index if not exists representation_evidence_ingestion_log_id_idx
  on public.representation_evidence (ingestion_log_id);

alter table public.representation_evidence enable row level security;

drop policy if exists "deny direct client access to representation_evidence"
  on public.representation_evidence;

create policy "deny direct client access to representation_evidence"
  on public.representation_evidence
  for all
  to anon, authenticated
  using (false)
  with check (false);

comment on table public.representation_evidence is
  'Append-only field-level proof that keeps source, Bridge and presented representations separate. It does not imply a semantic mapping.';
