-- Requires decisions migration. All invoice releases are gated once installed.
create function public.bridge_check_invoice_duplicate_release(p_record_id uuid,p_decision_id uuid default null)
returns jsonb language plpgsql volatile security invoker set search_path='' as $$
declare d public.invoice_duplicate_decisions%rowtype; b jsonb; peer uuid; snap uuid; actor uuid;
begin
 select ingestion_log_id into snap from public.records where id=p_record_id;
 select * into d from public.invoice_duplicate_decisions where record_id=p_record_id order by decision_order desc limit 1;
 if d.id is null or d.snapshot_id is distinct from snap or d.action not in ('CLEAR','DISTINCT','PRIMARY')
   or (p_decision_id is not null and d.id<>p_decision_id) then
  return jsonb_build_object('allowed',false,'reason','Current duplicate clearance required'); end if;
 select user_id into actor from public.bridge_actor_roles where user_id=d.actor_id and active and can_review
  and (d.action='CLEAR' or (can_adjudicate_invoice_duplicates
    and invoice_duplicate_authority_reference=d.authority_reference)) for share;
 if actor is null then return jsonb_build_object('allowed',false,'reason','Decision authority is unavailable'); end if;
 b:=public.bridge_invoice_duplicate_review_basis(p_record_id,snap,actor);
 if d.corpus_hash is distinct from b->>'corpusHash' or b#>'{read,truncated}' is distinct from 'false'::jsonb then
  return jsonb_build_object('allowed',false,'reason','Invoice comparison corpus changed'); end if;
 for peer in select unnest(d.peer_decision_ids) loop
  perform 1 from public.bridge_actor_roles r join public.invoice_duplicate_decisions x on x.actor_id=r.user_id
   where x.id=peer and r.active and r.can_review for share of r;
  if not exists(select 1 from jsonb_array_elements(b->'decisions') x where x->>'id'=peer::text and x->>'action'='DUPLICATE'
   and exists(select 1 from public.bridge_actor_roles r where r.user_id=(x->>'actor_id')::uuid and r.active and r.can_review)) then
   return jsonb_build_object('allowed',false,'reason','Blocked copy decision changed'); end if;
 end loop;
 return jsonb_build_object('allowed',true,'decisionId',d.id,'corpusHash',d.corpus_hash);
end;
$$;

create function public.bridge_guard_duplicate_certificate() returns trigger
language plpgsql security invoker set search_path='' as $$
declare checked jsonb;
begin
 if not exists(select 1 from public.records where id=new.record_id and source_system='petraplan-invoice') then return new; end if;
 perform pg_advisory_xact_lock(20261128,500);
 if current_setting('transaction_isolation')<>'read committed' then
  raise sqlstate 'PT409' using message='Invoice release requires READ COMMITTED'; end if;
 checked:=public.bridge_check_invoice_duplicate_release(new.record_id);
 if checked->'allowed' is distinct from 'true'::jsonb then
  raise sqlstate 'PT409' using message='Current duplicate clearance required'; end if;
 new.truth_snapshot:=new.truth_snapshot||jsonb_build_object('invoice_duplicate_decision_id',checked->>'decisionId',
  'source_snapshot_id',(select ingestion_log_id from public.records where id=new.record_id),
  'source_hash',(select i.source_hash from public.records r join public.ingestion_logs i on i.id=r.ingestion_log_id where r.id=new.record_id));
 new.certificate_hash:=encode(sha256(convert_to(new.truth_snapshot::text,'UTF8')),'hex');
 return new;
end;
$$;
create trigger zzzz_invoice_duplicate_certificate before insert on public.release_certificates
 for each row execute function public.bridge_guard_duplicate_certificate();

-- Serialize source mutations and decisions with release. Statement triggers run
-- before row locks, including direct writes through trusted service transports.
create function public.bridge_lock_invoice_corpus() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 perform pg_advisory_xact_lock(20261128,500);
 if current_setting('transaction_isolation')<>'read committed' then
  raise sqlstate 'PT409' using message='Invoice corpus writes require READ COMMITTED'; end if;
 return null;
end;
$$;
create trigger aaa_invoice_corpus_lock before insert or update or delete or truncate on public.records
 for each statement execute function public.bridge_lock_invoice_corpus();
create trigger aaa_invoice_corpus_lock before insert or update or delete or truncate on public.ingestion_logs
 for each statement execute function public.bridge_lock_invoice_corpus();
create trigger aaa_invoice_corpus_lock before insert or update or delete or truncate on public.validation_results
 for each statement execute function public.bridge_lock_invoice_corpus();
create trigger aaa_invoice_corpus_lock before insert or update or delete or truncate on public.bridge_invoice_evidence
 for each statement execute function public.bridge_lock_invoice_corpus();

-- Keep exact existing implementations, adding a serialized entry point before
-- their case locks. The internal functions are owner-only, never exposed RPCs.
alter function public.bridge_capture_invoice_case(uuid,uuid,uuid,bytea,bytea,jsonb,bytea) rename to bridge_capture_invoice_case_without_duplicate_lock;
alter function public.bridge_release_case(uuid,uuid,uuid,uuid,uuid,text) rename to bridge_release_case_without_duplicate_guard;
revoke all on function public.bridge_capture_invoice_case_without_duplicate_lock(uuid,uuid,uuid,bytea,bytea,jsonb,bytea) from public,anon,authenticated,service_role;
revoke all on function public.bridge_release_case_without_duplicate_guard(uuid,uuid,uuid,uuid,uuid,text) from public,anon,authenticated,service_role;
-- Duplicate decision is an additional release basis. A terminal certificate stays
-- terminal; a newly adjudicated corpus may receive a new certificate only after
-- explicit revocation and a separate release. The existing source review remains
-- valid only while its unchanged source/validation/claims checks still pass.
create or replace function public.bridge_release_case_without_duplicate_guard(
  p_record_id uuid, p_snapshot_id uuid, p_validation_id uuid,
  p_review_session_id uuid, p_actor_id uuid, p_reason text
) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  v_snapshot uuid;
  v_source_hash text;
  v_validation public.validation_results%rowtype;
  v_session public.review_sessions%rowtype;
  v_review public.review_records%rowtype;
  v_decision public.review_decisions%rowtype;
  v_existing public.release_certificates%rowtype;
  v_certificate uuid;
  v_previous text;
  v_truth jsonb;
  v_now timestamptz;
  v_latest_session uuid;
  v_claims_basis text;
begin
  if length(btrim(coalesce(p_reason, ''))) < 3 then raise sqlstate 'PT400' using message = 'A reason is required'; end if;
  perform 1 from public.bridge_actor_roles where user_id = p_actor_id and active and can_release for share;
  if not found then raise sqlstate 'PT403' using message = 'Release permission required'; end if;

  select ingestion_log_id into v_snapshot from public.records where id = p_record_id for update;
  if not found then raise sqlstate 'PT404' using message = 'Case not found'; end if;
  if v_snapshot is null or p_snapshot_id is distinct from v_snapshot then raise sqlstate 'PT409' using message = 'The source snapshot has changed'; end if;
  select source_hash into v_source_hash from public.ingestion_logs where id = v_snapshot and status = 'processed' for share;
  if not found or nullif(v_source_hash, '') is null then raise sqlstate 'PT409' using message = 'A processed source snapshot with a hash is required'; end if;
  if exists (select 1 from public.conversion_candidates where record_id = p_record_id and state = 'candidate') then raise sqlstate 'PT409' using message = 'Open candidates block release'; end if;

  select v.* into v_validation from public.validation_results v
    join public.conflicts c on c.id = v.conflict_id where c.record_id = p_record_id
    order by v.created_at desc, v.id desc limit 1;
  if not found or p_validation_id is distinct from v_validation.id then raise sqlstate 'PT409' using message = 'Validation changed; a new review is required'; end if;
  if exists (select 1 from public.validation_results v join public.conflicts c on c.id = v.conflict_id
    where c.record_id = p_record_id and v.created_at = v_validation.created_at and v.id <> v_validation.id) then raise sqlstate 'PT409' using message = 'Latest validation is ambiguous'; end if;
  if lower(coalesce(v_validation.status, '')) not in ('passed', 'pass', 'valid', 'validated', 'approved', 'success') then raise sqlstate 'PT409' using message = 'Authoritative validation is not passing'; end if;
  if public.bridge_claims_after_validation(p_record_id, p_validation_id) then
    raise sqlstate 'PT409' using message = 'An active claim was created after this validation; create a new validation and review';
  end if;

  select s.id into v_latest_session from public.review_sessions s
    join public.review_records r on r.id = s.review_record_id
    join public.resolution_records rr on rr.id = r.resolution_record_id
    join public.conflicts c on c.id = rr.conflict_id
    where c.record_id = p_record_id order by s.created_at desc, s.id desc limit 1;
  if v_latest_session is null or v_latest_session is distinct from p_review_session_id then raise sqlstate 'PT409' using message = 'Review changed; reload the case'; end if;
  select * into v_session from public.review_sessions where id = p_review_session_id;
  select * into v_review from public.review_records where id = v_session.review_record_id;
  select * into v_decision from public.review_decisions where review_session_id = p_review_session_id order by created_at desc, id desc limit 1;
  if v_decision.id is null or v_decision.decision is distinct from 'approved'
    or v_decision.final is distinct from true or v_decision.reviewer_authorized is distinct from true
    or v_decision.reviewer_id is null or nullif(v_decision.authorization_level, '') is null
    or v_decision.evidence_checked is distinct from true or v_decision.criteria_checked is distinct from true
    or length(btrim(coalesce(v_decision.reason, ''))) < 3 or v_decision.decided_at is null then
    raise sqlstate 'PT409' using message = 'A complete authorized approval is required';
  end if;
  if v_review.validation_result_id is distinct from p_validation_id
    or v_session.validation_result_id is distinct from p_validation_id
    or v_decision.validation_result_id is distinct from p_validation_id
    or v_review.resolution_record_id is distinct from v_validation.resolution_record_id then
    raise sqlstate 'PT409' using message = 'Review is not bound to the current validation and resolution';
  end if;
  if not coalesce(v_decision.evidence_refs @> array['ingestion:' || v_snapshot::text, 'validation:' || p_validation_id::text], false) then raise sqlstate 'PT409' using message = 'Review lacks the current snapshot and validation evidence'; end if;
  v_claims_basis := public.bridge_claims_basis(p_record_id);
  if not coalesce(v_decision.evidence_refs @> array['claims:' || v_claims_basis], false) then
    raise sqlstate 'PT409' using message = 'Claims changed since the review; a new validation and review are required';
  end if;
  if not exists (select 1 from public.review_criteria where structure_id = v_session.structure_id and required)
    or exists (select 1 from public.review_criteria c where c.structure_id = v_session.structure_id and c.required
      and not exists (select 1 from public.review_criterion_results r where r.review_session_id = v_session.id and r.criterion_id = c.id and r.passed is true)) then
    raise sqlstate 'PT409' using message = 'Required review criteria are missing or failed';
  end if;

  select * into v_existing from public.release_certificates
    where record_id = p_record_id
      and resolution_record_id = v_validation.resolution_record_id
      and validation_result_id = p_validation_id
      and review_record_id = v_review.id
      and review_decision_id = v_decision.id
      and (not exists(select 1 from public.records where id=p_record_id and source_system='petraplan-invoice')
        or truth_snapshot->>'invoice_duplicate_decision_id' = (public.bridge_check_invoice_duplicate_release(p_record_id)->>'decisionId'))
    order by certified_at desc, id desc limit 1;
  if v_existing.id is not null then
    -- A revocation/supersession is irreversible for this certificate. Checking
    -- for terminal history explicitly avoids depending on timestamp/UUID ties.
    if exists (
      select 1 from public.release_status_history
      where release_certificate_id = v_existing.id
        and lower(coalesce(new_status, '')) in ('revoked', 'superseded')
    ) then
      raise sqlstate 'PT409' using message = 'This release basis is stale, revoked, or not bound to the current source snapshot; create a new validation and review';
    end if;

    select new_status into v_previous from public.release_status_history
      where release_certificate_id = v_existing.id order by created_at desc, id desc limit 1;
    v_previous := coalesce(v_previous, v_existing.release_status);
    if v_previous = 'trusted'
      and v_existing.truth_snapshot ->> 'source_snapshot_id' = v_snapshot::text
      and v_existing.truth_snapshot ->> 'source_hash' = v_source_hash then
      return jsonb_build_object('certificate_id', v_existing.id, 'reused', true);
    end if;
    raise sqlstate 'PT409' using message = 'This release basis is stale, revoked, or not bound to the current source snapshot; create a new validation and review';
  end if;

  v_previous := null;
  select * into v_existing from public.release_certificates where record_id = p_record_id order by certified_at desc, id desc limit 1;
  if v_existing.id is not null then
    select new_status into v_previous from public.release_status_history where release_certificate_id = v_existing.id order by created_at desc, id desc limit 1;
    v_previous := coalesce(v_previous, v_existing.release_status);
  end if;

  v_now := clock_timestamp();
  v_truth := jsonb_build_object('record_id', p_record_id, 'source_snapshot_id', v_snapshot,
    'source_hash', v_source_hash, 'conflict_id', v_validation.conflict_id,
    'resolution_record_id', v_validation.resolution_record_id, 'validation_result_id', p_validation_id,
    'review_record_id', v_review.id, 'review_decision_id', v_decision.id, 'certified_at', v_now, 'claims_basis', v_claims_basis);
  insert into public.release_certificates
    (record_id, conflict_id, resolution_record_id, validation_result_id, review_record_id,
     review_decision_id, release_status, certified_by_type, certified_by, reason,
     truth_snapshot, certificate_hash, certified_at)
    values (p_record_id, v_validation.conflict_id, v_validation.resolution_record_id, p_validation_id,
      v_review.id, v_decision.id, 'trusted', 'human', p_actor_id, btrim(p_reason),
      v_truth, encode(sha256(convert_to(v_truth::text, 'UTF8')), 'hex'), v_now)
    returning id into v_certificate;
  insert into public.release_status_history
    (release_certificate_id, previous_status, new_status, changed_by, reason)
    values (v_certificate, null, 'trusted', p_actor_id, btrim(p_reason));
  insert into public.release_logs (release_certificate_id, event_type, message, details)
    values (v_certificate, 'certificate_issued', 'Release confirmed in Live Bridge', v_truth);
  insert into public.bridge_decision_audit
    (record_id, actor_user_id, action, reason, validation_result_id, review_record_id,
     review_decision_id, release_certificate_id, previous_release_status, new_release_status, details)
    values (p_record_id, p_actor_id, 'release', btrim(p_reason), p_validation_id, v_review.id,
      v_decision.id, v_certificate, v_previous, 'trusted', v_truth);
  return jsonb_build_object('certificate_id', v_certificate, 'reused', false);
end;
$$;

create function public.bridge_capture_invoice_case(p_record_id uuid,p_expected_snapshot_id uuid,p_actor_id uuid,
 p_invoice bytea,p_report bytea,p_result jsonb,p_pdf bytea default null)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 perform pg_advisory_xact_lock(20261128,500);
 if current_setting('transaction_isolation')<>'read committed' then raise sqlstate 'PT409' using message='READ COMMITTED required'; end if;
 return public.bridge_capture_invoice_case_without_duplicate_lock(p_record_id,p_expected_snapshot_id,p_actor_id,p_invoice,p_report,p_result,p_pdf);
end;
$$;
create function public.bridge_release_case(p_record_id uuid,p_snapshot_id uuid,p_validation_id uuid,p_review_session_id uuid,p_actor_id uuid,p_reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare checked jsonb; existing jsonb; bound text;
begin
 perform pg_advisory_xact_lock(20261128,500);
 if current_setting('transaction_isolation')<>'read committed' then raise sqlstate 'PT409' using message='READ COMMITTED required'; end if;
 if exists(select 1 from public.records where id=p_record_id and source_system='petraplan-invoice') then
  checked:=public.bridge_check_invoice_duplicate_release(p_record_id);
  if checked->'allowed' is distinct from 'true'::jsonb then
   raise sqlstate 'PT409' using message='Current duplicate clearance required'; end if;
  existing:=public.bridge_current_release(p_record_id);
  if existing->>'effective_status' in ('trusted','exception') then
   select truth_snapshot->>'invoice_duplicate_decision_id' into bound from public.release_certificates where id=(existing->>'certificate_id')::uuid;
   if bound is distinct from checked->>'decisionId' then
    raise sqlstate 'PT409' using message='Revoke previous certificate before releasing a new duplicate decision'; end if;
  end if;
 end if;
 return public.bridge_release_case_without_duplicate_guard(p_record_id,p_snapshot_id,p_validation_id,p_review_session_id,p_actor_id,p_reason);
end;
$$;
revoke all on function public.bridge_check_invoice_duplicate_release(uuid,uuid),public.bridge_guard_duplicate_certificate(),public.bridge_lock_invoice_corpus(),
 public.bridge_capture_invoice_case(uuid,uuid,uuid,bytea,bytea,jsonb,bytea),public.bridge_release_case(uuid,uuid,uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.bridge_check_invoice_duplicate_release(uuid,uuid),public.bridge_guard_duplicate_certificate(),public.bridge_lock_invoice_corpus(),
 public.bridge_capture_invoice_case(uuid,uuid,uuid,bytea,bytea,jsonb,bytea),public.bridge_release_case(uuid,uuid,uuid,uuid,uuid,text) to service_role;
