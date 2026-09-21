-- PetraPlan Address Layer
--
-- A read-only index over the existing case and snapshot truth chain.
-- It stores stable logical addresses and candidate links. Source values remain
-- in ingestion_logs/raw payloads and representation_evidence.

create extension if not exists pgcrypto;

create table if not exists public.address_registry (
  id uuid primary key default gen_random_uuid(),
  source_id text not null,
  first_snapshot_id uuid not null references public.ingestion_logs(id),
  first_record_id uuid not null references public.records(id),
  address text not null,
  parent_address_id uuid references public.address_registry(id),
  kind text not null check (kind in ('object', 'field', 'collection', 'bridge_field')),
  source_path text not null,
  registered_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (source_id, address)
);

create index if not exists address_registry_parent_address_id_idx
  on public.address_registry (parent_address_id);

create index if not exists address_registry_snapshot_id_idx
  on public.address_registry (first_snapshot_id);

create table if not exists public.conversion_candidates (
  id uuid primary key default gen_random_uuid(),
  candidate_key text not null,
  record_id uuid not null references public.records(id),
  snapshot_id uuid not null references public.ingestion_logs(id),
  source_address_id uuid not null references public.address_registry(id),
  source_path text not null,
  observed_value jsonb,
  proposed_value jsonb,
  conversion_kind text not null,
  evidence text not null,
  state text not null check (state in ('candidate', 'confirmed', 'rejected')),
  created_at timestamptz not null,
  unique (snapshot_id, candidate_key)
);

create index if not exists conversion_candidates_record_state_idx
  on public.conversion_candidates (record_id, state);

create index if not exists conversion_candidates_source_address_idx
  on public.conversion_candidates (source_address_id);

create table if not exists public.impact_links (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.conversion_candidates(id) on delete cascade,
  address_id uuid not null references public.address_registry(id),
  link_type text not null check (link_type in ('impacts', 'derives_from', 'conflicts_with', 'replaces')),
  created_at timestamptz not null default now(),
  unique (candidate_id, address_id, link_type)
);

create index if not exists impact_links_address_id_type_idx
  on public.impact_links (address_id, link_type);

create index if not exists impact_links_candidate_id_idx
  on public.impact_links (candidate_id);

create table if not exists public.candidate_state_history (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.conversion_candidates(id) on delete cascade,
  snapshot_id uuid not null references public.ingestion_logs(id),
  state text not null check (state in ('candidate', 'confirmed', 'rejected')),
  changed_by text not null,
  changed_at timestamptz not null,
  reason text not null,
  evidence_reference text,
  created_at timestamptz not null default now(),
  unique (candidate_id, changed_at, state)
);

create index if not exists candidate_state_history_candidate_changed_idx
  on public.candidate_state_history (candidate_id, changed_at);

alter table public.address_registry enable row level security;
alter table public.conversion_candidates enable row level security;
alter table public.impact_links enable row level security;
alter table public.candidate_state_history enable row level security;

create policy "deny direct client access to address_registry"
  on public.address_registry for all to anon, authenticated using (false) with check (false);
create policy "deny direct client access to conversion_candidates"
  on public.conversion_candidates for all to anon, authenticated using (false) with check (false);
create policy "deny direct client access to impact_links"
  on public.impact_links for all to anon, authenticated using (false) with check (false);
create policy "deny direct client access to candidate_state_history"
  on public.candidate_state_history for all to anon, authenticated using (false) with check (false);

comment on table public.address_registry is
  'Read-only address index anchored to existing source identity and first observed snapshot; it does not hold source truth values.';
comment on table public.conversion_candidates is
  'Visible, non-operative semantic conversion candidates anchored to a case and snapshot.';
