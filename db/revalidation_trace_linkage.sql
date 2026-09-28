-- Chinch64 revalidation trace linkage.
-- Adds evidence-safe causal linkage for revalidation results without changing Source Truth.
--
-- For validation rows that explicitly declare evidence.revalidation=true, create a factual
-- operation observation for the persisted revalidation result and bind the validation span
-- to that operation. This does not claim Node/Vercel internals and does not backfill history.

create or replace function public.bridge_link_revalidation_validation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_record_id uuid;
  v_operation public.operation_logs%rowtype;
begin
  if coalesce((new.evidence ->> 'revalidation')::boolean, false) is not true then
    return new;
  end if;

  if new.parent_span_id is not null or new.causation_id is not null then
    return new;
  end if;

  select c.record_id
    into v_record_id
    from public.conflicts c
   where c.id = new.conflict_id;

  if v_record_id is null then
    return new;
  end if;

  insert into public.operation_logs (
    record_id,
    operation_name,
    operation_result,
    execution_time,
    status,
    correlation_id,
    trace_id
  )
  values (
    v_record_id,
    'persist_revalidation_result',
    jsonb_build_object(
      'observed_by', 'postgres_before_validation_insert',
      'validation_type', new.validation_type,
      'validation_status', new.status,
      'source_snapshot_id', new.evidence ->> 'source_snapshot_id',
      'confirmed_candidate_decisions', coalesce(new.evidence -> 'confirmed_candidate_decisions', '[]'::jsonb),
      'claim_scope', 'Database observed persistence of a revalidation result; no claim about application-runtime internals.'
    ),
    0,
    'success',
    new.correlation_id,
    new.trace_id
  )
  returning * into v_operation;

  new.correlation_id := coalesce(new.correlation_id, v_operation.correlation_id);
  new.trace_id := coalesce(new.trace_id, v_operation.trace_id);
  new.parent_span_id := v_operation.span_id;
  new.causation_id := v_operation.span_id;

  return new;
end;
$$;

drop trigger if exists bridge_link_revalidation_validation on public.validation_results;
create trigger bridge_link_revalidation_validation
before insert on public.validation_results
for each row
execute function public.bridge_link_revalidation_validation();

revoke all on function public.bridge_link_revalidation_validation() from public, anon, authenticated;
grant execute on function public.bridge_link_revalidation_validation() to service_role;
