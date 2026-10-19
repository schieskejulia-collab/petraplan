-- Fail closed on a negative semantic rule decision even when no Claim carries
-- the optional rule_id/rule_version linkage. Keep the existing Claim evidence
-- trigger for explicitly linked Claims; this is an independent case-level guard.
-- No positive release is created by this migration.
create or replace function public.bridge_revoke_release_on_semantic_rule_decision()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare
  v_record uuid;
  v_claim uuid;
begin
  if new.decision not in ('REVOKED', 'SUPERSEDED') then
    return new;
  end if;

  select record_id, claim_id into v_record, v_claim
  from public.semantic_rule_versions
  where id = new.rule_version_id;

  if v_record is null or v_claim is null then
    raise sqlstate 'PT409' using message = 'Negative semantic rule decision lacks its case or Claim basis';
  end if;

  -- The decision insert guard already serializes on the same records row.
  -- This function preserves the existing terminal history and audit contract.
  perform public.bridge_revoke_release_for_claim_change(
    v_record, v_claim, new.actor_id::text,
    'semantic_rule_decisions:' || new.decision
  );
  return new;
end;
$$;

revoke all on function public.bridge_revoke_release_on_semantic_rule_decision()
  from public, anon, authenticated;
grant execute on function public.bridge_revoke_release_on_semantic_rule_decision()
  to service_role;

drop trigger if exists bridge_semantic_rule_case_release_guard
  on public.semantic_rule_decisions;
create trigger bridge_semantic_rule_case_release_guard
  after insert on public.semantic_rule_decisions
  for each row execute function public.bridge_revoke_release_on_semantic_rule_decision();
