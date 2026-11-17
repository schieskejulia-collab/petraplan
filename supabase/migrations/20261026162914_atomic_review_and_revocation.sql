-- Development only. No live migration or automatic semantic approval.
-- Depends on the existing review schema and Claim-freshness functions observed
-- read-only on 2026-10-26; review all deployed definitions before rollout.

-- Shared, read-only authority selection. Callers lock the case before consuming
-- it; no UUID/list position is treated as a temporal ordering proof.
create or replace function public.bridge_current_release(p_record_id uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_cert public.release_certificates%rowtype;
  v_history public.release_status_history%rowtype;
  v_status text;
begin
  if exists(select 1 from public.release_certificates where record_id=p_record_id and certified_at is null) then
    return jsonb_build_object('ambiguous',true,'effective_status','blocked');
  end if;
  select * into v_cert from public.release_certificates where record_id=p_record_id order by certified_at desc limit 1;
  if not found then return jsonb_build_object('ambiguous',false,'certificate_id',null,'effective_status',null); end if;
  if exists(select 1 from public.release_certificates where record_id=p_record_id and certified_at=v_cert.certified_at and id<>v_cert.id) then
    return jsonb_build_object('ambiguous',true,'effective_status','blocked');
  end if;
  if exists(select 1 from public.release_status_history where release_certificate_id=v_cert.id and created_at is null) then
    return jsonb_build_object('ambiguous',true,'certificate_id',v_cert.id,'effective_status','blocked');
  end if;
  select * into v_history from public.release_status_history where release_certificate_id=v_cert.id order by created_at desc limit 1;
  v_status:=coalesce(v_history.new_status,v_cert.release_status);
  if exists(select 1 from public.release_status_history where release_certificate_id=v_cert.id and created_at=v_history.created_at and id<>v_history.id)
    or exists(select 1 from public.release_status_history where release_certificate_id=v_cert.id and new_status in ('revoked','superseded') and new_status is distinct from v_status)
    or (v_cert.release_status in ('revoked','superseded') and v_cert.release_status is distinct from v_status) then
    return jsonb_build_object('ambiguous',true,'certificate_id',v_cert.id,'effective_status','blocked');
  end if;
  return jsonb_build_object('ambiguous',false,'certificate_id',v_cert.id,'effective_status',v_status,
    'validation_id',v_cert.validation_result_id,'certified_at',v_cert.certified_at);
end;
$$;

create or replace function public.bridge_commit_review(
  p_record_id uuid,p_snapshot_id uuid,p_validation_id uuid,p_claims_basis text,
  p_actor_id uuid,p_decision text,p_reason text,p_criteria jsonb
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_role public.bridge_actor_roles%rowtype;
  v_snapshot public.ingestion_logs%rowtype;
  v_validation public.validation_results%rowtype;
  v_rule public.review_rules%rowtype;
  v_structure public.review_structures%rowtype;
  v_criterion public.review_criteria%rowtype;
  v_existing public.review_decisions%rowtype;
  v_release jsonb;
  v_record_snapshot uuid;
  v_review_id uuid; v_session_id uuid; v_decision_id uuid;
  v_refs text[];
  v_now timestamptz;
  v_passed boolean;
  v_criteria_reported boolean:=true;
begin
  if p_decision is null or p_decision not in ('approved','rejected') or length(btrim(coalesce(p_reason,'')))<3
    or jsonb_typeof(p_criteria) is distinct from 'object' then
    raise sqlstate 'PT400' using message='A review decision, reason and criteria object are required';
  end if;
  select * into v_role from public.bridge_actor_roles where user_id=p_actor_id and active and can_review for share;
  if not found then raise sqlstate 'PT403' using message='Review permission required'; end if;
  select ingestion_log_id into v_record_snapshot from public.records where id=p_record_id for update;
  if not found then raise sqlstate 'PT404' using message='Case not found'; end if;
  if v_record_snapshot is null or v_record_snapshot is distinct from p_snapshot_id then
    raise sqlstate 'PT409' using message='The source snapshot changed';
  end if;
  select * into v_snapshot from public.ingestion_logs where id=v_record_snapshot for share;
  if not found then raise sqlstate 'PT409' using message='Source snapshot is unavailable'; end if;
  if p_claims_basis is null or p_claims_basis !~ '^[0-9a-f]{64}$'
    or p_claims_basis is distinct from public.bridge_claims_basis(p_record_id) then
    raise sqlstate 'PT409' using message='Claims or evidence changed before the review';
  end if;

  select v.* into v_validation from public.validation_results v join public.conflicts c on c.id=v.conflict_id
    where c.record_id=p_record_id order by v.created_at desc nulls first,v.id limit 1 for share of v;
  if not found or v_validation.id is distinct from p_validation_id or v_validation.created_at is null
    or exists(select 1 from public.validation_results v join public.conflicts c on c.id=v.conflict_id
      where c.record_id=p_record_id and v.created_at=v_validation.created_at and v.id<>v_validation.id) then
    raise sqlstate 'PT409' using message='Latest validation changed or is ambiguous';
  end if;
  if not exists(select 1 from public.resolution_records where id=v_validation.resolution_record_id and conflict_id=v_validation.conflict_id) then
    raise sqlstate 'PT409' using message='Validation resolution does not belong to the case';
  end if;

  v_release:=public.bridge_current_release(p_record_id);
  if coalesce((v_release->>'ambiguous')::boolean,true) then
    raise sqlstate 'PT409' using message='Release authority is ambiguous';
  end if;
  if v_release->>'effective_status' in ('trusted','exception') then
    raise sqlstate 'PT409' using message='An active release already covers this case';
  end if;

  if p_decision='approved' then
    if v_snapshot.status<>'processed' or nullif(v_snapshot.source_hash,'') is null
      or v_validation.status<>'passed' then
      raise sqlstate 'PT409' using message='Approval requires a processed source and passing validation';
    end if;
    -- This compares the stored technical byte basis; it does not authenticate
    -- an external source or establish semantic meaning.
    if v_validation.evidence->>'source_hash' is distinct from v_snapshot.source_hash then
      raise sqlstate 'PT409' using message='Validation does not attest the current source hash';
    end if;
    if exists(select 1 from public.conversion_candidates where record_id=p_record_id and state='candidate')
      or public.bridge_claims_after_validation(p_record_id,p_validation_id)
      or public.bridge_has_unresolved_semantic_claim(p_record_id) then
      raise sqlstate 'PT409' using message='Open candidates, newer Claims or unresolved meaning block approval';
    end if;
  end if;

  -- Review retries must not create a second final decision for the same basis.
  select d.* into v_existing from public.review_decisions d
    join public.review_sessions s on s.id=d.review_session_id
    join public.review_records r on r.id=s.review_record_id
    join public.resolution_records rr on rr.id=r.resolution_record_id
    join public.conflicts c on c.id=rr.conflict_id
    where c.record_id=p_record_id and d.validation_result_id=p_validation_id and d.final
    order by d.created_at desc,d.id limit 1;
  if found then
    if v_existing.decision=p_decision and v_existing.reviewer_id=p_actor_id and v_existing.reason=btrim(p_reason)
      and coalesce(v_existing.evidence_refs @> array['ingestion:'||p_snapshot_id::text,'claims:'||p_claims_basis],false)
      and exists(select 1 from public.bridge_decision_audit a
        where a.review_decision_id=v_existing.id and a.details->'criteria'=p_criteria) then
      return jsonb_build_object('review_decision_id',v_existing.id,'review_session_id',v_existing.review_session_id,'reused',true);
    end if;
    raise sqlstate 'PT409' using message='This validation already has a final review; create a fresh validation and review';
  end if;

  -- Lock the actual configured rule, structure and criteria. Labels or a
  -- missing required row must never stand in for configured review proof.
  -- A table SHARE lock also prevents a new required-criterion phantom.
  lock table public.review_rules,public.review_structures,public.review_criteria in share mode;
  if (select count(*) from public.review_rules where name='PetraPlan live bridge review' and active)<>1 then
    raise sqlstate 'PT409' using message='Exactly one active live review rule is required';
  end if;
  select * into v_rule from public.review_rules where name='PetraPlan live bridge review' and active for share;
  if v_rule.required_reviewer_type<>'human' then raise sqlstate 'PT409' using message='Live review must be configured for a human'; end if;
  if (select count(*) from public.review_structures where rule_id=v_rule.id and name='PetraPlan live bridge decision')<>1 then
    raise sqlstate 'PT409' using message='Exactly one live review structure is required';
  end if;
  select * into v_structure from public.review_structures where rule_id=v_rule.id and name='PetraPlan live bridge decision' for share;
  perform 1 from public.review_criteria where structure_id=v_structure.id order by id for share;
  if not v_structure.required_fields @> array['source_truth_checked','translation_trace_checked','blockers_resolved']
    or exists(select 1 from unnest(v_structure.required_fields) k
      where not exists(select 1 from public.review_criteria c where c.structure_id=v_structure.id and c.criterion_key=k and c.required))
    or not exists(select 1 from public.review_criteria where structure_id=v_structure.id and required) then
    raise sqlstate 'PT409' using message='Configured required review criteria are missing';
  end if;
  for v_criterion in select * from public.review_criteria where structure_id=v_structure.id order by id loop
    if v_criterion.expected_type<>'boolean' then raise sqlstate 'PT409' using message='Unsupported review criterion type'; end if;
    if p_criteria ? v_criterion.criterion_key and jsonb_typeof(p_criteria->v_criterion.criterion_key)<>'boolean' then
      raise sqlstate 'PT400' using message='Review criterion reports must be boolean';
    end if;
    if v_criterion.required and p_decision='approved' and p_criteria->v_criterion.criterion_key is distinct from 'true'::jsonb then
      raise sqlstate 'PT409' using message='Every required review criterion must be explicitly true';
    end if;
    if v_criterion.required and not (p_criteria ? v_criterion.criterion_key) then v_criteria_reported:=false; end if;
  end loop;

  v_now:=clock_timestamp();
  v_refs:=array['claims:'||p_claims_basis,'record:'||p_record_id::text,'validation:'||p_validation_id::text,'ingestion:'||p_snapshot_id::text];
  insert into public.review_records(resolution_record_id,validation_result_id,reviewer_id,reviewer_type,review_status,review_reason,reviewed_at,created_at)
    values(v_validation.resolution_record_id,p_validation_id,p_actor_id::text,'human',p_decision,btrim(p_reason),v_now,v_now) returning id into v_review_id;
  insert into public.review_sessions(review_record_id,rule_id,structure_id,status,started_at,completed_at,reviewer_authorized,
    authorization_level,evidence_checked,evidence_refs,criteria_checked,validation_result_id,created_at)
    values(v_review_id,v_rule.id,v_structure.id,p_decision,v_now,v_now,true,v_role.role_name,true,v_refs,v_criteria_reported,p_validation_id,v_now)
    returning id into v_session_id;
  for v_criterion in select * from public.review_criteria where structure_id=v_structure.id order by id loop
    v_passed:=coalesce(p_criteria->v_criterion.criterion_key='true'::jsonb,false);
    insert into public.review_criterion_results(review_session_id,criterion_id,result,passed,evidence,checked_by,created_at)
      values(v_session_id,v_criterion.id,jsonb_build_object('value',p_criteria->v_criterion.criterion_key,'reported',p_criteria ? v_criterion.criterion_key),
        v_passed,jsonb_build_object('record_id',p_record_id,'snapshot_id',p_snapshot_id,'validation_result_id',p_validation_id,'claims_basis',p_claims_basis),p_actor_id::text,v_now);
  end loop;
  insert into public.review_decisions(review_session_id,decision,reason,decided_by,reviewer_type,final,reviewer_id,
    reviewer_authorized,authorization_level,evidence_checked,evidence_refs,criteria_checked,decided_at,validation_result_id,created_at)
    values(v_session_id,p_decision,btrim(p_reason),p_actor_id::text,'human',true,p_actor_id,true,v_role.role_name,true,v_refs,v_criteria_reported,v_now,p_validation_id,v_now)
    returning id into v_decision_id;
  insert into public.review_status_history(review_session_id,previous_status,new_status,changed_by,reason,created_at)
    values(v_session_id,'pending',p_decision,p_actor_id::text,btrim(p_reason),v_now);
  insert into public.review_logs(review_session_id,event_type,message,details,created_at)
    values(v_session_id,'decision_committed','Authorized mobile review committed',jsonb_build_object('record_id',p_record_id,'validation_result_id',p_validation_id,'reviewer_role',v_role.role_name),v_now);
  insert into public.bridge_decision_audit(record_id,actor_user_id,action,reason,validation_result_id,review_record_id,review_decision_id,
    previous_release_status,new_release_status,details,created_at)
    values(p_record_id,p_actor_id,case p_decision when 'approved' then 'approve_review' else 'reject_review' end,btrim(p_reason),
      p_validation_id,v_review_id,v_decision_id,v_release->>'effective_status',v_release->>'effective_status',
      jsonb_build_object('criteria',p_criteria,'evidence_refs',v_refs,'source','atomic_review'),v_now);
  return jsonb_build_object('review_record_id',v_review_id,'review_session_id',v_session_id,'review_decision_id',v_decision_id,'reused',false);
end;
$$;

create or replace function public.bridge_revoke_case(
  p_record_id uuid,p_certificate_id uuid,p_actor_id uuid,p_reason text,
  p_mode text,p_validation_id uuid default null,p_claim_id uuid default null
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_role public.bridge_actor_roles%rowtype;
  v_current jsonb;
  v_certificate public.release_certificates%rowtype;
  v_validation public.validation_results%rowtype;
  v_previous text;
  v_reason text;
  v_details jsonb;
begin
  if p_mode is null or p_mode not in ('manual','validation','claim') or length(btrim(coalesce(p_reason,'')))<3 then
    raise sqlstate 'PT400' using message='A revocation mode and reason are required';
  end if;
  select * into v_role from public.bridge_actor_roles where user_id=p_actor_id and active
    and (can_revoke or (p_mode='claim' and can_review)) for share;
  if not found then raise sqlstate 'PT403' using message='Revocation permission required'; end if;
  perform 1 from public.records where id=p_record_id for update;
  if not found then raise sqlstate 'PT404' using message='Case not found'; end if;
  v_current:=public.bridge_current_release(p_record_id);
  if coalesce((v_current->>'ambiguous')::boolean,true) then
    if p_mode='manual' then raise sqlstate 'PT409' using message='Release authority is ambiguous'; end if;
    return jsonb_build_object('transitioned',false,'effectiveStatus','blocked','certificateId',null,'reason','Release authority is ambiguous');
  end if;
  if v_current->>'certificate_id' is null then
    if p_mode='manual' then raise sqlstate 'PT409' using message='No release certificate exists'; end if;
    return jsonb_build_object('transitioned',false,'effectiveStatus',null,'certificateId',null,'reason',null);
  end if;
  if p_certificate_id is null or (v_current->>'certificate_id')::uuid is distinct from p_certificate_id then
    raise sqlstate 'PT409' using message='Release certificate changed before revocation';
  end if;
  select * into v_certificate from public.release_certificates where id=p_certificate_id for update;
  v_previous:=v_current->>'effective_status';
  if v_previous in ('revoked','superseded') then
    return jsonb_build_object('transitioned',false,'previousStatus',v_previous,'effectiveStatus',v_previous,
      'certificateId',p_certificate_id,'validationId',v_certificate.validation_result_id,'reason',null);
  end if;

  if p_mode='claim' then
    if not exists(select 1 from public.claims where id=p_claim_id and record_id=p_record_id and status<>'SUPERSEDED') then
      raise sqlstate 'PT409' using message='Claim does not belong to the current case';
    end if;
  elsif p_mode='validation' then
    select * into v_validation from public.validation_results where id=v_certificate.validation_result_id;
    if not found then return jsonb_build_object('transitioned',false,'effectiveStatus','blocked','certificateId',p_certificate_id,'reason','Certified validation is unavailable'); end if;
    if exists(select 1 from public.validation_results v join public.conflicts c on c.id=v.conflict_id
      where c.record_id=p_record_id and v.created_at>v_certificate.certified_at) then
      select v.* into v_validation from public.validation_results v join public.conflicts c on c.id=v.conflict_id
        where c.record_id=p_record_id and v.created_at>v_certificate.certified_at
        order by v.created_at desc,case when v.status='passed' then 1 else 0 end,v.id limit 1;
    end if;
    if v_validation.id is distinct from p_validation_id then raise sqlstate 'PT409' using message='Validation changed before revocation'; end if;
    if v_validation.status='passed' then
      return jsonb_build_object('transitioned',false,'previousStatus',v_previous,
        'effectiveStatus',case when v_validation.id=v_certificate.validation_result_id then v_previous else 'superseded' end,
        'certificateId',p_certificate_id,'validationId',v_validation.id,'reason','Passing validation cannot automatically issue or restore a certificate');
    end if;
  end if;

  v_reason:=btrim(p_reason);
  v_details:=jsonb_build_object('source','atomic_revocation','mode',p_mode,'automatic',p_mode<>'manual',
    'record_id',p_record_id,'claim_id',p_claim_id,'validation_result_id',coalesce(v_validation.id,v_certificate.validation_result_id),
    'previous_release_status',v_previous,'new_release_status','revoked');
  insert into public.release_status_history(release_certificate_id,previous_status,new_status,changed_by,reason)
    values(p_certificate_id,v_previous,'revoked',p_actor_id::text,v_reason);
  insert into public.release_logs(release_certificate_id,event_type,message,details)
    values(p_certificate_id,'revoked','Release revoked atomically',v_details);
  insert into public.bridge_decision_audit(record_id,actor_user_id,action,reason,validation_result_id,release_certificate_id,
    previous_release_status,new_release_status,details)
    values(p_record_id,p_actor_id,'revoke',v_reason,coalesce(v_validation.id,v_certificate.validation_result_id),p_certificate_id,v_previous,'revoked',v_details);
  return jsonb_build_object('transitioned',true,'previousStatus',v_previous,'effectiveStatus','revoked',
    'certificateId',p_certificate_id,'validationId',coalesce(v_validation.id,v_certificate.validation_result_id),'reason',v_reason);
end;
$$;

revoke all on function public.bridge_current_release(uuid) from public,anon,authenticated;
revoke all on function public.bridge_commit_review(uuid,uuid,uuid,text,uuid,text,text,jsonb) from public,anon,authenticated;
revoke all on function public.bridge_revoke_case(uuid,uuid,uuid,text,text,uuid,uuid) from public,anon,authenticated;
grant execute on function public.bridge_current_release(uuid) to service_role;
grant execute on function public.bridge_commit_review(uuid,uuid,uuid,text,uuid,text,text,jsonb) to service_role;
grant execute on function public.bridge_revoke_case(uuid,uuid,uuid,text,text,uuid,uuid) to service_role;

-- Claim creation, its exact technical references and any required safety
-- revocation form a single transaction. A confirmed candidate is still only
-- the basis of an UNPROVEN Claim, never a confirmed semantic assertion.
create or replace function public.bridge_create_explicit_claim(
  p_record_id uuid,p_snapshot_id uuid,p_candidate_id uuid,p_actor_id uuid,
  p_subject_address text,p_claim_type text,p_statement text
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_role public.bridge_actor_roles%rowtype;
  v_candidate public.conversion_candidates%rowtype;
  v_confirmation public.candidate_state_history%rowtype;
  v_source public.address_registry%rowtype;
  v_snapshot public.ingestion_logs%rowtype;
  v_record_snapshot uuid;
  v_claim_id uuid; v_family_id uuid;
  v_before jsonb; v_after jsonb; v_payload jsonb;
  v_now timestamptz;
begin
  if length(btrim(coalesce(p_statement,'')))<8 or nullif(btrim(p_subject_address),'') is null
    or p_claim_type is null or p_claim_type not in
      ('SOURCE','STRUCTURE','REPRESENTATION','SEMANTIC','SEMANTIC_MAPPING','MAPPING','AGGREGATION','CONTEXT','BEHAVIOR','VALIDATION','DECISION','AUTHORIZATION') then
    raise sqlstate 'PT400' using message='A supported Claim type, subject and explicit statement are required';
  end if;
  select * into v_role from public.bridge_actor_roles where user_id=p_actor_id and active and can_review for share;
  if not found then raise sqlstate 'PT403' using message='Review permission required to propose a Claim'; end if;
  select ingestion_log_id into v_record_snapshot from public.records where id=p_record_id for update;
  if not found then raise sqlstate 'PT404' using message='Case not found'; end if;
  if v_record_snapshot is null or v_record_snapshot is distinct from p_snapshot_id then raise sqlstate 'PT409' using message='Claim snapshot changed'; end if;
  select * into v_snapshot from public.ingestion_logs where id=p_snapshot_id and status='processed' for share;
  if not found then raise sqlstate 'PT409' using message='A processed Claim snapshot is required'; end if;
  select * into v_candidate from public.conversion_candidates where id=p_candidate_id for update;
  if not found or v_candidate.record_id is distinct from p_record_id or v_candidate.snapshot_id is distinct from p_snapshot_id or v_candidate.state<>'confirmed' then
    raise sqlstate 'PT409' using message='Claim requires its current confirmed candidate';
  end if;
  if exists(select 1 from public.claims where candidate_id=p_candidate_id and status<>'SUPERSEDED') then
    raise sqlstate 'PT409' using message='An active Claim already exists for this candidate';
  end if;
  select * into v_source from public.address_registry where id=v_candidate.source_address_id for share;
  if not found then raise sqlstate 'PT409' using message='Candidate source address is unavailable'; end if;
  if p_subject_address is distinct from v_source.address and not exists (
    select 1 from public.impact_links l join public.address_registry a on a.id=l.address_id
    where l.candidate_id=p_candidate_id and l.link_type='impacts' and a.address=p_subject_address
  ) then raise sqlstate 'PT409' using message='Claim subject must be the candidate source or its documented impact address'; end if;
  select * into v_confirmation from public.candidate_state_history where candidate_id=p_candidate_id
    order by changed_at desc nulls first,id limit 1;
  if found and (v_confirmation.state<>'confirmed' or v_confirmation.snapshot_id is distinct from p_snapshot_id or v_confirmation.changed_at is null
    or exists(select 1 from public.candidate_state_history h where h.candidate_id=p_candidate_id
      and h.changed_at=v_confirmation.changed_at and h.id<>v_confirmation.id)) then
    raise sqlstate 'PT409' using message='Candidate confirmation reference is ambiguous or belongs to another snapshot';
  end if;
  v_before:=public.bridge_current_release(p_record_id);
  if coalesce((v_before->>'ambiguous')::boolean,true) then raise sqlstate 'PT409' using message='Release authority is ambiguous before Claim creation'; end if;

  v_claim_id:=gen_random_uuid();v_family_id:=gen_random_uuid();v_now:=clock_timestamp();
  v_payload:=jsonb_build_object('candidate_id',p_candidate_id,'snapshot_id',p_snapshot_id,
    'subject_address',p_subject_address,'predicate',v_candidate.candidate_key,'object_value',v_candidate.proposed_value,
    'statement',btrim(p_statement),'claim_type',p_claim_type,'scope_type','CASE_ONLY','record_id',p_record_id);
  insert into public.claims(id,claim_family_id,claim_version,claim_type,subject_address,predicate,object_value,statement,status,
    scope_type,scope_payload,source_system,snapshot_id,record_id,field_address,created_by,created_at,producer_role,candidate_id,claim_payload_hash)
    values(v_claim_id,v_family_id,1,p_claim_type,p_subject_address,v_candidate.candidate_key,v_candidate.proposed_value,btrim(p_statement),'UNPROVEN',
      'CASE_ONLY',jsonb_build_object('record_id',p_record_id,'snapshot_id',p_snapshot_id,'candidate_id',p_candidate_id),
      v_snapshot.source_system,p_snapshot_id,p_record_id,p_subject_address,p_actor_id::text,v_now,v_role.role_name,p_candidate_id,
      encode(sha256(convert_to(v_payload::text,'UTF8')),'hex'));
  insert into public.claim_evidence_links(claim_id,evidence_type,evidence_reference,relation,directness,scope,linked_by,note)
    values
      (v_claim_id,'SOURCE_ADDRESS',v_source.address,'DERIVED_FROM','DIRECT',jsonb_build_object('record_id',p_record_id,'snapshot_id',p_snapshot_id),p_actor_id::text,'Candidate source address '||v_source.address),
      (v_claim_id,'SOURCE_SNAPSHOT',p_snapshot_id::text,'DERIVED_FROM','DIRECT',jsonb_build_object('record_id',p_record_id),p_actor_id::text,'Immutable source snapshot used by the confirmed candidate'),
      (v_claim_id,'CANDIDATE_EVIDENCE','conversion_candidate:'||p_candidate_id::text,'SUPPORTS','DIRECT',jsonb_build_object('record_id',p_record_id,'snapshot_id',p_snapshot_id),p_actor_id::text,v_candidate.evidence);
  if v_confirmation.id is not null then
    insert into public.claim_evidence_links(claim_id,evidence_type,evidence_reference,relation,directness,scope,linked_by,note)
      values(v_claim_id,'HUMAN_CONFIRMATION','candidate_state_history:'||v_confirmation.id::text,'SUPPORTS','DIRECT',
        jsonb_build_object('record_id',p_record_id,'snapshot_id',p_snapshot_id,'candidate_id',p_candidate_id),p_actor_id::text,v_confirmation.reason);
  end if;

  -- The existing observed Claim triggers revoke within this same transaction.
  -- Recheck their effect; a missing trigger must not leave the old trust usable.
  v_after:=public.bridge_current_release(p_record_id);
  if v_before->>'effective_status' in ('trusted','exception') and v_after->>'effective_status' in ('trusted','exception') then
    perform public.bridge_revoke_case(p_record_id,(v_before->>'certificate_id')::uuid,p_actor_id,
      'New explicit Claim changed the current case knowledge basis','claim',null,v_claim_id);
    v_after:=public.bridge_current_release(p_record_id);
  end if;
  if coalesce((v_after->>'ambiguous')::boolean,true)
    or (v_before->>'effective_status' in ('trusted','exception') and v_after->>'effective_status' is distinct from 'revoked') then
    raise sqlstate 'PT409' using message='Claim safety revocation could not be established';
  end if;
  return jsonb_build_object('claim_id',v_claim_id,'release_invalidation',jsonb_build_object(
    'transitioned',coalesce(v_before->>'effective_status' in ('trusted','exception') and v_after->>'effective_status'='revoked',false),
    'previousStatus',v_before->>'effective_status','effectiveStatus',v_after->>'effective_status',
    'certificateId',v_after->>'certificate_id','reason','New Claim requires new validation and review','warnings','[]'::jsonb));
end;
$$;
revoke all on function public.bridge_create_explicit_claim(uuid,uuid,uuid,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.bridge_create_explicit_claim(uuid,uuid,uuid,uuid,text,text,text) to service_role;
