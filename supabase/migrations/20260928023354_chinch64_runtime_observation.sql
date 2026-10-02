-- Chinch64 real runtime observation for new Bridge cases.
--
-- This does NOT claim Node/Vercel process internals. It records only what
-- Postgres can directly observe when a new Bridge case row is persisted.
-- Historical rows are untouched.

create or replace function public.bridge_observe_case_persistence()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_ingestion public.ingestion_logs%rowtype;
  v_operation_id uuid;
  v_operation_span uuid := gen_random_uuid();
  v_runtime_span uuid := gen_random_uuid();
begin
  if new.ingestion_log_id is null then
    return new;
  end if;

  select * into v_ingestion
  from public.ingestion_logs
  where id = new.ingestion_log_id;

  if not found or v_ingestion.trace_id is null or v_ingestion.span_id is null then
    return new;
  end if;

  insert into public.operation_logs (
    record_id,
    operation_name,
    operation_result,
    execution_time,
    status,
    correlation_id,
    causation_id,
    trace_id,
    span_id,
    parent_span_id
  ) values (
    new.id,
    'persist_bridge_case',
    jsonb_build_object(
      'observation_source', 'postgres_trigger',
      'observed_event', 'records_insert',
      'resolved_targets', jsonb_build_array(
        jsonb_build_object('kind', 'table', 'address', 'public.records'),
        jsonb_build_object('kind', 'record', 'address', new.id::text),
        jsonb_build_object('kind', 'ingestion', 'address', new.ingestion_log_id::text)
      ),
      'source_system', new.source_system,
      'source_reference', new.source_reference,
      'record_status', new.status,
      'claim_scope', 'database_persistence_only'
    ),
    null,
    'success',
    v_ingestion.correlation_id,
    v_ingestion.span_id,
    v_ingestion.trace_id,
    v_operation_span,
    v_ingestion.span_id
  )
  returning id into v_operation_id;

  insert into public.runtime_logs (
    record_id,
    operation_id,
    error_trace,
    stack_info,
    severity,
    correlation_id,
    causation_id,
    trace_id,
    span_id,
    parent_span_id
  ) values (
    new.id,
    v_operation_id,
    null,
    jsonb_build_object(
      'runtime_layer', 'postgres',
      'observer', 'bridge_observe_case_persistence',
      'observed_event', 'AFTER INSERT ON public.records',
      'record_id', new.id,
      'ingestion_id', new.ingestion_log_id,
      'evidence_scope', 'database runtime observation',
      'source_truth_mutated', false
    ),
    'info',
    v_ingestion.correlation_id,
    v_operation_span,
    v_ingestion.trace_id,
    v_runtime_span,
    v_operation_span
  );

  return new;
end;
$$;

revoke all on function public.bridge_observe_case_persistence() from public, anon, authenticated;
grant execute on function public.bridge_observe_case_persistence() to service_role;

drop trigger if exists bridge_observe_case_persistence on public.records;
create trigger bridge_observe_case_persistence
after insert on public.records
for each row execute function public.bridge_observe_case_persistence();

comment on function public.bridge_observe_case_persistence() is
  'Creates operation/runtime evidence only for the database persistence event directly observed when a new Bridge record is inserted; it does not assert Node/Vercel internals.';
