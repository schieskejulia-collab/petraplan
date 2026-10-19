-- Planning/reviewer observations only. No automatic semantic acceptance or release.
create table public.claim_check_requirements (
 id uuid primary key default gen_random_uuid(),
 record_id uuid not null references public.records(id),
 snapshot_id uuid not null references public.ingestion_logs(id),
 claim_id uuid not null references public.claims(id),
 claim_basis text not null check (claim_basis ~ '^[0-9a-f]{64}$'),
 previous_requirement_id uuid unique references public.claim_check_requirements(id),
 question text not null check (length(trim(question)) >= 8),
 required_information text not null check (length(trim(required_information)) >= 8),
 required_address text not null check (length(trim(required_address)) > 0),
 check_condition text not null check (length(trim(check_condition)) >= 8),
 counter_condition text not null check (length(trim(counter_condition)) >= 8),
 coverage_requirement text not null check (length(trim(coverage_requirement)) >= 8),
 absence_policy text not null default 'UNKNOWN' check (absence_policy = 'UNKNOWN'),
 next_check text not null check (length(trim(next_check)) >= 8),
 created_by uuid not null references auth.users(id),
 created_at timestamptz not null default clock_timestamp()
);
create table public.claim_check_observations (
 id uuid primary key default gen_random_uuid(),
 requirement_id uuid not null references public.claim_check_requirements(id),
 sequence bigint generated always as identity unique,
 representation_evidence_id uuid references public.representation_evidence(id),
 evidence_snapshot jsonb,
 result text not null check (result in ('MISSING','UNKNOWN','SUPPORTS','CONTRADICTS')),
 coverage_status text not null check (coverage_status in ('UNKNOWN','INCOMPLETE','COMPLETE')),
 coverage_reference text,
 reason text not null check (length(trim(reason)) >= 8),
 recorded_by uuid not null references auth.users(id),
 recorded_at timestamptz not null default clock_timestamp(),
 check (result not in ('SUPPORTS','CONTRADICTS') or representation_evidence_id is not null),
 check (coverage_status <> 'COMPLETE' or length(trim(coverage_reference)) > 0 and coverage_reference is not null)
);
create index claim_check_requirements_case_idx on public.claim_check_requirements(record_id,created_at);
create index claim_check_observations_requirement_idx on public.claim_check_observations(requirement_id,sequence desc);
alter table public.claim_check_requirements enable row level security;
alter table public.claim_check_observations enable row level security;
revoke all on public.claim_check_requirements,public.claim_check_observations from public,anon,authenticated,service_role;
grant select,insert on public.claim_check_requirements,public.claim_check_observations to service_role;
revoke all on sequence public.claim_check_observations_sequence_seq from public,anon,authenticated,service_role;
grant usage,select on sequence public.claim_check_observations_sequence_seq to service_role;
create trigger claim_check_requirements_immutable before update or delete on public.claim_check_requirements
 for each row execute function public.bridge_semantic_rule_immutable();
create trigger claim_check_observations_immutable before update or delete on public.claim_check_observations
 for each row execute function public.bridge_semantic_rule_immutable();

create function public.bridge_guard_claim_check()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare c public.claims%rowtype; r public.claim_check_requirements%rowtype;
 e public.representation_evidence%rowtype; v_actor uuid; v_record uuid; v_snapshot uuid;
begin
 if tg_table_name = 'claim_check_requirements' then
  select * into c from public.claims where id=new.claim_id;
  if not found then raise sqlstate 'PT404' using message='Claim not found'; end if;
  v_actor:=new.created_by; v_record:=new.record_id; v_snapshot:=new.snapshot_id;
 else
  select * into r from public.claim_check_requirements where id=new.requirement_id;
  if not found then raise sqlstate 'PT404' using message='Requirement not found'; end if;
  select * into c from public.claims where id=r.claim_id;
  v_actor:=new.recorded_by; v_record:=r.record_id; v_snapshot:=r.snapshot_id;
 end if;
 perform 1 from public.records where id=v_record for update;
 if not exists(select 1 from public.bridge_actor_roles where user_id=v_actor and active and can_review) then
  raise sqlstate 'PT403' using message='Active review permission required'; end if;
 if c.record_id is distinct from v_record or c.snapshot_id is distinct from v_snapshot
  or not exists(select 1 from public.records where id=v_record and ingestion_log_id=v_snapshot)
  or not exists(select 1 from public.ingestion_logs where id=v_snapshot and status='processed') then
  raise sqlstate 'PT409' using message='Current case and processed snapshot required'; end if;
 if c.scope_type<>'CASE_ONLY' then raise sqlstate 'PT409' using message='Only CASE_ONLY check planning is supported'; end if;
 if c.status not in ('DRAFT','UNPROVEN','SUPPORTED','CONFIRMED','CONTESTED') then
  raise sqlstate 'PT409' using message='Inactive Claim cannot receive a current check'; end if;
 if tg_table_name = 'claim_check_requirements' then
  new.claim_basis:=public.bridge_semantic_claim_basis(c.id);
  if new.previous_requirement_id is not null then
   select * into r from public.claim_check_requirements where id=new.previous_requirement_id;
   if not found or r.claim_id<>c.id or r.record_id<>v_record or r.snapshot_id<>v_snapshot then
    raise sqlstate 'PT409' using message='Revision must retain Claim, case and snapshot'; end if;
  end if;
 else
  if r.claim_basis is distinct from public.bridge_semantic_claim_basis(c.id)
   or exists(select 1 from public.claim_check_requirements where previous_requirement_id=r.id) then
   raise sqlstate 'PT409' using message='Requirement basis changed or requirement superseded'; end if;
  if new.representation_evidence_id is not null then
   select * into e from public.representation_evidence where id=new.representation_evidence_id;
   if not found or e.record_id<>v_record or e.ingestion_log_id<>v_snapshot or e.field_address<>r.required_address then
    raise sqlstate 'PT409' using message='Evidence must match exact case, snapshot and required field address'; end if;
   new.evidence_snapshot:=to_jsonb(e);
   if new.result='MISSING' then raise sqlstate 'PT409' using message='Existing field evidence cannot be labelled missing'; end if;
  end if;
  if new.representation_evidence_id is null then new.evidence_snapshot:=null; end if;
  if new.result='SUPPORTS' and new.coverage_status<>'COMPLETE' then
   raise sqlstate 'PT409' using message='Support requires documented complete coverage; otherwise record UNKNOWN'; end if;
 end if;
 return new;
end;
$$;
create trigger claim_check_requirement_guard before insert on public.claim_check_requirements
 for each row execute function public.bridge_guard_claim_check();
create trigger claim_check_observation_guard before insert on public.claim_check_observations
 for each row execute function public.bridge_guard_claim_check();

create function public.bridge_add_claim_check(p_record_id uuid,p_claim_id uuid,p_actor_id uuid,p_definition jsonb,p_previous_id uuid default null)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare c public.claims%rowtype; r public.claim_check_requirements%rowtype;
begin
 select * into c from public.claims where id=p_claim_id;
 if not found then raise sqlstate 'PT404' using message='Claim not found'; end if;
 insert into public.claim_check_requirements(record_id,snapshot_id,claim_id,claim_basis,previous_requirement_id,
 question,required_information,required_address,check_condition,counter_condition,coverage_requirement,next_check,created_by)
 values(p_record_id,c.snapshot_id,p_claim_id,'',p_previous_id,p_definition->>'question',p_definition->>'required_information',
 p_definition->>'required_address',p_definition->>'check_condition',p_definition->>'counter_condition',
 p_definition->>'coverage_requirement',p_definition->>'next_check',p_actor_id) returning * into r;
 return to_jsonb(r);
end;
$$;
create function public.bridge_record_claim_check(p_record_id uuid,p_requirement_id uuid,p_actor_id uuid,p_observation jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare o public.claim_check_observations%rowtype;
begin
 if not exists(select 1 from public.claim_check_requirements where id=p_requirement_id and record_id=p_record_id) then
  raise sqlstate 'PT404' using message='Requirement not found in this case'; end if;
 insert into public.claim_check_observations(requirement_id,representation_evidence_id,result,coverage_status,coverage_reference,reason,recorded_by)
 values(p_requirement_id,nullif(p_observation->>'representation_evidence_id','')::uuid,p_observation->>'result',
 p_observation->>'coverage_status',p_observation->>'coverage_reference',p_observation->>'reason',p_actor_id) returning * into o;
 return to_jsonb(o);
end;
$$;
revoke all on function public.bridge_guard_claim_check(),public.bridge_add_claim_check(uuid,uuid,uuid,jsonb,uuid),
 public.bridge_record_claim_check(uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.bridge_guard_claim_check(),public.bridge_add_claim_check(uuid,uuid,uuid,jsonb,uuid),
 public.bridge_record_claim_check(uuid,uuid,uuid,jsonb) to service_role;
comment on table public.claim_check_observations is 'Reviewer-reported checks, not accepted facts. No Claim, Validation, Review or Release mutation. Completeness references require separate verification before execution.';
