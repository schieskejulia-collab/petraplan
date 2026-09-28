-- PetraPlan minimal claim layer
--
-- Claims sit between Evidence and Candidates. They record what is being
-- asserted, in which scope, and which Evidence may support, contradict,
-- qualify, derive, or supersede that assertion.
--
-- This layer deliberately does NOT mutate source snapshots, candidates,
-- validations, reviews, or releases.

create extension if not exists pgcrypto;

create table if not exists public.claims (
  id uuid primary key default gen_random_uuid(),
  claim_family_id uuid not null,
  claim_version integer not null default 1 check (claim_version > 0),

  claim_type text not null check (claim_type in (
    'SOURCE',
    'STRUCTURE',
    'REPRESENTATION',
    'SEMANTIC',
    'SEMANTIC_MAPPING',
    'MAPPING',
    'AGGREGATION',
    'CONTEXT',
    'BEHAVIOR',
    'VALIDATION',
    'DECISION',
    'AUTHORIZATION'
  )),

  subject_address text not null,
  predicate text not null,
  object_value jsonb,
  statement text not null,

  status text not null check (status in (
    'DRAFT',
    'UNPROVEN',
    'SUPPORTED',
    'CONFIRMED',
    'CONTESTED',
    'REJECTED',
    'SUPERSEDED'
  )),

  scope_type text not null check (scope_type in (
    'CASE_ONLY',
    'SNAPSHOT_ONLY',
    'SOURCE_FIELD',
    'SOURCE_SYSTEM',
    'DATASET_ONLY',
    'PROCESS_CONTEXT',
    'ORGANIZATION_CONTEXT',
    'SYSTEM_VERSION',
    'GLOBAL'
  )),
  scope_payload jsonb not null default '{}'::jsonb,

  source_system text,
  snapshot_id uuid references public.ingestion_logs(id),
  record_id uuid references public.records(id),
  field_address text,

  created_by text not null,
  created_at timestamptz not null default now(),
  producer_role text,

  confirmed_by text,
  confirmed_at timestamptz,
  confirmer_role text,
  confirmation_reason text,

  valid_from timestamptz,
  valid_to timestamptz,

  supersedes_claim_id uuid references public.claims(id),
  supersede_reason text,

  rule_id text,
  rule_version text,
  candidate_id uuid references public.conversion_candidates(id),
  claim_payload_hash text,

  unique (claim_family_id, claim_version),
  check (valid_to is null or valid_from is null or valid_to >= valid_from),
  check (
    status <> 'CONFIRMED'
    or (confirmed_by is not null and confirmed_at is not null)
  ),
  check (
    status <> 'SUPERSEDED'
    or supersedes_claim_id is not null
  )
);

create index if not exists claims_record_status_idx
  on public.claims (record_id, status);

create index if not exists claims_snapshot_idx
  on public.claims (snapshot_id);

create index if not exists claims_subject_address_idx
  on public.claims (subject_address);

create index if not exists claims_family_version_idx
  on public.claims (claim_family_id, claim_version desc);

create table if not exists public.claim_evidence_links (
  id uuid primary key default gen_random_uuid(),
  claim_id uuid not null references public.claims(id) on delete cascade,

  evidence_type text not null,
  evidence_reference text not null,
  relation text not null check (relation in (
    'SUPPORTS',
    'CONTRADICTS',
    'QUALIFIES',
    'DERIVED_FROM',
    'SUPERSEDES'
  )),
  directness text not null check (directness in ('DIRECT', 'INDIRECT')),

  scope jsonb not null default '{}'::jsonb,
  linked_by text not null,
  linked_at timestamptz not null default now(),
  note text,

  unique (claim_id, evidence_type, evidence_reference, relation)
);

create index if not exists claim_evidence_links_claim_idx
  on public.claim_evidence_links (claim_id);

create index if not exists claim_evidence_links_reference_idx
  on public.claim_evidence_links (evidence_type, evidence_reference);

alter table public.claims enable row level security;
alter table public.claim_evidence_links enable row level security;

create policy "deny direct client access to claims"
  on public.claims for all to anon, authenticated using (false) with check (false);

create policy "deny direct client access to claim_evidence_links"
  on public.claim_evidence_links for all to anon, authenticated using (false) with check (false);

comment on table public.claims is
  'Claim layer between Evidence and Candidates. A claim is an explicit assertion with scope and status; it is not source truth and does not itself authorize release.';

comment on table public.claim_evidence_links is
  'Explicit n:m Evidence-to-Claim relationships. Evidence may SUPPORT, CONTRADICT, QUALIFY, derive, or supersede a claim without automatically confirming it.';
