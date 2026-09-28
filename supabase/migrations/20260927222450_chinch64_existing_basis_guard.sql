-- Align release idempotency with the live certificate uniqueness contract.
-- An existing certificate for the exact validation/review basis is immutable.
-- Revocation/supersession is terminal and must not depend on timestamp/UUID ordering.

create or replace function public.bridge_release_case(
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
    order by certified_at desc, id desc limit 1;
  if v_existing.id is not null then
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
    'review_record_id', v_review.id, 'review_decision_id', v_decision.id, 'certified_at', v_now);
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

revoke all on function public.bridge_release_case(uuid, uuid, uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.bridge_release_case(uuid, uuid, uuid, uuid, uuid, text) to service_role;
