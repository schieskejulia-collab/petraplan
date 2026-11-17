-- Explicit administrative grant, disabled for every existing actor.
alter table public.bridge_actor_roles
  add column can_approve_invoice_exception boolean not null default false,
  add column invoice_exception_authority_reference text;

create table public.invoice_exception_requests (
  id uuid primary key default gen_random_uuid(),
  record_id uuid not null references public.records(id),
  snapshot_id uuid not null unique references public.bridge_invoice_evidence(snapshot_id),
  validation_id uuid not null references public.validation_results(id),
  requested_by uuid not null references auth.users(id),
  reason text not null check(length(btrim(reason))>=8),
  evidence_reference text not null check(length(btrim(evidence_reference))>=3),
  purpose text not null check(length(btrim(purpose))>=3),
  created_at timestamptz not null default clock_timestamp()
);
create table public.invoice_exception_decisions (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique references public.invoice_exception_requests(id),
  actor_id uuid not null references auth.users(id),
  decision text not null check(decision in ('APPROVED','REJECTED')),
  reason text not null check(length(btrim(reason))>=8),
  authority_reference text not null,
  validation_id uuid unique references public.validation_results(id),
  created_at timestamptz not null default clock_timestamp()
);
alter table public.invoice_exception_requests enable row level security;
alter table public.invoice_exception_decisions enable row level security;
revoke all on public.invoice_exception_requests, public.invoice_exception_decisions
  from public,anon,authenticated,service_role;
grant select,insert on public.invoice_exception_requests,public.invoice_exception_decisions to service_role;
create trigger exception_requests_immutable before update or delete on public.invoice_exception_requests
  for each row execute function public.bridge_evidence_immutable();
create trigger exception_decisions_immutable before update or delete on public.invoice_exception_decisions
  for each row execute function public.bridge_evidence_immutable();
create trigger exception_requests_no_truncate before truncate on public.invoice_exception_requests
  for each statement execute function public.bridge_evidence_immutable();
create trigger exception_decisions_no_truncate before truncate on public.invoice_exception_decisions
  for each statement execute function public.bridge_evidence_immutable();

create function public.bridge_invoice_exception_basis(p_record_id uuid,p_snapshot_id uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  v_e public.bridge_invoice_evidence%rowtype;
  v_source public.ingestion_logs%rowtype;
begin
  if not exists(select 1 from public.records where id=p_record_id and ingestion_log_id=p_snapshot_id) then
    raise sqlstate 'PT409' using message='Invoice snapshot changed';
  end if;
  select * into v_e from public.bridge_invoice_evidence where record_id=p_record_id and snapshot_id=p_snapshot_id;
  select * into v_source from public.ingestion_logs where id=p_snapshot_id and status='processed';
  if v_e.original_pdf is null or v_source.id is null
    or coalesce(v_source.extracted_schema#>>'{pdfComparison,status}','') not in ('DIFFERENT','NOT_COMPARABLE')
    or v_source.extracted_schema#>'{technicalEvidence,accepted}' is distinct from 'true'::jsonb
    or v_source.extracted_schema#>>'{technicalEvidence,validatorDecision}' is distinct from 'accept'
    or v_source.extracted_schema#>'{decision,blockers}' is distinct from '["PDF_VISUAL_AMOUNT_CONFLICT"]'::jsonb
    or v_source.source_hash is distinct from encode(sha256(v_e.invoice_xml),'hex')
    or v_source.extracted_schema#>>'{pdfComparison,pdfSha256}' is distinct from encode(sha256(v_e.original_pdf),'hex')
    or v_source.extracted_schema#>>'{technicalEvidence,reportSha256}' is distinct from encode(sha256(v_e.kosit_report),'hex') then
    raise sqlstate 'PT409' using message='Exception requires accepted XML and only an unresolved PDF representation';
  end if;
  return jsonb_build_object('source_hash',v_source.source_hash,'source_snapshot_id',p_snapshot_id,
    'report_sha256',encode(sha256(v_e.kosit_report),'hex'),'pdf_sha256',encode(sha256(v_e.original_pdf),'hex'),
    'original_validation_id',v_e.validation_id);
end;
$$;

create function public.bridge_request_invoice_exception(
 p_record_id uuid,p_snapshot_id uuid,p_validation_id uuid,p_actor_id uuid,
 p_reason text,p_evidence_reference text,p_purpose text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_request uuid; v_latest uuid;
begin
  perform 1 from public.bridge_actor_roles where user_id=p_actor_id and active and can_review for share;
  if not found then raise sqlstate 'PT403' using message='Review permission required'; end if;
  perform 1 from public.records where id=p_record_id for update;
  perform public.bridge_invoice_exception_basis(p_record_id,p_snapshot_id);
  select v.id into v_latest from public.validation_results v join public.conflicts c on c.id=v.conflict_id
    where c.record_id=p_record_id order by v.created_at desc,v.id limit 1;
  if v_latest is distinct from p_validation_id or not exists(select 1 from public.bridge_invoice_evidence
    where snapshot_id=p_snapshot_id and validation_id=p_validation_id) then
    raise sqlstate 'PT409' using message='Invoice validation changed';
  end if;
  insert into public.invoice_exception_requests(record_id,snapshot_id,validation_id,requested_by,reason,evidence_reference,purpose)
    values(p_record_id,p_snapshot_id,p_validation_id,p_actor_id,btrim(p_reason),btrim(p_evidence_reference),btrim(p_purpose))
    returning id into v_request;
  return jsonb_build_object('request_id',v_request,'status','PENDING');
end;
$$;

create function public.bridge_check_invoice_exception(p_record_id uuid,p_validation_id uuid)
returns boolean language plpgsql security invoker set search_path='' as $$
declare v_decision public.invoice_exception_decisions%rowtype; v_request public.invoice_exception_requests%rowtype;
  v_e public.bridge_invoice_evidence%rowtype; v_role public.bridge_actor_roles%rowtype;
begin
  select * into v_decision from public.invoice_exception_decisions where validation_id=p_validation_id and decision='APPROVED';
  if not found then return false; end if;
  select * into v_request from public.invoice_exception_requests where id=v_decision.request_id;
  if v_request.record_id is distinct from p_record_id then return false; end if;
  select * into v_e from public.bridge_invoice_evidence where snapshot_id=v_request.snapshot_id and record_id=p_record_id;
  select * into v_role from public.bridge_actor_roles where user_id=v_decision.actor_id
    and active and can_review and can_release and can_approve_invoice_exception
    and invoice_exception_authority_reference=v_decision.authority_reference;
  if not found or length(btrim(coalesce(v_role.invoice_exception_authority_reference,'')))<3
    or v_e.actor_id=v_decision.actor_id or v_request.requested_by=v_decision.actor_id then return false; end if;
  if exists(select 1 from public.review_records r join public.resolution_records rr on rr.id=r.resolution_record_id
    join public.validation_results v on v.id=r.validation_result_id
    where rr.conflict_id=v.conflict_id and v.evidence->>'source_snapshot_id'=v_request.snapshot_id::text
      and r.reviewer_id=v_decision.actor_id::text and r.created_at<=v_decision.created_at) then return false; end if;
  perform public.bridge_invoice_exception_basis(p_record_id,v_request.snapshot_id);
  return true;
exception when sqlstate 'PT409' then return false;
end;
$$;

create function public.bridge_decide_invoice_exception(
 p_request_id uuid,p_actor_id uuid,p_decision text,p_reason text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_request public.invoice_exception_requests%rowtype; v_role public.bridge_actor_roles%rowtype;
 v_e public.bridge_invoice_evidence%rowtype; v_old public.validation_results%rowtype;
 v_id uuid := gen_random_uuid(); v_validation uuid; v_basis jsonb; v_now timestamptz;
begin
  if p_decision not in ('APPROVED','REJECTED') or length(btrim(coalesce(p_reason,'')))<8 then
    raise sqlstate 'PT400' using message='Explicit exception decision and reason required';
  end if;
  select * into v_role from public.bridge_actor_roles where user_id=p_actor_id and active and can_review
    and can_release and can_approve_invoice_exception for share;
  if not found or length(btrim(coalesce(v_role.invoice_exception_authority_reference,'')))<3 then
    raise sqlstate 'PT403' using message='Documented invoice exception authority required';
  end if;
  select * into v_request from public.invoice_exception_requests where id=p_request_id;
  if not found then raise sqlstate 'PT404' using message='Exception request not found'; end if;
  perform 1 from public.records where id=v_request.record_id for update;
  v_basis := public.bridge_invoice_exception_basis(v_request.record_id,v_request.snapshot_id);
  select * into v_e from public.bridge_invoice_evidence where snapshot_id=v_request.snapshot_id;
  if p_actor_id in (v_request.requested_by,v_e.actor_id)
    or exists(select 1 from public.review_records r join public.validation_results v on v.id=r.validation_result_id
      where v.evidence->>'source_snapshot_id'=v_request.snapshot_id::text and r.reviewer_id=p_actor_id::text) then
    raise sqlstate 'PT403' using message='Exception decision requires a person independent of uploader, requester and prior reviewers';
  end if;
  if exists(select 1 from public.invoice_exception_decisions where request_id=p_request_id) then
    raise sqlstate 'PT409' using message='Exception already decided';
  end if;
  select v.* into v_old from public.validation_results v join public.conflicts c on c.id=v.conflict_id
    where c.record_id=v_request.record_id order by v.created_at desc,v.id limit 1;
  if v_old.id is distinct from v_request.validation_id then
    raise sqlstate 'PT409' using message='Invoice validation changed';
  end if;
  v_now := clock_timestamp();
  if p_decision='APPROVED' then
    insert into public.validation_results(conflict_id,resolution_record_id,validation_type,status,reason,evidence,created_at)
      values(v_old.conflict_id,v_old.resolution_record_id,'business_rule','passed',
        'XML zur begrenzten Verwendung unter dokumentierter PDF-Ausnahme geprüft',
        v_basis || jsonb_build_object('invoice_exception_id',v_id,'contract','en16931-invoice-v1',
          'purpose',v_request.purpose),v_now) returning id into v_validation;
  end if;
  insert into public.invoice_exception_decisions(id,request_id,actor_id,decision,reason,authority_reference,validation_id,created_at)
    values(v_id,p_request_id,p_actor_id,p_decision,btrim(p_reason),v_role.invoice_exception_authority_reference,v_validation,v_now);
  return jsonb_build_object('decision_id',v_id,'validation_id',v_validation,'status',p_decision);
end;
$$;

-- Bind every subsequent review and certificate to the independent decision.
create function public.bridge_guard_invoice_exception_action() returns trigger
language plpgsql security invoker set search_path='' as $$
declare v_id uuid; v_record uuid; v_actor text; v_decision public.invoice_exception_decisions%rowtype;
begin
  select (evidence->>'invoice_exception_id')::uuid into v_id
    from public.validation_results where id=new.validation_result_id;
  if v_id is null then return new; end if;
  select * into v_decision from public.invoice_exception_decisions where id=v_id and validation_id=new.validation_result_id;
  select record_id into v_record from public.invoice_exception_requests where id=v_decision.request_id;
  perform 1 from public.bridge_actor_roles where user_id=v_decision.actor_id for share;
  if tg_table_name='review_decisions' then v_actor:=new.reviewer_id::text;
  else v_actor:=new.certified_by::text;
  end if;
  if v_actor is distinct from v_decision.actor_id::text
    or not public.bridge_check_invoice_exception(v_record,new.validation_result_id) then
    raise sqlstate 'PT403' using message='Current independent exception approver must perform review and release';
  end if;
  if tg_table_name='release_certificates' then
    new.truth_snapshot := new.truth_snapshot || jsonb_build_object('invoice_exception_id',v_id);
    new.certificate_hash := encode(sha256(convert_to(new.truth_snapshot::text,'UTF8')),'hex');
  end if;
  return new;
end;
$$;
create trigger zzz_invoice_exception_review before insert on public.review_decisions
  for each row execute function public.bridge_guard_invoice_exception_action();
create trigger zzz_invoice_exception_certificate before insert on public.release_certificates
  for each row execute function public.bridge_guard_invoice_exception_action();

do $$
declare f regprocedure;
begin
  for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in ('bridge_invoice_exception_basis','bridge_request_invoice_exception',
      'bridge_check_invoice_exception','bridge_decide_invoice_exception','bridge_guard_invoice_exception_action')
  loop
    execute format('revoke all on function %s from public,anon,authenticated',f);
    execute format('grant execute on function %s to service_role',f);
  end loop;
end $$;

-- The audit for a review is written after its decision in the same transaction.
create function public.bridge_require_exception_delivery_evidence() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if new.decision='approved' and exists (
    select 1 from public.invoice_exception_decisions d
    join public.invoice_exception_requests request on request.id=d.request_id
    join public.ingestion_logs source on source.id=request.snapshot_id
    where d.validation_id=new.validation_result_id
      and source.extracted_schema#>'{technicalEvidence,messages}' @> '[{"code":"BR-DE-TMP-32"}]'::jsonb
  ) and not exists(select 1 from public.bridge_decision_audit audit
    where audit.review_decision_id=new.id and audit.action='approve_review'
      and jsonb_typeof(audit.details#>'{criteria,delivery_period_evidence}')='string'
      and length(btrim(audit.details#>>'{criteria,delivery_period_evidence}'))>=3) then
    raise sqlstate 'PT409' using message='BR-DE-TMP-32 requires a delivery or service period evidence reference';
  end if;
  return null;
end;
$$;
revoke all on function public.bridge_require_exception_delivery_evidence() from public,anon,authenticated;
grant execute on function public.bridge_require_exception_delivery_evidence() to service_role;
create constraint trigger invoice_exception_delivery_evidence after insert on public.review_decisions
  deferrable initially deferred for each row execute function public.bridge_require_exception_delivery_evidence();
