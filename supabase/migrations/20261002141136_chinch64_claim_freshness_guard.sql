-- Claim basis is bound to a review and a release.
-- All changes to a claim or its evidence links invalidate a usable release in the same transaction.
create or replace function public.bridge_claims_basis(p_record_id uuid)
returns text language sql stable security invoker set search_path = '' as $$
  select encode(sha256(convert_to(
    coalesce(jsonb_agg(
      jsonb_build_object(
        'claim', to_jsonb(c),
        'evidence', coalesce(
          (select jsonb_agg(to_jsonb(e) order by e.id)
           from public.claim_evidence_links e where e.claim_id = c.id),
          '[]'::jsonb
        )
      ) order by c.id
    ), '[]'::jsonb)::text, 'UTF8')), 'hex')
  from public.claims c
  where c.record_id = p_record_id and c.status <> 'SUPERSEDED';
$$;
revoke all on function public.bridge_claims_basis(uuid) from public, anon, authenticated;
grant execute on function public.bridge_claims_basis(uuid) to service_role;

-- A review may only use a validation that was created after every active claim
-- for this case. Fail closed when the supplied validation is not for this case.
create or replace function public.bridge_claims_after_validation(
  p_record_id uuid, p_validation_id uuid
) returns boolean language sql stable security invoker set search_path = '' as $$
  select case
    when not exists (
      select 1 from public.validation_results v
      join public.conflicts c on c.id = v.conflict_id
      where c.record_id = p_record_id and v.id = p_validation_id
    ) then true
    else exists (
      select 1 from public.claims claim
      join public.validation_results v on v.id = p_validation_id
      join public.conflicts c on c.id = v.conflict_id
      where c.record_id = p_record_id
        and claim.record_id = p_record_id
        and claim.status in ('UNPROVEN', 'SUPPORTED', 'CONFIRMED', 'CONTESTED')
        and claim.created_at > v.created_at
    )
  end;
$$;
revoke all on function public.bridge_claims_after_validation(uuid, uuid) from public, anon, authenticated;
grant execute on function public.bridge_claims_after_validation(uuid, uuid) to service_role;

-- Serialize the final approval against claim changes. Claim/evidence triggers
-- lock the same record row before changing the claim basis.
create or replace function public.bridge_guard_review_claim_freshness()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare v_record uuid; v_claims_basis text;
begin
  if lower(coalesce(new.decision, '')) <> 'approved' then return new; end if;
  select c.record_id into v_record
  from public.review_sessions s
  join public.review_records r on r.id = s.review_record_id
  join public.resolution_records rr on rr.id = r.resolution_record_id
  join public.conflicts c on c.id = rr.conflict_id
  where s.id = new.review_session_id;
  if v_record is null or new.validation_result_id is null then
    raise sqlstate 'PT409' using message = 'Review lacks a case or validation basis';
  end if;
  perform 1 from public.records where id = v_record for update;
  if public.bridge_claims_after_validation(v_record, new.validation_result_id) then
    raise sqlstate 'PT409' using message = 'An active claim was created after this validation; create a new validation and review';
  end if;
  v_claims_basis := public.bridge_claims_basis(v_record);
  if not coalesce(new.evidence_refs @> array['claims:' || v_claims_basis], false) then
    raise sqlstate 'PT409' using message = 'Claims changed before review approval; reload the case';
  end if;
  return new;
end;
$$;
revoke all on function public.bridge_guard_review_claim_freshness() from public, anon, authenticated;
grant execute on function public.bridge_guard_review_claim_freshness() to service_role;
drop trigger if exists bridge_guard_review_claim_freshness on public.review_decisions;
create trigger bridge_guard_review_claim_freshness
  before insert or update of decision, review_session_id, validation_result_id, evidence_refs
  on public.review_decisions for each row execute function public.bridge_guard_review_claim_freshness();

create or replace function public.bridge_lock_claim_basis()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare v_old uuid; v_new uuid; v_record uuid;
begin
  if tg_op <> 'INSERT' then v_old := old.record_id; end if;
  if tg_op <> 'DELETE' then v_new := new.record_id; end if;
  for v_record in
    select distinct x from unnest(array[v_old, v_new]) as x where x is not null order by x
  loop
    perform 1 from public.records where id = v_record for update;
  end loop;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function public.bridge_lock_claim_basis() from public, anon, authenticated;
grant execute on function public.bridge_lock_claim_basis() to service_role;
drop trigger if exists bridge_lock_claim_basis on public.claims;
create trigger bridge_lock_claim_basis before insert or update or delete on public.claims
  for each row execute function public.bridge_lock_claim_basis();

create or replace function public.bridge_lock_claim_evidence_basis()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare v_old uuid; v_new uuid; v_record uuid;
begin
  if tg_op <> 'INSERT' then
    select record_id into v_old from public.claims where id = old.claim_id;
  end if;
  if tg_op <> 'DELETE' then
    select record_id into v_new from public.claims where id = new.claim_id;
  end if;
  for v_record in
    select distinct x from unnest(array[v_old, v_new]) as x where x is not null order by x
  loop
    perform 1 from public.records where id = v_record for update;
  end loop;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function public.bridge_lock_claim_evidence_basis() from public, anon, authenticated;
grant execute on function public.bridge_lock_claim_evidence_basis() to service_role;
drop trigger if exists bridge_lock_claim_evidence_basis on public.claim_evidence_links;
create trigger bridge_lock_claim_evidence_basis before insert or update or delete on public.claim_evidence_links
  for each row execute function public.bridge_lock_claim_evidence_basis();

-- A system revocation has no human actor. Preserve its audit row without
-- inventing a user, while keeping user IDs mandatory for every other action.
alter table public.bridge_decision_audit alter column actor_user_id drop not null;
alter table public.bridge_decision_audit
  add constraint bridge_decision_audit_actor_or_automatic_claim_change
  check (actor_user_id is not null or (
    action = 'revoke'
    and coalesce(details ->> 'automatic', '') = 'true'
    and coalesce(details ->> 'source', '') = 'claim_freshness_invalidation'
  ));

create or replace function public.bridge_revoke_release_for_claim_change(
  p_record_id uuid, p_claim_id uuid, p_actor text, p_change text
) returns void language plpgsql security invoker set search_path = '' as $$
declare
  v_cert public.release_certificates%rowtype;
  v_previous text;
  v_actor uuid;
  v_reason text;
begin
  if p_record_id is null then return; end if;
  select * into v_cert from public.release_certificates
    where record_id = p_record_id order by certified_at desc, id desc limit 1;
  if v_cert.id is null then return; end if;
  if exists (
    select 1 from public.release_status_history
    where release_certificate_id = v_cert.id and lower(new_status) in ('revoked', 'superseded')
  ) then return; end if;
  select new_status into v_previous from public.release_status_history
    where release_certificate_id = v_cert.id order by created_at desc, id desc limit 1;
  v_previous := lower(coalesce(v_previous, v_cert.release_status, ''));
  if v_previous not in ('trusted', 'exception') then return; end if;
  -- Claim producers may be system names, while the audit table requires a real
  -- auth user. A Bridge role is FK-bound to auth.users; use the release actor
  -- as fallback for an automatic revocation, and keep the producer in details.
  select user_id into v_actor from public.bridge_actor_roles
    where user_id::text = lower(p_actor) limit 1;
  if v_actor is null then
    select user_id into v_actor from public.bridge_actor_roles
      where user_id::text = lower(v_cert.certified_by) limit 1;
  end if;
  v_reason := 'Claim ' || p_claim_id::text || ' oder dessen Beleg wurde nach der geprüften Freigabe geändert (' ||
    p_change || '). Neuvalidierung, neues Review und eine neue explizite Freigabe sind erforderlich.';
  insert into public.release_status_history
    (release_certificate_id, previous_status, new_status, changed_by, reason)
    values (v_cert.id, v_previous, 'revoked', 'claim_freshness_invalidation', v_reason);
  insert into public.release_logs (release_certificate_id, event_type, message, details)
    values (v_cert.id, 'revoked', 'Release automatically revoked after claim basis changed',
      jsonb_build_object('automatic', true, 'source', 'claim_freshness_invalidation',
        'record_id', p_record_id, 'claim_id', p_claim_id, 'change', p_change,
        'claim_producer', p_actor,
        'validation_result_id', v_cert.validation_result_id,
        'previous_release_status', v_previous, 'new_release_status', 'revoked'));
  insert into public.bridge_decision_audit
    (record_id, actor_user_id, action, reason, validation_result_id, release_certificate_id,
     previous_release_status, new_release_status, details)
    values (p_record_id, v_actor, 'revoke', v_reason, v_cert.validation_result_id, v_cert.id,
      v_previous, 'revoked', jsonb_build_object(
        'automatic', true, 'source', 'claim_freshness_invalidation',
        'claim_id', p_claim_id, 'change', p_change, 'claim_producer', p_actor,
        'audit_actor_from_release', v_actor is not null and v_actor::text is distinct from p_actor));
end;
$$;
revoke all on function public.bridge_revoke_release_for_claim_change(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.bridge_revoke_release_for_claim_change(uuid, uuid, text, text) to service_role;

create or replace function public.bridge_revoke_release_on_claim_basis_change()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare v_old uuid; v_new uuid; v_claim uuid; v_actor text; v_record uuid;
begin
  if tg_table_name = 'claims' then
    if tg_op <> 'INSERT' then v_old := old.record_id; end if;
    if tg_op <> 'DELETE' then v_new := new.record_id; end if;
    v_claim := case when tg_op = 'DELETE' then old.id else new.id end;
    v_actor := case when tg_op = 'DELETE' then old.created_by else new.created_by end;
  else
    if tg_op <> 'INSERT' then
      select record_id into v_old from public.claims where id = old.claim_id;
    end if;
    if tg_op <> 'DELETE' then
      select record_id into v_new from public.claims where id = new.claim_id;
    end if;
    v_claim := case when tg_op = 'DELETE' then old.claim_id else new.claim_id end;
    v_actor := case when tg_op = 'DELETE' then old.linked_by else new.linked_by end;
  end if;
  for v_record in
    select distinct x from unnest(array[v_old, v_new]) as x where x is not null order by x
  loop
    perform public.bridge_revoke_release_for_claim_change(v_record, v_claim, v_actor, tg_table_name || ':' || tg_op);
  end loop;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function public.bridge_revoke_release_on_claim_basis_change() from public, anon, authenticated;
grant execute on function public.bridge_revoke_release_on_claim_basis_change() to service_role;
drop trigger if exists bridge_revoke_release_on_claim_basis_change on public.claims;
create trigger bridge_revoke_release_on_claim_basis_change after insert or update or delete on public.claims
  for each row execute function public.bridge_revoke_release_on_claim_basis_change();
drop trigger if exists bridge_revoke_release_on_claim_evidence_change on public.claim_evidence_links;
create trigger bridge_revoke_release_on_claim_evidence_change after insert or update or delete on public.claim_evidence_links
  for each row execute function public.bridge_revoke_release_on_claim_basis_change();

-- Revocation of a release certificate is terminal for that certificate.
-- Do not infer current certificate state from timestamp ordering alone: two
-- history rows can share the same timestamp, and UUID ordering is not temporal.

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

revoke all on function public.bridge_release_case(uuid, uuid, uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.bridge_release_case(uuid, uuid, uuid, uuid, uuid, text) to service_role;
