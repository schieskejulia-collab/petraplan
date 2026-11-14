-- Keep the existing RPC signature so review and release enforce the same basis
-- under their existing case lock. A confirmation must precede its validation.
create or replace function public.bridge_claims_after_validation(
  p_record_id uuid, p_validation_id uuid
) returns boolean language sql stable security invoker set search_path = '' as $$
  select coalesce((
    select v.created_at is null
      or r.ingestion_log_id is null
      or exists (
        select 1
        from public.claims claim
        where claim.record_id = r.id
          and claim.status in ('UNPROVEN', 'SUPPORTED', 'CONFIRMED', 'CONTESTED')
          and claim.created_at > v.created_at
      )
      or exists (
        select 1
        from public.conversion_candidates candidate
        where candidate.record_id = r.id
          and candidate.snapshot_id = r.ingestion_log_id
          and candidate.state = 'confirmed'
          and coalesce((
            select max(history.changed_at)
            from public.candidate_state_history history
            where history.candidate_id = candidate.id
              and history.snapshot_id = candidate.snapshot_id
              and history.state = 'confirmed'
          ), 'infinity'::timestamptz) >= v.created_at
      )
    from public.validation_results v
    join public.conflicts c on c.id = v.conflict_id
    join public.records r on r.id = c.record_id
    where v.id = p_validation_id and r.id = p_record_id
  ), true);
$$;

revoke all on function public.bridge_claims_after_validation(uuid, uuid) from public, anon, authenticated;
grant execute on function public.bridge_claims_after_validation(uuid, uuid) to service_role;
