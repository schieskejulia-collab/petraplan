-- Read-only project-pilot comparison. This is not a tenant permission model,
-- a duplicate adjudication, or a release guard. No decision tables are written.
create function public.bridge_invoice_duplicate_row(p_record_id uuid)
returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object(
   'recordId',r.id,'snapshotId',e.snapshot_id,'title',left(r.title,300),
   'xmlSha256',encode(sha256(e.invoice_xml),'hex'),
   'pdfSha256',case when e.original_pdf is null then null else encode(sha256(e.original_pdf),'hex') end,
   'proofBound',coalesce(i.status='processed'
     and i.source_hash=encode(sha256(e.invoice_xml),'hex')
     and i.extracted_schema->>'contract'='en16931-invoice-v1'
     and i.extracted_schema->>'sourceSha256'=i.source_hash
     and e.basis_hash=encode(sha256(convert_to(jsonb_set(i.extracted_schema,'{technicalEvidence}',
       (i.extracted_schema->'technicalEvidence')-'reportSha256')::text,'UTF8')),'hex')
     and i.extracted_schema#>>'{technicalEvidence,invoiceSha256}'=i.source_hash
     and i.extracted_schema#>>'{technicalEvidence,reportSha256}'=encode(sha256(e.kosit_report),'hex')
     and v.evidence->>'source_snapshot_id'=e.snapshot_id::text
     and v.evidence->>'source_hash'=i.source_hash
     and v.evidence->>'report_sha256'=encode(sha256(e.kosit_report),'hex'),false),
   'accepted',coalesce(i.extracted_schema#>'{technicalEvidence,accepted}'='true'::jsonb
     and i.extracted_schema#>>'{technicalEvidence,validatorDecision}'='accept',false),
   'signals',case when octet_length((i.extracted_schema->'duplicateSignals')::text)<=24576
     then i.extracted_schema->'duplicateSignals' else null end)
 from public.records r
 join public.bridge_invoice_evidence e on e.record_id=r.id and e.snapshot_id=r.ingestion_log_id
 join public.ingestion_logs i on i.id=e.snapshot_id
 join public.validation_results v on v.id=e.validation_id
 where r.id=p_record_id and r.source_system='petraplan-invoice' and r.category='invoice';
$$;

create function public.bridge_invoice_duplicate_candidates(
 p_record_id uuid,p_snapshot_id uuid,p_actor_id uuid,p_scope text,p_limit integer default 200
) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare v_target jsonb; v_others jsonb; v_ids uuid[]; v_more boolean;
begin
 if p_scope is distinct from 'single-project-pilot' then
   raise sqlstate 'PT403' using message='Explicit single-project pilot scope required';
 end if;
 if not exists(select 1 from public.bridge_actor_roles where user_id=p_actor_id and active and can_review) then
   raise sqlstate 'PT403' using message='Active review permission required';
 end if;
 if p_limit is null or p_limit<1 or p_limit>200 then
   raise sqlstate 'PT400' using message='Comparison limit must be between 1 and 200';
 end if;
 v_target:=public.bridge_invoice_duplicate_row(p_record_id);
 if v_target is null then raise sqlstate 'PT404' using message='Current invoice evidence not found'; end if;
 if v_target->>'snapshotId' is distinct from p_snapshot_id::text then
   raise sqlstate 'PT409' using message='Invoice snapshot changed; refresh comparison';
 end if;
 select array_agg(id order by id) into v_ids from (
   select r.id from public.records r
   where r.category='invoice' and r.source_system='petraplan-invoice' and r.id<>p_record_id
   order by r.id limit p_limit+1
 ) selected;
 v_more:=coalesce(array_length(v_ids,1)>p_limit,false);
 select coalesce(jsonb_agg(jsonb_build_object('recordId',id,'basis',public.bridge_invoice_duplicate_row(id)) order by id),'[]'::jsonb)
   into v_others from unnest(v_ids[1:p_limit]) as selected(id);
 return jsonb_build_object('contract','invoice-duplicate-read-v1','scope',p_scope,
   'target',v_target,'others',v_others,'truncated',v_more,'limit',p_limit,
   'observedAt',statement_timestamp());
end;
$$;
revoke all on function public.bridge_invoice_duplicate_row(uuid) from public,anon,authenticated;
revoke all on function public.bridge_invoice_duplicate_candidates(uuid,uuid,uuid,text,integer) from public,anon,authenticated;
grant execute on function public.bridge_invoice_duplicate_row(uuid) to service_role;
grant execute on function public.bridge_invoice_duplicate_candidates(uuid,uuid,uuid,text,integer) to service_role;
