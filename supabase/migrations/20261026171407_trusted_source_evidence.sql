-- Development only: explicit source trust, byte verification and scoped human
-- meaning attestations. No source/authority seed and no positive validation or
-- release path. Requires the existing governed rule and Claim schema.

create table public.trusted_evidence_sources (
 id uuid primary key default gen_random_uuid(),
 source_key text not null check(length(btrim(source_key))>0),
 revision integer not null check(revision>0),
 source_url text not null check(source_url ~ '^https://[^/]+/'),
 version_reference text not null check(length(btrim(version_reference))>0),
 authority_reference text not null check(length(btrim(authority_reference))>0),
 expected_sha256 text not null check(expected_sha256 ~ '^[0-9a-f]{64}$'),
 media_type text not null check(media_type in ('text/plain','text/markdown','application/json','application/xml','text/xml')),
 max_bytes integer not null default 1048576 check(max_bytes between 1 and 2097152),
 max_age_seconds integer not null default 3600 check(max_age_seconds between 1 and 86400),
 registered_by uuid not null references auth.users(id),
 valid_from timestamptz not null default clock_timestamp(),
 valid_until timestamptz not null,
 check(valid_until>valid_from),unique(source_key,revision)
);
create table public.source_verification_records (
 id uuid primary key default gen_random_uuid(),
 source_id uuid not null references public.trusted_evidence_sources,
 record_id uuid not null references public.records,
 snapshot_id uuid not null references public.ingestion_logs,
 claim_id uuid not null references public.claims,
 rule_version_id uuid not null references public.semantic_rule_versions,
 claim_basis text not null check(claim_basis ~ '^[0-9a-f]{64}$'),
 snapshot_hash text not null,
 source_url text not null,
 content_bytes bytea not null check(octet_length(content_bytes) between 1 and 2097152),
 content_sha256 text not null check(content_sha256 ~ '^[0-9a-f]{64}$'),
 media_type text not null,
 resolved_address inet not null,
 tls_peer_sha256 text not null check(tls_peer_sha256 ~ '^[0-9a-f]{64}$'),
 verified_by uuid not null references auth.users,
 retrieval_started_at timestamptz not null,
 verified_at timestamptz not null default clock_timestamp()
);
create index source_verification_scope on public.source_verification_records(record_id,rule_version_id,claim_basis);
create table public.semantic_evidence_assessments (
 id uuid primary key default gen_random_uuid(),
 verification_id uuid not null references public.source_verification_records,
 record_id uuid not null references public.records,
 snapshot_id uuid not null references public.ingestion_logs,
 claim_id uuid not null references public.claims,
 rule_version_id uuid not null references public.semantic_rule_versions,
 claim_basis text not null,
 authority_id uuid not null references public.semantic_rule_authorities,
 assessed_by uuid not null references auth.users,
 decision text not null check(decision in ('SUPPORTS','CONTRADICTS','INSUFFICIENT')),
 reason text not null check(length(btrim(reason))>=8),
 coverage text not null check(coverage in ('COMPLETE','PARTIAL','UNKNOWN')),
 coverage_reason text not null check(length(btrim(coverage_reason))>=8),
 anchor jsonb not null check(jsonb_typeof(anchor)='object'),
 criteria jsonb not null check(jsonb_typeof(criteria)='object'),
 assessed_at timestamptz not null default clock_timestamp(),
 unique(verification_id,assessed_by)
);
create index semantic_evidence_scope on public.semantic_evidence_assessments(record_id,rule_version_id,claim_basis);
create table public.evidence_withdrawals (
 id uuid primary key default gen_random_uuid(),
 source_id uuid unique references public.trusted_evidence_sources,
 verification_id uuid unique references public.source_verification_records,
 assessment_id uuid unique references public.semantic_evidence_assessments,
 authority_id uuid references public.semantic_rule_authorities,
 withdrawn_by uuid not null references auth.users,
 reason text not null check(length(btrim(reason))>=8),
 withdrawn_at timestamptz not null default clock_timestamp(),
 check(num_nonnulls(source_id,verification_id,assessment_id)=1)
);

alter table public.trusted_evidence_sources enable row level security;
alter table public.source_verification_records enable row level security;
alter table public.semantic_evidence_assessments enable row level security;
alter table public.evidence_withdrawals enable row level security;
revoke all on public.trusted_evidence_sources,public.source_verification_records,public.semantic_evidence_assessments,public.evidence_withdrawals from public,anon,authenticated,service_role;
-- Source trust is provisioned administratively, never by an end-user API.
grant select on public.trusted_evidence_sources to service_role;
grant select,insert on public.source_verification_records,public.semantic_evidence_assessments,public.evidence_withdrawals to service_role;

create function public.bridge_evidence_immutable() returns trigger
language plpgsql security invoker set search_path='' as $$
begin raise sqlstate 'PT409' using message='Evidence identities, bytes and decisions are append-only; record an explicit withdrawal'; end;
$$;
do $$ declare t text; begin
 foreach t in array array['trusted_evidence_sources','source_verification_records','semantic_evidence_assessments','evidence_withdrawals'] loop
  execute format('create trigger evidence_append_only before update or delete on public.%I for each row execute function public.bridge_evidence_immutable()',t);
  execute format('create trigger evidence_no_truncate before truncate on public.%I for each statement execute function public.bridge_evidence_immutable()',t);
 end loop;
end $$;

-- Lock order for this subsystem: source -> authority (if applicable) ->
-- technical role -> case. Advisory root locks preserve the existing SELECT-only
-- authority/source grants. Withdrawal paths use the same lock namespace/order.
create function public.bridge_guard_source_verification() returns trigger
language plpgsql security invoker set search_path='' as $$
declare s public.trusted_evidence_sources%rowtype; r public.semantic_rule_versions%rowtype;
 snap public.ingestion_logs%rowtype; current_snapshot uuid; at_time timestamptz;
begin
 perform pg_advisory_xact_lock_shared(hashtextextended('petraplan:evidence:source:'||new.source_id::text,0));
 select * into s from public.trusted_evidence_sources where id=new.source_id;
 if not found then raise sqlstate 'PT404' using message='Trusted source version not found'; end if;
 perform 1 from public.bridge_actor_roles where user_id=new.verified_by and active and can_review for share;
 if not found then raise sqlstate 'PT403' using message='An authenticated technical reviewer is required'; end if;
 select ingestion_log_id into current_snapshot from public.records where id=new.record_id for update;
 if not found or current_snapshot is distinct from new.snapshot_id then raise sqlstate 'PT409' using message='Verification snapshot changed'; end if;
 select * into snap from public.ingestion_logs where id=new.snapshot_id and status='processed' for share;
 if not found then raise sqlstate 'PT409' using message='A processed source snapshot is required'; end if;
 select * into r from public.semantic_rule_versions where id=new.rule_version_id;
 if not found or r.record_id is distinct from new.record_id or r.snapshot_id is distinct from new.snapshot_id
   or r.claim_id is distinct from new.claim_id or r.claim_basis is distinct from public.bridge_semantic_claim_basis(new.claim_id)
   or not exists(select 1 from public.claims where id=new.claim_id and record_id=new.record_id and snapshot_id=new.snapshot_id and status not in ('SUPERSEDED','REJECTED')) then
  raise sqlstate 'PT409' using message='Verification must bind the current rule, Claim and case snapshot';
 end if;
 at_time:=clock_timestamp();
 if s.valid_from>new.retrieval_started_at or s.valid_until<=at_time
   or new.retrieval_started_at<at_time-interval '60 seconds' or new.retrieval_started_at>at_time+interval '5 seconds'
   or exists(select 1 from public.evidence_withdrawals where source_id=s.id) then
  raise sqlstate 'PT409' using message='Trusted source version was withdrawn, expired or was not read recently';
 end if;
 if new.media_type is distinct from s.media_type or octet_length(new.content_bytes)>s.max_bytes
   or encode(sha256(new.content_bytes),'hex') is distinct from s.expected_sha256 then
  raise sqlstate 'PT409' using message='Actual retrieved bytes or media type do not match the registered source version';
 end if;
 -- UTF-8 text is required for byte-exact human-review anchors in this version.
 perform convert_from(new.content_bytes,'UTF8');
 new.content_sha256:=encode(sha256(new.content_bytes),'hex');
 new.source_url:=s.source_url;new.claim_basis:=r.claim_basis;new.snapshot_hash:=snap.source_hash;new.verified_at:=at_time;
 return new;
end;
$$;
create trigger source_verification_guard before insert on public.source_verification_records
for each row execute function public.bridge_guard_source_verification();

create function public.bridge_record_source_verification(
 p_source_id uuid,p_record_id uuid,p_snapshot_id uuid,p_rule_version_id uuid,p_actor_id uuid,
 p_content_hex text,p_media_type text,p_resolved_address inet,p_tls_peer_sha256 text,p_retrieval_started_at timestamptz
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_id uuid; v_claim uuid;
begin
 if p_content_hex is null or length(p_content_hex)>4194304 or p_content_hex !~ '^([0-9a-f]{2})+$' then
  raise sqlstate 'PT400' using message='Exact nonempty source bytes are required';
 end if;
 select claim_id into v_claim from public.semantic_rule_versions where id=p_rule_version_id;
 insert into public.source_verification_records(source_id,record_id,snapshot_id,claim_id,rule_version_id,verified_by,
  content_bytes,media_type,resolved_address,tls_peer_sha256,retrieval_started_at)
 values(p_source_id,p_record_id,p_snapshot_id,v_claim,p_rule_version_id,p_actor_id,decode(p_content_hex,'hex'),
  p_media_type,p_resolved_address,p_tls_peer_sha256,p_retrieval_started_at) returning id into v_id;
 return jsonb_build_object('verification_id',v_id,'meaning_confirmed',false,'validation_allowed',false,'release_allowed',false);
end;
$$;

create function public.bridge_evidence_rule_authority_current(p_rule_version_id uuid,p_at_time timestamptz)
returns boolean language sql stable security invoker set search_path='' as $$
 select exists(select 1 from public.semantic_rule_versions r
  join public.semantic_rule_decisions d on d.rule_version_id=r.id
  join public.semantic_rule_authorities a on a.id=d.authority_id
  where r.id=p_rule_version_id and d.sequence=(select max(sequence) from public.semantic_rule_decisions where rule_version_id=r.id)
   and d.decision='APPROVED' and a.user_id=d.actor_id and a.record_id=r.record_id and a.snapshot_id=r.snapshot_id
   and a.target_address=r.target_address and a.granted_at<=p_at_time and a.valid_until>p_at_time
   and not exists(select 1 from public.semantic_rule_authority_revocations where authority_id=a.id));
$$;

create function public.bridge_guard_evidence_assessment() returns trigger
language plpgsql security invoker set search_path='' as $$
declare v public.source_verification_records%rowtype; s public.trusted_evidence_sources%rowtype;
 a public.semantic_rule_authorities%rowtype; r public.semantic_rule_versions%rowtype;
 start_byte integer; end_byte integer; excerpt text; current_snapshot uuid; at_time timestamptz; root record;
begin
 select * into v from public.source_verification_records where id=new.verification_id;
 if not found then raise sqlstate 'PT404' using message='Actual source verification not found'; end if;
 perform pg_advisory_xact_lock_shared(hashtextextended('petraplan:evidence:source:'||v.source_id::text,0));
 select * into s from public.trusted_evidence_sources where id=v.source_id;
 for root in select id from (
   select new.authority_id id union select authority_id from public.semantic_rule_decisions
    where rule_version_id=v.rule_version_id and sequence=(select max(sequence) from public.semantic_rule_decisions where rule_version_id=v.rule_version_id)
  ) x where id is not null order by id loop
  perform pg_advisory_xact_lock_shared(hashtextextended('petraplan:evidence:authority:'||root.id::text,0));
 end loop;
 select * into a from public.semantic_rule_authorities where id=new.authority_id;
 perform 1 from public.bridge_actor_roles where user_id=new.assessed_by and active and can_review for share;
 if not found then raise sqlstate 'PT403' using message='Active technical review permission is required'; end if;
 select ingestion_log_id into current_snapshot from public.records where id=v.record_id for update;
 select * into r from public.semantic_rule_versions where id=v.rule_version_id;
 at_time:=clock_timestamp();
 if a.id is null or a.user_id is distinct from new.assessed_by or a.record_id is distinct from v.record_id
  or a.snapshot_id is distinct from v.snapshot_id or a.target_address is distinct from r.target_address
  or a.granted_at>at_time or a.valid_until<=at_time
  or exists(select 1 from public.semantic_rule_authority_revocations where authority_id=a.id) then
  raise sqlstate 'PT403' using message='Current domain authority for this exact case, snapshot and target is required';
 end if;
 if current_snapshot is distinct from v.snapshot_id or r.claim_basis is distinct from v.claim_basis
  or v.claim_basis is distinct from public.bridge_semantic_claim_basis(v.claim_id)
  or s.valid_from>at_time or s.valid_until<=at_time or v.verified_at+make_interval(secs=>s.max_age_seconds)<=at_time
  or exists(select 1 from public.evidence_withdrawals where source_id=s.id or verification_id=v.id) then
  raise sqlstate 'PT409' using message='Source verification or Claim basis is no longer current';
 end if;
 if coalesce(new.anchor->>'byte_start','') !~ '^(0|[1-9][0-9]{0,6})$'
  or coalesce(new.anchor->>'byte_end','') !~ '^[1-9][0-9]{0,6}$' or jsonb_typeof(new.anchor->'excerpt') is distinct from 'string' then
  raise sqlstate 'PT400' using message='A byte range and exact UTF-8 source excerpt are required';
 end if;
 start_byte:=(new.anchor->>'byte_start')::integer;end_byte:=(new.anchor->>'byte_end')::integer;excerpt:=new.anchor->>'excerpt';
 if end_byte<=start_byte or end_byte>octet_length(v.content_bytes)
  or substring(v.content_bytes from start_byte+1 for end_byte-start_byte) is distinct from convert_to(excerpt,'UTF8') then
  raise sqlstate 'PT409' using message='Review excerpt is not present at the specified verified source bytes';
 end if;
 if new.decision='SUPPORTS' and (not public.bridge_evidence_rule_authority_current(r.id,at_time) or new.coverage<>'COMPLETE'
  or not new.criteria @> '{"actual_content_read":true,"meaning_checked":true,"scope_checked":true,"conditions_and_exceptions_checked":true,"counterexamples_checked":true,"coverage_checked":true}'::jsonb) then
  raise sqlstate 'PT409' using message='Supporting meaning requires an approved rule, complete coverage and explicit independent review criteria';
 end if;
 new.record_id:=v.record_id;new.snapshot_id:=v.snapshot_id;new.claim_id:=v.claim_id;
 new.rule_version_id:=v.rule_version_id;new.claim_basis:=v.claim_basis;new.assessed_at:=at_time;
 return new;
end;
$$;
create trigger evidence_assessment_guard before insert on public.semantic_evidence_assessments
for each row execute function public.bridge_guard_evidence_assessment();

create function public.bridge_assess_verified_evidence(
 p_verification_id uuid,p_actor_id uuid,p_authority_id uuid,p_decision text,p_reason text,
 p_coverage text,p_coverage_reason text,p_anchor jsonb,p_criteria jsonb
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_id uuid;
begin
 insert into public.semantic_evidence_assessments(verification_id,assessed_by,authority_id,decision,reason,coverage,coverage_reason,anchor,criteria)
 values(p_verification_id,p_actor_id,p_authority_id,p_decision,p_reason,p_coverage,p_coverage_reason,p_anchor,p_criteria) returning id into v_id;
 return jsonb_build_object('assessment_id',v_id,'validation_allowed',false,'release_allowed',false);
end;
$$;

create function public.bridge_guard_evidence_withdrawal() returns trigger
language plpgsql security invoker set search_path='' as $$
declare v public.source_verification_records%rowtype; m public.semantic_evidence_assessments%rowtype;
 a public.semantic_rule_authorities%rowtype; s_id uuid; r public.semantic_rule_versions%rowtype;
 c record; at_time timestamptz;
begin
 if num_nonnulls(new.source_id,new.verification_id,new.assessment_id)<>1 then
  raise sqlstate 'PT400' using message='Exactly one evidence withdrawal target is required';
 end if;
 if new.source_id is not null and current_user in ('service_role','anon','authenticated') then
  raise sqlstate 'PT403' using message='Source trust and source-wide withdrawal are administrative operations';
 end if;
 if new.assessment_id is not null then
  select * into m from public.semantic_evidence_assessments where id=new.assessment_id;
  select * into v from public.source_verification_records where id=m.verification_id;
 elsif new.verification_id is not null then
  select * into v from public.source_verification_records where id=new.verification_id;
 end if;
 s_id:=coalesce(new.source_id,v.source_id);
 perform pg_advisory_xact_lock(hashtextextended('petraplan:evidence:source:'||s_id::text,0));
 perform 1 from public.trusted_evidence_sources where id=s_id;
 if not found then raise sqlstate 'PT404' using message='Evidence withdrawal target not found'; end if;
 if new.assessment_id is not null then
  perform pg_advisory_xact_lock_shared(hashtextextended('petraplan:evidence:authority:'||new.authority_id::text,0));
 select * into a from public.semantic_rule_authorities where id=new.authority_id;
  select * into r from public.semantic_rule_versions where id=v.rule_version_id;
  at_time:=clock_timestamp();
  if a.id is null or a.user_id is distinct from new.withdrawn_by or a.record_id is distinct from v.record_id
   or a.snapshot_id is distinct from v.snapshot_id or a.target_address is distinct from r.target_address
   or a.granted_at>at_time or a.valid_until<=at_time
   or exists(select 1 from public.semantic_rule_authority_revocations where authority_id=a.id) then
   raise sqlstate 'PT403' using message='Withdrawing a meaning assessment requires current scoped domain authority';
  end if;
  perform 1 from public.bridge_actor_roles where user_id=new.withdrawn_by and active and can_review for share;
 else
  perform 1 from public.bridge_actor_roles where user_id=new.withdrawn_by and active and can_revoke for share;
 end if;
 if not found then raise sqlstate 'PT403' using message='Evidence withdrawal permission required'; end if;
 for c in select distinct record_id from public.source_verification_records
   where source_id=s_id and (new.source_id is not null or id=v.id) order by record_id loop
  perform 1 from public.records where id=c.record_id for update;
 end loop;
 new.withdrawn_at:=clock_timestamp();return new;
end;
$$;
create trigger evidence_withdrawal_guard before insert on public.evidence_withdrawals
for each row execute function public.bridge_guard_evidence_withdrawal();

create function public.bridge_evidence_negative_impact() returns trigger
language plpgsql security invoker set search_path='' as $$
declare c record;
begin
 if tg_table_name='semantic_evidence_assessments' then
  if new.decision='SUPPORTS' then return new; end if;
  perform public.bridge_revoke_release_for_claim_change(new.record_id,new.claim_id,new.assessed_by::text,'semantic_evidence:'||new.decision);
 else
  for c in select distinct v.record_id,v.claim_id from public.source_verification_records v
   left join public.semantic_evidence_assessments m on m.verification_id=v.id
   where v.source_id=new.source_id or v.id=new.verification_id or m.id=new.assessment_id
   order by v.record_id,v.claim_id loop
   perform public.bridge_revoke_release_for_claim_change(c.record_id,c.claim_id,new.withdrawn_by::text,'evidence_withdrawal');
  end loop;
 end if;
 return new;
end;
$$;
create trigger evidence_assessment_negative_impact after insert on public.semantic_evidence_assessments
for each row execute function public.bridge_evidence_negative_impact();
create trigger evidence_withdrawal_negative_impact after insert on public.evidence_withdrawals
for each row execute function public.bridge_evidence_negative_impact();

create function public.bridge_withdraw_evidence(
 p_kind text,p_target_id uuid,p_actor_id uuid,p_reason text,p_authority_id uuid default null
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_id uuid;
begin
 if p_kind not in ('source','verification','assessment') or p_kind is null then raise sqlstate 'PT400' using message='Unsupported evidence withdrawal target'; end if;
 insert into public.evidence_withdrawals(source_id,verification_id,assessment_id,withdrawn_by,reason,authority_id)
 values(case when p_kind='source' then p_target_id end,case when p_kind='verification' then p_target_id end,
  case when p_kind='assessment' then p_target_id end,p_actor_id,p_reason,p_authority_id) returning id into v_id;
 return jsonb_build_object('withdrawal_id',v_id);
end;
$$;

-- Lock the same authority root before revoking it, then invalidate dependent
-- evidence assessments in the existing audit/release chain atomically.
create function public.bridge_lock_evidence_authority_revocation() returns trigger
language plpgsql security invoker set search_path='' as $$
begin perform pg_advisory_xact_lock(hashtextextended('petraplan:evidence:authority:'||new.authority_id::text,0));return new;end;
$$;
create trigger evidence_authority_revocation_lock before insert on public.semantic_rule_authority_revocations
for each row execute function public.bridge_lock_evidence_authority_revocation();
create function public.bridge_evidence_authority_negative_impact() returns trigger
language plpgsql security invoker set search_path='' as $$
declare c record;
begin
 for c in select distinct record_id,claim_id from public.semantic_evidence_assessments where authority_id=new.authority_id order by record_id,claim_id loop
  perform public.bridge_revoke_release_for_claim_change(c.record_id,c.claim_id,new.revoked_by::text,'evidence_authority_revocation');
 end loop;return new;
end;
$$;
create trigger evidence_authority_negative_impact after insert on public.semantic_rule_authority_revocations
for each row execute function public.bridge_evidence_authority_negative_impact();

create function public.bridge_check_verified_evidence(p_record_id uuid,p_rule_version_id uuid,p_actor_id uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare r public.semantic_rule_versions%rowtype; c record; basis text; snap uuid;
 at_time timestamptz; evidence_ids uuid[]; assessment_ids uuid[]; result_state text;
begin
 -- Lock all contributing roots before the case, including opposing reports.
 for c in select distinct s.id from public.trusted_evidence_sources s join public.source_verification_records v on v.source_id=s.id
  where v.record_id=p_record_id and v.rule_version_id=p_rule_version_id order by s.id loop
  perform pg_advisory_xact_lock_shared(hashtextextended('petraplan:evidence:source:'||c.id::text,0));
 end loop;
 for c in select id from (
  select a.authority_id id from public.semantic_evidence_assessments a where a.record_id=p_record_id and a.rule_version_id=p_rule_version_id
  union select authority_id from public.semantic_rule_decisions where rule_version_id=p_rule_version_id
   and sequence=(select max(sequence) from public.semantic_rule_decisions where rule_version_id=p_rule_version_id)
 ) x order by id loop
  perform pg_advisory_xact_lock_shared(hashtextextended('petraplan:evidence:authority:'||c.id::text,0));
 end loop;
 perform 1 from public.bridge_actor_roles where user_id=p_actor_id and active and can_review for share;
 if not found then raise sqlstate 'PT403' using message='Technical review permission required'; end if;
 select ingestion_log_id into snap from public.records where id=p_record_id for update;
 select * into r from public.semantic_rule_versions where id=p_rule_version_id;
 if r.id is null or r.record_id is distinct from p_record_id or r.snapshot_id is distinct from snap then
  result_state:='BLOCKED_BINDING_MISMATCH';
 else
  basis:=public.bridge_semantic_claim_basis(r.claim_id);at_time:=clock_timestamp();
  if basis is distinct from r.claim_basis or not public.bridge_evidence_rule_authority_current(r.id,at_time)
    or not exists(select 1 from public.claims cl join public.conversion_candidates cc on cc.id=r.candidate_id
      join public.address_registry ad on ad.id=cc.source_address_id
      where cl.id=r.claim_id and cl.candidate_id=cc.id and cl.record_id=p_record_id and cl.snapshot_id=snap
       and cl.status not in ('SUPERSEDED','REJECTED') and cl.subject_address=r.target_address
       and cc.record_id=p_record_id and cc.snapshot_id=snap and cc.state='confirmed' and cc.source_path=r.source_path
       and cc.proposed_value is not distinct from r.proposed_value and ad.address=r.source_address) then
   result_state:='BLOCKED_STALE_BASIS';
  else
   -- Withdrawal is explicit; an expired grant cannot silently convert a
   -- previously opposing assessment into positive evidence.
   if exists(select 1 from public.semantic_evidence_assessments a
     where a.record_id=p_record_id and a.rule_version_id=r.id and a.claim_basis=basis and a.decision<>'SUPPORTS'
      and not exists(select 1 from public.evidence_withdrawals w where w.assessment_id=a.id)) then
    result_state:='BLOCKED_CONFLICT_OR_INSUFFICIENT_EVIDENCE';
   else
    select array_agg(v.id order by a.id),array_agg(a.id order by a.id) into evidence_ids,assessment_ids
    from public.semantic_evidence_assessments a
    join public.source_verification_records v on v.id=a.verification_id
    join public.trusted_evidence_sources s on s.id=v.source_id
    join public.semantic_rule_authorities g on g.id=a.authority_id
    where a.record_id=p_record_id and a.rule_version_id=r.id and a.claim_basis=basis
      and a.snapshot_id=snap and a.decision='SUPPORTS' and a.coverage='COMPLETE'
      and g.user_id=a.assessed_by and g.record_id=p_record_id and g.snapshot_id=snap and g.target_address=r.target_address
      and g.granted_at<=at_time and g.valid_until>at_time and s.valid_from<=at_time and s.valid_until>at_time
      and v.verified_at+make_interval(secs=>s.max_age_seconds)>at_time
      and v.snapshot_hash=(select source_hash from public.ingestion_logs where id=snap and status='processed')
      and not exists(select 1 from public.semantic_rule_authority_revocations ar where ar.authority_id=g.id)
      and not exists(select 1 from public.evidence_withdrawals w where w.source_id=s.id or w.verification_id=v.id or w.assessment_id=a.id);
    result_state:=case when cardinality(assessment_ids)>0 then 'READY_FOR_INDEPENDENT_TECHNICAL_VALIDATION' else 'BLOCKED_VERIFIED_MEANING_REQUIRED' end;
   end if;
  end if;
 end if;
 return jsonb_build_object('state',result_state,'record_id',p_record_id,'snapshot_id',snap,'rule_version_id',p_rule_version_id,
  'claim_basis',basis,'verification_ids',coalesce(to_jsonb(evidence_ids),'[]'::jsonb),
  'assessment_ids',coalesce(to_jsonb(assessment_ids),'[]'::jsonb),'validation_allowed',false,'release_allowed',false);
end;
$$;

do $$ declare f record; begin
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname in ('bridge_evidence_immutable','bridge_guard_source_verification','bridge_record_source_verification',
   'bridge_guard_evidence_assessment','bridge_assess_verified_evidence','bridge_guard_evidence_withdrawal','bridge_evidence_negative_impact',
   'bridge_withdraw_evidence','bridge_lock_evidence_authority_revocation','bridge_evidence_authority_negative_impact','bridge_check_verified_evidence','bridge_evidence_rule_authority_current') loop
  execute format('revoke all on function %s from public,anon,authenticated',f.signature);
  execute format('grant execute on function %s to service_role',f.signature);
 end loop;
end $$;
