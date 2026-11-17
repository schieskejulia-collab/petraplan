-- Input is produced by the trusted local invoice worker from original XML and
-- its own KoSIT run. Hash checks bind the bytes; they do not authenticate KoSIT.
create table public.bridge_invoice_evidence (
  snapshot_id uuid primary key references public.ingestion_logs(id),
  record_id uuid not null references public.records(id),
  previous_snapshot_id uuid references public.bridge_invoice_evidence(snapshot_id),
  validation_id uuid not null unique references public.validation_results(id),
  actor_id uuid not null references auth.users(id),
  invoice_xml bytea not null,
  original_pdf bytea,
  kosit_report bytea not null,
  basis_hash text not null,
  created_at timestamptz not null default clock_timestamp()
);

alter table public.bridge_invoice_evidence enable row level security;
revoke all on public.bridge_invoice_evidence from public, anon, authenticated, service_role;
grant select, insert on public.bridge_invoice_evidence to service_role;

create trigger invoice_evidence_append_only
before update or delete on public.bridge_invoice_evidence
for each row execute function public.bridge_evidence_immutable();

create trigger invoice_evidence_no_truncate
before truncate on public.bridge_invoice_evidence
for each statement execute function public.bridge_evidence_immutable();

create function public.bridge_capture_invoice_case(
  p_record_id uuid, p_expected_snapshot_id uuid, p_actor_id uuid,
  p_invoice bytea, p_report bytea, p_result jsonb, p_pdf bytea default null
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_source_hash text;
  v_report_hash text;
  v_basis_hash text;
  v_number text;
  v_seller text;
  v_case public.records%rowtype;
  v_previous public.bridge_invoice_evidence%rowtype;
  v_technical jsonb;
  v_release jsonb;
  v_revocation jsonb;
  v_snapshot uuid;
  v_conflict uuid;
  v_action uuid;
  v_resolution uuid;
  v_validation uuid;
  v_passed boolean;
  v_status text;
  v_reason text;
  v_now timestamptz;
begin
  perform 1 from public.bridge_actor_roles where user_id=p_actor_id and active and can_review for share;
  if not found then raise sqlstate 'PT403' using message='Invoice capture requires review permission'; end if;

  if p_record_id is null or p_invoice is null or p_report is null
    or octet_length(p_invoice) not between 1 and 8388608
    or octet_length(p_report) not between 1 and 33554432
    or p_result->>'contract' is distinct from 'en16931-invoice-v1'
    or coalesce(p_result->>'syntax','') not in ('UBL','CII')
    or jsonb_typeof(p_result->'fields') is distinct from 'object'
    or p_result#>'{decision,releaseAllowed}' is distinct from 'false'::jsonb
    or coalesce(p_result#>>'{decision,status}','') not in ('BLOCKED','READY_FOR_REVIEW') then
    raise sqlstate 'PT400' using message='Invoice inspection and KoSIT report are required';
  end if;

  v_source_hash := encode(sha256(p_invoice),'hex');
  v_report_hash := encode(sha256(p_report),'hex');
  v_technical := p_result->'technicalEvidence';
  if p_result->>'sourceSha256' is distinct from v_source_hash
    or v_technical->>'invoiceSha256' is distinct from v_source_hash
    or v_technical->>'reportSha256' is distinct from v_report_hash
    or jsonb_typeof(v_technical->'accepted') is distinct from 'boolean' then
    raise sqlstate 'PT409' using message='Invoice and KoSIT evidence do not match their byte hashes';
  end if;
  v_passed := p_result#>>'{decision,status}' = 'READY_FOR_REVIEW';
  if (p_pdf is null and p_result ? 'pdfComparison')
    or (p_pdf is not null and (octet_length(p_pdf) not between 1 and 8388608 or v_passed
      or p_result#>>'{pdfComparison,pdfSha256}' is distinct from encode(sha256(p_pdf),'hex'))) then
    raise sqlstate 'PT409' using message='PDF evidence requires matching bytes and a pending visual review';
  end if;
  if v_passed and (v_technical->'accepted' is distinct from 'true'::jsonb
    or v_technical->>'validatorDecision' is distinct from 'accept'
    or p_result#>'{decision,blockers}' is distinct from '[]'::jsonb) then
    raise sqlstate 'PT409' using message='Invoice inspection lacks an accepted review basis';
  end if;
  v_number := case when p_result#>>'{fields,BT-1,status}' = 'observed'
    then nullif(btrim(p_result#>>'{fields,BT-1,values,0,original}'),'') end;
  v_seller := case when p_result#>>'{fields,BT-27,status}' = 'observed'
    then nullif(btrim(p_result#>>'{fields,BT-27,values,0,original}'),'') end;
  -- KoSIT report bytes contain a new timestamp on every run. Equivalent
  -- results retain the first report and never invalidate an existing review.
  v_basis_hash := encode(sha256(convert_to(jsonb_set(p_result,'{technicalEvidence}',
    v_technical - 'reportSha256')::text,'UTF8')),'hex');

  if p_expected_snapshot_id is null then
    insert into public.records(id,source_system,source_reference,title,category,type,meaning,status,metadata)
      values(p_record_id,'petraplan-invoice',v_number,'Rechnung '||coalesce(v_number,p_record_id::text),
        'invoice','bridge_translation','EN 16931 Rechnung mit KoSIT-Prüfbeleg','warning',jsonb_build_object('invoice_seller',v_seller))
      on conflict (id) do nothing;
  end if;
  select * into v_case from public.records where id=p_record_id for update;
  if not found or v_case.source_system is distinct from 'petraplan-invoice'
    or v_case.category is distinct from 'invoice' then
    raise sqlstate 'PT409' using message='The specified case is not an invoice case';
  end if;
  if v_case.ingestion_log_id is not null then
    select * into v_previous from public.bridge_invoice_evidence
      where snapshot_id=v_case.ingestion_log_id and record_id=p_record_id;
    if not found then raise sqlstate 'PT409' using message='Current invoice evidence is unavailable'; end if;
    if v_previous.basis_hash = v_basis_hash
      and (p_expected_snapshot_id is not distinct from v_previous.snapshot_id
        or p_expected_snapshot_id is not distinct from v_previous.previous_snapshot_id) then
      return jsonb_build_object('record_id',p_record_id,'snapshot_id',v_previous.snapshot_id,
        'validation_id',v_previous.validation_id,'status',p_result#>>'{decision,status}','reused',true);
    end if;
  end if;
  if v_case.ingestion_log_id is distinct from p_expected_snapshot_id then
    raise sqlstate 'PT409' using message='Invoice snapshot changed; reload the case';
  end if;
  if v_case.ingestion_log_id is not null and (
    (v_case.source_reference is not null and v_number is distinct from v_case.source_reference)
    or (v_case.metadata->>'invoice_seller' is not null and v_seller is distinct from v_case.metadata->>'invoice_seller')
  ) then
    raise sqlstate 'PT409' using message='Invoice identity differs from the selected case';
  end if;
  -- Revisions are explicit. Invoice numbers are not used to find a case.
  v_release := public.bridge_current_release(p_record_id);
  if coalesce((v_release->>'ambiguous')::boolean,true) then
    raise sqlstate 'PT409' using message='Release authority is ambiguous';
  end if;
  v_now := clock_timestamp();
  if exists(select 1 from public.validation_results v join public.conflicts c on c.id=v.conflict_id
    where c.record_id=p_record_id and (v.created_at is null or v.created_at>=v_now))
    or coalesce((v_release->>'certified_at')::timestamptz>=v_now,false) then
    raise sqlstate 'PT409' using message='Invoice revision time is not newer than the existing decision basis';
  end if;
  v_status := case when v_passed then 'passed' else 'failed' end;
  v_reason := case when v_passed then 'KoSIT-Prüfung bestanden. Fachliche Prüfung erforderlich.'
    else 'Rechnungsvertrag oder KoSIT-Prüfung blockiert.' end;

  insert into public.ingestion_logs(source_system,source_reference,source_hash,raw_payload,extracted_schema,status,ingested_at)
    values('petraplan-invoice',v_number,v_source_hash,jsonb_build_object('xml_sha256',v_source_hash),
      p_result,'processed',v_now) returning id into v_snapshot;
  update public.records set ingestion_log_id=v_snapshot,status=case when v_passed then 'valid' else 'warning' end,
    source_reference=coalesce(source_reference,v_number),
    metadata=metadata || jsonb_build_object('invoice_seller',coalesce(metadata->>'invoice_seller',v_seller)) where id=p_record_id;

  insert into public.conflicts(record_id,conflict,conflict_type,reason,affected_fields)
    values(p_record_id,not v_passed,'invoice_validation',v_reason,array['INVOICE']) returning id into v_conflict;
  insert into public.resolution_actions(conflict_id,action_type,action_payload,actor_type,actor_id,reason)
    values(v_conflict,'suggest',jsonb_build_object('invoice_snapshot_id',v_snapshot),'system','petraplan-invoice',v_reason)
    returning id into v_action;
  insert into public.resolution_records(conflict_id,resolution_action_id,decision,resolution_reason,resolved_by_type,previous_status,new_status)
    values(v_conflict,v_action,'unresolved',v_reason,'system','warning','suggested') returning id into v_resolution;

  insert into public.validation_results(conflict_id,resolution_record_id,validation_type,status,reason,evidence,created_at)
    values(v_conflict,v_resolution,'business_rule',v_status,v_reason,
      jsonb_build_object('contract','en16931-invoice-v1','source_hash',v_source_hash,
        'source_snapshot_id',v_snapshot,'report_sha256',v_report_hash),v_now) returning id into v_validation;

  insert into public.bridge_invoice_evidence(snapshot_id,record_id,previous_snapshot_id,validation_id,
    actor_id,invoice_xml,original_pdf,kosit_report,basis_hash,created_at)
    values(v_snapshot,p_record_id,p_expected_snapshot_id,v_validation,p_actor_id,p_invoice,p_pdf,p_report,v_basis_hash,v_now);

  if v_release->>'effective_status' in ('trusted','exception') then
    v_revocation := public.bridge_revoke_case(p_record_id,(v_release->>'certificate_id')::uuid,p_actor_id,
      'Rechnungsgrundlage ersetzt durch Snapshot '||v_snapshot::text,
      case when v_passed then 'manual' else 'validation' end,
      case when v_passed then null else v_validation end);
    if v_revocation->>'effectiveStatus' is distinct from 'revoked' then
      raise sqlstate 'PT409' using message='The previous release could not be revoked';
    end if;
  end if;
  return jsonb_build_object('record_id',p_record_id,'snapshot_id',v_snapshot,'validation_id',v_validation,
    'status',p_result#>>'{decision,status}','revocation',v_revocation,'reused',false);
end;
$$;

revoke all on function public.bridge_capture_invoice_case(uuid,uuid,uuid,bytea,bytea,jsonb,bytea)
  from public, anon, authenticated;
grant execute on function public.bridge_capture_invoice_case(uuid,uuid,uuid,bytea,bytea,jsonb,bytea)
  to service_role;

create function public.bridge_require_delivery_period_review() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if new.decision = 'approved' and exists (
    select 1 from public.bridge_invoice_evidence e
    join public.ingestion_logs source on source.id = e.snapshot_id
    where e.validation_id = new.validation_result_id
      and source.extracted_schema#>'{technicalEvidence,messages}' @> '[{"code":"BR-DE-TMP-32"}]'::jsonb
  ) and not exists (
    select 1 from public.bridge_decision_audit audit
    where audit.review_decision_id = new.id
      and audit.action = 'approve_review'
      and jsonb_typeof(audit.details#>'{criteria,delivery_period_evidence}') = 'string'
      and length(btrim(audit.details#>>'{criteria,delivery_period_evidence}')) >= 3
  ) then
    raise sqlstate 'PT409' using message = 'BR-DE-TMP-32 requires a delivery or service period evidence reference';
  end if;
  return null;
end;
$$;
revoke all on function public.bridge_require_delivery_period_review() from public, anon, authenticated;
grant execute on function public.bridge_require_delivery_period_review() to service_role;
create constraint trigger bridge_invoice_delivery_period_review
after insert on public.review_decisions deferrable initially deferred
for each row execute function public.bridge_require_delivery_period_review();
