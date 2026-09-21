-- Applied to PetraPlan production Supabase on 2026-09-21.
-- Purpose: authenticated, auditable human review/release actions for the persisted Live Bridge.

alter table if exists public.review_sessions
  add column if not exists reviewer_authorized boolean,
  add column if not exists authorization_level text,
  add column if not exists evidence_checked boolean,
  add column if not exists evidence_refs text[],
  add column if not exists criteria_checked boolean,
  add column if not exists runtime_log_id uuid,
  add column if not exists validation_result_id uuid;

alter table if exists public.review_decisions
  add column if not exists reviewer_id uuid,
  add column if not exists reviewer_authorized boolean,
  add column if not exists authorization_level text,
  add column if not exists evidence_checked boolean,
  add column if not exists evidence_refs text[],
  add column if not exists criteria_checked boolean,
  add column if not exists decided_at timestamptz,
  add column if not exists runtime_log_id uuid,
  add column if not exists validation_result_id uuid;

create table if not exists public.bridge_actor_roles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role_name text not null default 'reviewer',
  active boolean not null default true,
  can_review boolean not null default false,
  can_release boolean not null default false,
  can_revoke boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.bridge_actor_roles enable row level security;
drop policy if exists "read own bridge role" on public.bridge_actor_roles;
create policy "read own bridge role" on public.bridge_actor_roles
  for select to authenticated using (auth.uid() = user_id);

create table if not exists public.bridge_decision_audit (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  record_id uuid not null references public.records(id) on delete cascade,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  action text not null check (action in ('approve_review','reject_review','release','revoke')),
  reason text not null,
  validation_result_id uuid references public.validation_results(id) on delete set null,
  review_record_id uuid references public.review_records(id) on delete set null,
  review_decision_id uuid references public.review_decisions(id) on delete set null,
  release_certificate_id uuid references public.release_certificates(id) on delete set null,
  previous_release_status text,
  new_release_status text,
  details jsonb not null default '{}'::jsonb
);

alter table public.bridge_decision_audit enable row level security;
drop policy if exists "deny direct client access to bridge decision audit" on public.bridge_decision_audit;
create policy "deny direct client access to bridge decision audit" on public.bridge_decision_audit
  for all to anon, authenticated using (false) with check (false);

-- Role assignment is intentionally performed from existing auth users rather than hard-coded IDs.
insert into public.bridge_actor_roles (user_id, role_name, active, can_review, can_release, can_revoke)
select id, 'owner_reviewer', true, true, true, true from auth.users
on conflict (user_id) do update set
  role_name = excluded.role_name,
  active = true,
  can_review = true,
  can_release = true,
  can_revoke = true,
  updated_at = now();

insert into public.review_rules (name, description, active, rule_scope, conditions, required_reviewer_type, required)
select 'PetraPlan live bridge review', 'Authorized human review for the persisted mobile Bridge workflow.', true, 'all', '{}'::jsonb, 'human', true
where not exists (select 1 from public.review_rules where name = 'PetraPlan live bridge review');

insert into public.review_structures (rule_id, name, required_fields, structure_schema)
select r.id, 'PetraPlan live bridge decision',
       array['source_truth_checked','translation_trace_checked','blockers_resolved'],
       jsonb_build_object(
         'source_truth_checked', jsonb_build_object('type','boolean'),
         'translation_trace_checked', jsonb_build_object('type','boolean'),
         'blockers_resolved', jsonb_build_object('type','boolean'))
from public.review_rules r
where r.name = 'PetraPlan live bridge review'
  and not exists (select 1 from public.review_structures s where s.rule_id = r.id and s.name = 'PetraPlan live bridge decision');

insert into public.review_criteria (structure_id, criterion_key, description, required, expected_type)
select s.id, v.criterion_key, v.description, true, 'boolean'
from public.review_structures s
join public.review_rules r on r.id = s.rule_id
cross join (values
  ('source_truth_checked','Source Truth and preserved source evidence were checked.'),
  ('translation_trace_checked','The visible source-to-target translation trace was checked.'),
  ('blockers_resolved','All blocking points required for release are resolved.')
) as v(criterion_key, description)
where r.name = 'PetraPlan live bridge review'
  and s.name = 'PetraPlan live bridge decision'
  and not exists (select 1 from public.review_criteria c where c.structure_id = s.id and c.criterion_key = v.criterion_key);
