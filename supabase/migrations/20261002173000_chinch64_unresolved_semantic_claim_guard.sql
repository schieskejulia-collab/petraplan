-- A refreshed validation cannot turn an unresolved semantic mapping into an
-- approved review or release. This gate does not approve any mapping rule.
create or replace function public.bridge_has_unresolved_semantic_claim(p_record_id uuid)
returns boolean language sql stable security invoker set search_path = '' as $$
  select exists (
    select 1 from public.claims c
    where c.record_id = p_record_id
      and c.claim_type = 'SEMANTIC_MAPPING'
      and c.status in ('DRAFT', 'UNPROVEN', 'SUPPORTED', 'CONTESTED')
  );
$$;
revoke all on function public.bridge_has_unresolved_semantic_claim(uuid) from public, anon, authenticated;
grant execute on function public.bridge_has_unresolved_semantic_claim(uuid) to service_role;

create or replace function public.bridge_guard_unresolved_semantic_review()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare v_record uuid;
begin
  if lower(coalesce(new.decision, '')) <> 'approved' then return new; end if;
  select c.record_id into v_record
  from public.review_sessions s
  join public.review_records r on r.id = s.review_record_id
  join public.resolution_records rr on rr.id = r.resolution_record_id
  join public.conflicts c on c.id = rr.conflict_id
  where s.id = new.review_session_id;
  if v_record is null then
    raise sqlstate 'PT409' using message = 'Review lacks a case';
  end if;
  perform 1 from public.records where id = v_record for update;
  if public.bridge_has_unresolved_semantic_claim(v_record) then
    raise sqlstate 'PT409' using message = 'An unresolved semantic mapping claim blocks review and release';
  end if;
  return new;
end;
$$;
revoke all on function public.bridge_guard_unresolved_semantic_review() from public, anon, authenticated;
grant execute on function public.bridge_guard_unresolved_semantic_review() to service_role;
create trigger bridge_guard_unresolved_semantic_review
  before insert or update of decision, review_session_id on public.review_decisions
  for each row execute function public.bridge_guard_unresolved_semantic_review();

create or replace function public.bridge_guard_unresolved_semantic_release()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  perform 1 from public.records where id = new.record_id for update;
  if public.bridge_has_unresolved_semantic_claim(new.record_id) then
    raise sqlstate 'PT409' using message = 'An unresolved semantic mapping claim blocks release';
  end if;
  return new;
end;
$$;
revoke all on function public.bridge_guard_unresolved_semantic_release() from public, anon, authenticated;
grant execute on function public.bridge_guard_unresolved_semantic_release() to service_role;
create trigger bridge_guard_unresolved_semantic_release
  before insert on public.release_certificates
  for each row execute function public.bridge_guard_unresolved_semantic_release();
