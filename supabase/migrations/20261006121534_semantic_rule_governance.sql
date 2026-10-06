-- Case/snapshot-only governance. No executable rule or automatic Claim confirmation.
create table public.semantic_rule_authorities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  record_id uuid not null references public.records(id),
  snapshot_id uuid not null references public.ingestion_logs(id),
  target_address text not null check (length(trim(target_address)) > 0),
  role_name text not null check (length(trim(role_name)) > 0),
  authority_reference text not null check (length(trim(authority_reference)) > 0),
  granted_by uuid not null references auth.users(id),
  granted_at timestamptz not null default clock_timestamp(),
  valid_until timestamptz not null check (valid_until > granted_at)
);
create index semantic_rule_authorities_scope_idx on public.semantic_rule_authorities(user_id,record_id,snapshot_id,target_address);
create table public.semantic_rule_authority_revocations (
  id uuid primary key default gen_random_uuid(),
  authority_id uuid not null unique references public.semantic_rule_authorities(id),
  revoked_by uuid not null references auth.users(id),
  reason text not null check (length(trim(reason)) >= 8),
  revoked_at timestamptz not null default clock_timestamp()
);

create table public.semantic_rule_versions (
  id uuid primary key default gen_random_uuid(),
  rule_id uuid not null,
  version integer not null check (version > 0),
  previous_version_id uuid references public.semantic_rule_versions(id),
  record_id uuid not null references public.records(id),
  snapshot_id uuid not null references public.ingestion_logs(id),
  candidate_id uuid not null references public.conversion_candidates(id),
  claim_id uuid not null references public.claims(id),
  claim_basis text not null check (claim_basis ~ '^[0-9a-f]{64}$'),
  scope_type text not null default 'CASE_ONLY' check (scope_type = 'CASE_ONLY'),
  source_address text not null,
  source_path text not null,
  target_address text not null,
  proposed_value jsonb,
  question text not null check (length(trim(question)) >= 8),
  condition_description text not null check (length(trim(condition_description)) >= 8),
  conclusion_description text not null check (length(trim(conclusion_description)) >= 8),
  justification text not null check (length(trim(justification)) >= 8),
  evidence jsonb not null check (jsonb_typeof(evidence) = 'array'),
  limitations jsonb not null check (jsonb_typeof(limitations) = 'array'),
  exceptions jsonb not null check (jsonb_typeof(exceptions) = 'array'),
  unresolved_items jsonb not null check (jsonb_typeof(unresolved_items) = 'array'),
  proposed_by uuid not null references auth.users(id),
  proposed_at timestamptz not null default clock_timestamp(),
  unique (rule_id, version)
);

create table public.semantic_rule_decisions (
  id uuid primary key default gen_random_uuid(),
  rule_version_id uuid not null references public.semantic_rule_versions(id),
  sequence bigint generated always as identity unique,
  decision text not null check (decision in ('APPROVED', 'REJECTED', 'REVOKED', 'SUPERSEDED')),
  actor_id uuid not null references auth.users(id),
  authority_id uuid not null references public.semantic_rule_authorities(id),
  reason text not null check (length(trim(reason)) >= 8),
  criteria jsonb not null default '{}'::jsonb,
  source text not null default 'review' check (source in ('review','authority_revocation')),
  decided_at timestamptz not null default clock_timestamp()
);
create index semantic_rule_versions_record_idx on public.semantic_rule_versions(record_id, proposed_at);
create index semantic_rule_decisions_version_idx on public.semantic_rule_decisions(rule_version_id, sequence desc);

alter table public.semantic_rule_authorities enable row level security;
alter table public.semantic_rule_authority_revocations enable row level security;
alter table public.semantic_rule_versions enable row level security;
alter table public.semantic_rule_decisions enable row level security;
revoke all on public.semantic_rule_authorities, public.semantic_rule_authority_revocations, public.semantic_rule_versions, public.semantic_rule_decisions from public, anon, authenticated, service_role;
grant select on public.semantic_rule_authorities, public.semantic_rule_authority_revocations to service_role;
grant select, insert on public.semantic_rule_versions, public.semantic_rule_decisions to service_role;
revoke all on sequence public.semantic_rule_decisions_sequence_seq from public,anon,authenticated,service_role;
grant usage, select on sequence public.semantic_rule_decisions_sequence_seq to service_role;

create function public.bridge_semantic_rule_immutable()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  raise sqlstate 'PT409' using message = 'Rule definitions, authority grants and decisions are immutable; append a new version or decision';
end;
$$;
create trigger semantic_rule_versions_immutable before update or delete on public.semantic_rule_versions
for each row execute function public.bridge_semantic_rule_immutable();
create trigger semantic_rule_decisions_immutable before update or delete on public.semantic_rule_decisions
for each row execute function public.bridge_semantic_rule_immutable();
create trigger semantic_rule_authorities_immutable before update or delete on public.semantic_rule_authorities
for each row execute function public.bridge_semantic_rule_immutable();
create trigger semantic_rule_authority_revocations_immutable before update or delete on public.semantic_rule_authority_revocations
for each row execute function public.bridge_semantic_rule_immutable();

create function public.bridge_semantic_rule_status(p_version_id uuid)
returns text language sql stable security invoker set search_path = '' as $$
  select coalesce((select decision from public.semantic_rule_decisions
    where rule_version_id = p_version_id order by sequence desc limit 1), 'PROPOSED');
$$;
create function public.bridge_semantic_claim_basis(p_claim_id uuid)
returns text language sql stable security invoker set search_path = '' as $$
  select encode(sha256(convert_to(jsonb_build_object(
    'id',id,'statement',statement,'claim_type',claim_type,'subject',subject_address,
    'predicate',predicate,'object_value',object_value,'scope_type',scope_type,'scope_payload',scope_payload,
    'record_id',record_id,'snapshot_id',snapshot_id,'candidate_id',candidate_id,
    'evidence',coalesce((select jsonb_agg(to_jsonb(e) order by e.id) from public.claim_evidence_links e where e.claim_id = c.id),'[]'::jsonb))::text,'UTF8')),'hex')
  from public.claims c where id = p_claim_id;
$$;

-- Recheck role, snapshot, target and Claim before storing a proposal, including
-- direct service inserts. Freeze the identities/value from the actual candidate.
create function public.bridge_guard_semantic_rule_version()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare v_candidate public.conversion_candidates%rowtype; v_claim public.claims%rowtype;
  v_previous public.semantic_rule_versions%rowtype; v_snapshot uuid; v_source text;
begin
  perform 1 from public.records where id = new.record_id for update;
  select ingestion_log_id into v_snapshot from public.records where id = new.record_id;
  if v_snapshot is distinct from new.snapshot_id or not exists (
    select 1 from public.ingestion_logs where id = new.snapshot_id and status = 'processed') then
    raise sqlstate 'PT409' using message = 'Rule requires the current processed case snapshot';
  end if;
  if not exists (select 1 from public.bridge_actor_roles where user_id = new.proposed_by and active and can_review) then
    raise sqlstate 'PT403' using message = 'Rule proposal requires an active reviewer';
  end if;
  select * into v_candidate from public.conversion_candidates where id = new.candidate_id;
  select * into v_claim from public.claims where id = new.claim_id;
  if v_candidate.id is null or v_claim.id is null or v_candidate.record_id is distinct from new.record_id
    or v_candidate.snapshot_id is distinct from new.snapshot_id or v_candidate.state <> 'confirmed'
    or v_claim.record_id is distinct from new.record_id or v_claim.snapshot_id is distinct from new.snapshot_id
    or v_claim.candidate_id is distinct from new.candidate_id or v_claim.scope_type <> 'CASE_ONLY'
    or v_claim.status in ('REJECTED', 'SUPERSEDED')
    or not (v_claim.scope_payload @> jsonb_build_object('record_id',new.record_id,'snapshot_id',new.snapshot_id,'candidate_id',new.candidate_id)) then
    raise sqlstate 'PT409' using message = 'Rule must reference an active case Claim and its confirmed candidate in the same snapshot';
  end if;
  if v_claim.claim_type not in ('SEMANTIC', 'SEMANTIC_MAPPING', 'MAPPING', 'AGGREGATION') then
    raise sqlstate 'PT409' using message = 'Rule requires a semantic or aggregation Claim';
  end if;
  select address into v_source from public.address_registry where id = v_candidate.source_address_id;
  if v_source is null then raise sqlstate 'PT409' using message = 'Rule source address is missing'; end if;
  new.source_address := v_source;
  new.source_path := v_candidate.source_path;
  new.target_address := v_claim.subject_address;
  new.proposed_value := v_candidate.proposed_value;
  new.claim_basis := public.bridge_semantic_claim_basis(new.claim_id);
  if new.previous_version_id is null then
    if new.version <> 1 or exists(select 1 from public.semantic_rule_versions where rule_id = new.rule_id) then
      raise sqlstate 'PT409' using message = 'A new rule family must start at version 1';
    end if;
  else
    select * into v_previous from public.semantic_rule_versions where id = new.previous_version_id;
    if v_previous.id is null or v_previous.rule_id <> new.rule_id or v_previous.record_id <> new.record_id
      or v_previous.snapshot_id <> new.snapshot_id or v_previous.candidate_id <> new.candidate_id
      or v_previous.claim_id <> new.claim_id or v_previous.target_address is distinct from new.target_address
      or v_previous.source_address is distinct from new.source_address or v_previous.source_path is distinct from new.source_path
      or new.version <> v_previous.version + 1
      or exists(select 1 from public.semantic_rule_versions where rule_id = new.rule_id and version > v_previous.version) then
      raise sqlstate 'PT409' using message = 'Revision must append to the latest version in the same scope';
    end if;
  end if;
  if exists(select 1 from jsonb_array_elements(new.evidence) e
    where jsonb_typeof(e) <> 'object' or coalesce(e->>'kind','') not in ('SOURCE','MEANING','AUTHORITY')
      or length(trim(coalesce(e->>'reference',''))) = 0 or length(trim(coalesce(e->>'summary',''))) < 8) then
    raise sqlstate 'PT400' using message = 'Evidence needs kind, reference and an explanatory summary';
  end if;
  if exists(select 1 from jsonb_array_elements(new.unresolved_items || new.limitations || new.exceptions) e
    where jsonb_typeof(e) <> 'string' or length(trim(e #>> '{}')) = 0) then
    raise sqlstate 'PT400' using message = 'Open questions, limitations and exceptions must be nonempty text items';
  end if;
  return new;
end;
$$;
create trigger semantic_rule_version_guard before insert on public.semantic_rule_versions
for each row execute function public.bridge_guard_semantic_rule_version();

create function public.bridge_guard_semantic_rule_decision()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare v_rule public.semantic_rule_versions%rowtype; v_authority public.semantic_rule_authorities%rowtype;
  v_status text; v_snapshot uuid;
begin
  select * into v_rule from public.semantic_rule_versions where id = new.rule_version_id;
  if v_rule.id is null then raise sqlstate 'PT404' using message = 'Rule version not found'; end if;
  perform 1 from public.records where id = v_rule.record_id for update;
  v_status := public.bridge_semantic_rule_status(v_rule.id);
  -- Only a persisted administrator-side revocation may generate this event.
  -- The public RPC has no parameter for source and cannot mint it.
  if new.source = 'authority_revocation' then
    if new.decision <> 'REVOKED' or v_status <> 'APPROVED' or not exists (
      select 1 from public.semantic_rule_authority_revocations ar
      join public.semantic_rule_decisions d on d.authority_id = ar.authority_id
      where ar.authority_id = new.authority_id and ar.revoked_by = new.actor_id
        and ar.reason = new.reason and d.rule_version_id = v_rule.id and d.decision = 'APPROVED'
        and d.sequence = (select max(sequence) from public.semantic_rule_decisions where rule_version_id = v_rule.id)) then
      raise sqlstate 'PT403' using message = 'Automatic authority revocation requires its persisted administrator event';
    end if;
    return new;
  end if;
  if not exists(select 1 from public.bridge_actor_roles where user_id = new.actor_id and active and can_review) then
    raise sqlstate 'PT403' using message = 'Rule decision requires an active reviewer';
  end if;
  select * into v_authority from public.semantic_rule_authorities where id = new.authority_id;
  if v_authority.id is null or v_authority.user_id <> new.actor_id or v_authority.record_id <> v_rule.record_id
    or v_authority.snapshot_id <> v_rule.snapshot_id or v_authority.target_address <> v_rule.target_address
    or v_authority.granted_at > clock_timestamp() or v_authority.valid_until <= clock_timestamp()
    or exists(select 1 from public.semantic_rule_authority_revocations where authority_id = v_authority.id) then
    raise sqlstate 'PT403' using message = 'Documented semantic authority for this case, snapshot and target is required';
  end if;
  v_status := public.bridge_semantic_rule_status(v_rule.id);
  if not ((v_status = 'PROPOSED' and new.decision in ('APPROVED','REJECTED'))
    or (v_status = 'APPROVED' and new.decision in ('REVOKED','SUPERSEDED'))) then
    raise sqlstate 'PT409' using message = 'This rule decision is terminal; append a new rule version';
  end if;
  if new.decision = 'APPROVED' then
    select ingestion_log_id into v_snapshot from public.records where id = v_rule.record_id;
    if v_snapshot is distinct from v_rule.snapshot_id then raise sqlstate 'PT409' using message = 'Rule snapshot is no longer current'; end if;
    if not exists(select 1 from public.conversion_candidates c join public.claims cl on cl.id = v_rule.claim_id
      where c.id = v_rule.candidate_id and c.state = 'confirmed' and c.record_id = v_rule.record_id
      and c.snapshot_id = v_rule.snapshot_id and c.source_path = v_rule.source_path
      and c.proposed_value is not distinct from v_rule.proposed_value
      and cl.record_id = v_rule.record_id and cl.snapshot_id = v_rule.snapshot_id
      and cl.candidate_id = c.id and cl.subject_address = v_rule.target_address
      and cl.status not in ('REJECTED','SUPERSEDED')
      and public.bridge_semantic_claim_basis(cl.id) = v_rule.claim_basis) then
      raise sqlstate 'PT409' using message = 'The candidate or Claim basis changed after the proposal';
    end if;
    if jsonb_array_length(v_rule.unresolved_items) > 0 then raise sqlstate 'PT409' using message = 'Open semantic questions prevent approval'; end if;
    if not exists(select 1 from jsonb_array_elements(v_rule.evidence) e where e->>'kind' = 'MEANING') then
      raise sqlstate 'PT409' using message = 'Source values alone are not meaning evidence';
    end if;
    if not (new.criteria @> '{"identities_checked":true,"meaning_evidence_checked":true,"source_coverage_checked":true,"counterexamples_checked":true,"scope_checked":true}'::jsonb) then
      raise sqlstate 'PT409' using message = 'All semantic review criteria require explicit confirmation';
    end if;
    if exists(select 1 from public.semantic_rule_versions r where r.rule_id = v_rule.rule_id and r.version > v_rule.version) then
      raise sqlstate 'PT409' using message = 'Only the latest version may be approved';
    end if;
    if exists(select 1 from public.semantic_rule_versions r where r.id <> v_rule.id
      and (r.rule_id = v_rule.rule_id or (r.candidate_id = v_rule.candidate_id and r.target_address = v_rule.target_address))
      and public.bridge_semantic_rule_status(r.id) = 'APPROVED') then
      raise sqlstate 'PT409' using message = 'Revoke or supersede the currently approved rule before approving another version';
    end if;
  end if;
  return new;
end;
$$;
create trigger semantic_rule_decision_guard before insert on public.semantic_rule_decisions
for each row execute function public.bridge_guard_semantic_rule_decision();

-- Negative decisions add a qualifying Evidence event to every explicitly
-- rule-bound Claim. Existing claim/evidence triggers change the basis and revoke
-- usable Releases atomically. This never confirms or rewrites a Claim statement.
create function public.bridge_semantic_rule_negative_impact()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare v_rule public.semantic_rule_versions%rowtype; v_claim public.claims%rowtype;
begin
  if new.decision not in ('REVOKED','SUPERSEDED') then return new; end if;
  select * into v_rule from public.semantic_rule_versions where id = new.rule_version_id;
  for v_claim in select * from public.claims
    where rule_id = v_rule.rule_id::text and rule_version = v_rule.version::text order by record_id, id
  loop
    insert into public.claim_evidence_links
      (claim_id,evidence_type,evidence_reference,relation,directness,scope,linked_by,note)
    values(v_claim.id,'SEMANTIC_RULE_DECISION','semantic_rule_decision:' || new.id::text,'QUALIFIES','DIRECT',
      jsonb_build_object('record_id',v_claim.record_id,'snapshot_id',v_claim.snapshot_id,
        'rule_id',v_rule.rule_id,'rule_version',v_rule.version),new.actor_id::text,
      'Rule ' || new.decision || ': ' || new.reason);
  end loop;
  return new;
end;
$$;
create trigger semantic_rule_negative_impact after insert on public.semantic_rule_decisions
for each row execute function public.bridge_semantic_rule_negative_impact();

create function public.bridge_semantic_authority_negative_impact()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare v_rule public.semantic_rule_versions%rowtype;
begin
  for v_rule in select r.* from public.semantic_rule_versions r
    join public.semantic_rule_decisions d on d.rule_version_id = r.id
    where d.authority_id = new.authority_id and d.decision = 'APPROVED'
      and d.sequence = (select max(sequence) from public.semantic_rule_decisions where rule_version_id = r.id)
    order by r.record_id, r.id
  loop
    insert into public.semantic_rule_decisions(rule_version_id,actor_id,authority_id,decision,reason,source)
      values(v_rule.id,new.revoked_by,new.authority_id,'REVOKED',new.reason,'authority_revocation');
  end loop;
  return new;
end;
$$;
create trigger semantic_authority_negative_impact after insert on public.semantic_rule_authority_revocations
for each row execute function public.bridge_semantic_authority_negative_impact();

create function public.bridge_propose_semantic_rule(p_record_id uuid,p_claim_id uuid,p_actor_id uuid,p_definition jsonb,p_previous_version_id uuid default null)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_claim public.claims%rowtype; v_previous public.semantic_rule_versions%rowtype; v_rule public.semantic_rule_versions%rowtype;
begin
  perform 1 from public.records where id = p_record_id for update;
  select * into v_claim from public.claims where id = p_claim_id and record_id = p_record_id;
  if v_claim.id is null then raise sqlstate 'PT404' using message = 'Case Claim not found'; end if;
  if p_previous_version_id is not null then
    select * into v_previous from public.semantic_rule_versions where id = p_previous_version_id and record_id = p_record_id;
    if v_previous.id is null then raise sqlstate 'PT404' using message = 'Previous version not found in this case'; end if;
  end if;
  insert into public.semantic_rule_versions
    (rule_id,version,previous_version_id,record_id,snapshot_id,candidate_id,claim_id,claim_basis,source_address,source_path,target_address,
      question,condition_description,conclusion_description,justification,evidence,limitations,exceptions,unresolved_items,proposed_by)
  values(coalesce(v_previous.rule_id,gen_random_uuid()),coalesce(v_previous.version + 1,1),p_previous_version_id,
    p_record_id,v_claim.snapshot_id,v_claim.candidate_id,p_claim_id,'server-derived','server-derived','server-derived','server-derived',
    p_definition->>'question',p_definition->>'condition',p_definition->>'conclusion',p_definition->>'justification',
    coalesce(p_definition->'evidence','[]'),coalesce(p_definition->'limitations','[]'),
    coalesce(p_definition->'exceptions','[]'),coalesce(p_definition->'unresolved_items','[]'),p_actor_id)
  returning * into v_rule;
  return to_jsonb(v_rule) || jsonb_build_object('status','PROPOSED');
end;
$$;

create function public.bridge_decide_semantic_rule(p_record_id uuid,p_version_id uuid,p_actor_id uuid,p_authority_id uuid,p_decision text,p_reason text,p_criteria jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_decision public.semantic_rule_decisions%rowtype;
begin
  perform 1 from public.records where id = p_record_id for update;
  if not exists(select 1 from public.semantic_rule_versions where id = p_version_id and record_id = p_record_id) then
    raise sqlstate 'PT404' using message = 'Rule version not found in this case';
  end if;
  insert into public.semantic_rule_decisions(rule_version_id,actor_id,authority_id,decision,reason,criteria)
    values(p_version_id,p_actor_id,p_authority_id,p_decision,p_reason,coalesce(p_criteria,'{}')) returning * into v_decision;
  return to_jsonb(v_decision);
end;
$$;

-- Server only. Browser callers cannot supply an Actor or assign themselves authority.
revoke all on function public.bridge_semantic_rule_immutable(),public.bridge_semantic_rule_status(uuid),public.bridge_semantic_claim_basis(uuid),
  public.bridge_guard_semantic_rule_version(),public.bridge_guard_semantic_rule_decision(),public.bridge_semantic_rule_negative_impact(),public.bridge_semantic_authority_negative_impact(),
  public.bridge_propose_semantic_rule(uuid,uuid,uuid,jsonb,uuid),public.bridge_decide_semantic_rule(uuid,uuid,uuid,uuid,text,text,jsonb)
  from public,anon,authenticated;
grant execute on function public.bridge_semantic_rule_immutable(),public.bridge_semantic_rule_status(uuid),public.bridge_semantic_claim_basis(uuid),
  public.bridge_guard_semantic_rule_version(),public.bridge_guard_semantic_rule_decision(),public.bridge_semantic_rule_negative_impact(),public.bridge_semantic_authority_negative_impact(),
  public.bridge_propose_semantic_rule(uuid,uuid,uuid,jsonb,uuid),public.bridge_decide_semantic_rule(uuid,uuid,uuid,uuid,text,text,jsonb)
  to service_role;
