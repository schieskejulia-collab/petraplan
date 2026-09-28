-- Chinch64 evidence-safe trace linkage.
-- New rows get technical trace context without inventing historical relationships.
-- Existing explicit trace values win. Causation/parent links are only filled from
-- direct persisted relationships (operation_id, validation_result_id, review_decision_id).

create or replace function public.bridge_trace_root_ingestion()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.correlation_id := coalesce(new.correlation_id, gen_random_uuid());
  new.trace_id := coalesce(new.trace_id, gen_random_uuid());
  new.span_id := coalesce(new.span_id, gen_random_uuid());
  return new;
end;
$$;

create or replace function public.bridge_trace_operation()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_ingestion public.ingestion_logs%rowtype;
begin
  select i.* into v_ingestion
  from public.records r
  join public.ingestion_logs i on i.id = r.ingestion_log_id
  where r.id = new.record_id;

  new.correlation_id := coalesce(new.correlation_id, v_ingestion.correlation_id, gen_random_uuid());
  new.trace_id := coalesce(new.trace_id, v_ingestion.trace_id, gen_random_uuid());
  new.span_id := coalesce(new.span_id, gen_random_uuid());
  -- record_id establishes flow membership, not direct causation.
  return new;
end;
$$;

create or replace function public.bridge_trace_runtime()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_operation public.operation_logs%rowtype;
  v_ingestion public.ingestion_logs%rowtype;
begin
  if new.operation_id is not null then
    select * into v_operation from public.operation_logs where id = new.operation_id;
  end if;

  if v_operation.id is null and new.record_id is not null then
    select i.* into v_ingestion
    from public.records r
    join public.ingestion_logs i on i.id = r.ingestion_log_id
    where r.id = new.record_id;
  end if;

  new.correlation_id := coalesce(new.correlation_id, v_operation.correlation_id, v_ingestion.correlation_id, gen_random_uuid());
  new.trace_id := coalesce(new.trace_id, v_operation.trace_id, v_ingestion.trace_id, gen_random_uuid());
  new.span_id := coalesce(new.span_id, gen_random_uuid());

  if v_operation.id is not null then
    new.parent_span_id := coalesce(new.parent_span_id, v_operation.span_id);
    new.causation_id := coalesce(new.causation_id, v_operation.span_id);
  end if;
  return new;
end;
$$;

create or replace function public.bridge_trace_validation()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_operation public.operation_logs%rowtype;
  v_ingestion public.ingestion_logs%rowtype;
begin
  if new.operation_id is not null then
    select * into v_operation from public.operation_logs where id = new.operation_id;
  end if;

  select i.* into v_ingestion
  from public.conflicts c
  join public.records r on r.id = c.record_id
  join public.ingestion_logs i on i.id = r.ingestion_log_id
  where c.id = new.conflict_id;

  new.correlation_id := coalesce(new.correlation_id, v_operation.correlation_id, v_ingestion.correlation_id, gen_random_uuid());
  new.trace_id := coalesce(new.trace_id, v_operation.trace_id, v_ingestion.trace_id, gen_random_uuid());
  new.span_id := coalesce(new.span_id, gen_random_uuid());

  if v_operation.id is not null then
    new.parent_span_id := coalesce(new.parent_span_id, v_operation.span_id);
    new.causation_id := coalesce(new.causation_id, v_operation.span_id);
  end if;
  return new;
end;
$$;

create or replace function public.bridge_trace_review_session()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_validation public.validation_results%rowtype;
begin
  if new.validation_result_id is not null then
    select * into v_validation from public.validation_results where id = new.validation_result_id;
  end if;

  new.correlation_id := coalesce(new.correlation_id, v_validation.correlation_id, gen_random_uuid());
  new.trace_id := coalesce(new.trace_id, v_validation.trace_id, gen_random_uuid());
  new.span_id := coalesce(new.span_id, gen_random_uuid());

  if v_validation.id is not null then
    new.parent_span_id := coalesce(new.parent_span_id, v_validation.span_id);
    new.causation_id := coalesce(new.causation_id, v_validation.span_id);
  end if;
  return new;
end;
$$;

create or replace function public.bridge_trace_release_certificate()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_session public.review_sessions%rowtype;
  v_validation public.validation_results%rowtype;
begin
  if new.review_decision_id is not null then
    select s.* into v_session
    from public.review_decisions d
    join public.review_sessions s on s.id = d.review_session_id
    where d.id = new.review_decision_id;
  end if;

  if new.validation_result_id is not null then
    select * into v_validation from public.validation_results where id = new.validation_result_id;
  end if;

  new.correlation_id := coalesce(new.correlation_id, v_session.correlation_id, v_validation.correlation_id, gen_random_uuid());
  new.trace_id := coalesce(new.trace_id, v_session.trace_id, v_validation.trace_id, gen_random_uuid());
  new.span_id := coalesce(new.span_id, gen_random_uuid());

  if v_session.id is not null then
    new.parent_span_id := coalesce(new.parent_span_id, v_session.span_id);
    new.causation_id := coalesce(new.causation_id, v_session.span_id);
  elsif v_validation.id is not null then
    new.parent_span_id := coalesce(new.parent_span_id, v_validation.span_id);
    new.causation_id := coalesce(new.causation_id, v_validation.span_id);
  end if;
  return new;
end;
$$;

drop trigger if exists bridge_trace_root_ingestion_before_insert on public.ingestion_logs;
create trigger bridge_trace_root_ingestion_before_insert
before insert on public.ingestion_logs
for each row execute function public.bridge_trace_root_ingestion();

drop trigger if exists bridge_trace_operation_before_insert on public.operation_logs;
create trigger bridge_trace_operation_before_insert
before insert on public.operation_logs
for each row execute function public.bridge_trace_operation();

drop trigger if exists bridge_trace_runtime_before_insert on public.runtime_logs;
create trigger bridge_trace_runtime_before_insert
before insert on public.runtime_logs
for each row execute function public.bridge_trace_runtime();

drop trigger if exists bridge_trace_validation_before_insert on public.validation_results;
create trigger bridge_trace_validation_before_insert
before insert on public.validation_results
for each row execute function public.bridge_trace_validation();

drop trigger if exists bridge_trace_review_session_before_insert on public.review_sessions;
create trigger bridge_trace_review_session_before_insert
before insert on public.review_sessions
for each row execute function public.bridge_trace_review_session();

drop trigger if exists bridge_trace_release_certificate_before_insert on public.release_certificates;
create trigger bridge_trace_release_certificate_before_insert
before insert on public.release_certificates
for each row execute function public.bridge_trace_release_certificate();

comment on function public.bridge_trace_root_ingestion() is 'Creates root technical trace IDs for new source ingestions only.';
comment on function public.bridge_trace_operation() is 'Joins operations to the source trace by record membership without inventing causation.';
comment on function public.bridge_trace_runtime() is 'Links runtime evidence causally only when operation_id directly identifies its parent operation.';
comment on function public.bridge_trace_validation() is 'Keeps validation in the case trace; causal parent is recorded only when operation_id is explicit.';
comment on function public.bridge_trace_review_session() is 'Links review session to its explicit validation basis.';
comment on function public.bridge_trace_release_certificate() is 'Links release certificate to its explicit review decision/session basis, falling back to explicit validation basis.';
