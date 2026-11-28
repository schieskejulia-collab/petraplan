-- Single-project pilot. No live migration. Install only together with the
-- release/ingest enforcement and status integration; this file alone is not a gate.
alter table public.bridge_actor_roles
 add column can_adjudicate_invoice_duplicates boolean not null default false,
 add column invoice_duplicate_authority_reference text;
create table public.invoice_duplicate_decisions (
 id uuid primary key default gen_random_uuid(),
 decision_order bigint generated always as identity unique,
 record_id uuid not null references public.records(id),
 snapshot_id uuid not null references public.bridge_invoice_evidence(snapshot_id),
 corpus_hash text not null check(corpus_hash ~ '^[a-f0-9]{64}$'),
 actor_id uuid not null references auth.users(id),
 action text not null check(action in ('CLEAR','DISTINCT','PRIMARY','DUPLICATE','HOLD')),
 reason text not null check(length(btrim(reason)) between 8 and 4000),
 evidence_reference text not null check(length(btrim(evidence_reference)) between 3 and 2000),
 authority_reference text,
 assessment jsonb not null,
 peer_decision_ids uuid[] not null default '{}',
 created_at timestamptz not null default clock_timestamp()
);
alter table public.invoice_duplicate_decisions enable row level security;
revoke all on public.invoice_duplicate_decisions from public,anon,authenticated,service_role;
grant select,insert on public.invoice_duplicate_decisions to service_role;
grant usage on sequence public.invoice_duplicate_decisions_decision_order_seq to service_role;
create trigger duplicate_decisions_immutable before update or delete on public.invoice_duplicate_decisions
 for each row execute function public.bridge_evidence_immutable();
create trigger duplicate_decisions_no_truncate before truncate on public.invoice_duplicate_decisions
 for each statement execute function public.bridge_evidence_immutable();

create function public.bridge_invoice_duplicate_review_basis(p_record_id uuid,p_snapshot_id uuid,p_actor_id uuid)
returns jsonb language plpgsql volatile security invoker set search_path='' as $$
declare r jsonb; corpus jsonb; h text; decisions jsonb;
begin
 r:=public.bridge_invoice_duplicate_candidates(p_record_id,p_snapshot_id,p_actor_id,'single-project-pilot',200);
 -- Target and peers use the same representation, hence the same corpus hash.
 select jsonb_agg(value order by value->>'recordId') into corpus from (
  select jsonb_build_object('recordId',r#>>'{target,recordId}','basis',r->'target') as value union all
  select e from jsonb_array_elements(r->'others') e
 ) items;
 h:=encode(sha256(convert_to(corpus::text,'UTF8')),'hex');
 select coalesce(jsonb_agg(to_jsonb(d)),'[]'::jsonb) into decisions from (
  select distinct on (record_id) * from public.invoice_duplicate_decisions
  where corpus_hash=h order by record_id,decision_order desc
 ) d;
 return jsonb_build_object('read',r,'corpusHash',h,'decisions',decisions);
end;
$$;

create function public.bridge_decide_invoice_duplicates(p_record_id uuid,p_snapshot_id uuid,p_actor_id uuid,
 p_corpus_hash text,p_action text,p_reason text,p_evidence_reference text,p_assessment jsonb,p_peer_decision_ids uuid[] default '{}')
returns jsonb language plpgsql volatile security invoker set search_path='' as $$
declare b jsonb; role_row public.bridge_actor_roles%rowtype; decision_id uuid; peer uuid; n integer;
begin
 perform pg_advisory_xact_lock(20261128,500);
 if current_setting('transaction_isolation')<>'read committed' then
  raise sqlstate 'PT409' using message='Duplicate decisions require READ COMMITTED'; end if;
 select * into role_row from public.bridge_actor_roles where user_id=p_actor_id and active and can_review for share;
 if not found then raise sqlstate 'PT403' using message='Active review permission required'; end if;
 perform 1 from public.records where id=p_record_id for update;
 b:=public.bridge_invoice_duplicate_review_basis(p_record_id,p_snapshot_id,p_actor_id);
 if p_corpus_hash is distinct from b->>'corpusHash' then
  raise sqlstate 'PT409' using message='Comparison corpus changed'; end if;
 if p_action is null or p_action not in ('CLEAR','DISTINCT','PRIMARY','DUPLICATE','HOLD')
  or length(btrim(coalesce(p_reason,''))) not between 8 and 4000
  or length(btrim(coalesce(p_evidence_reference,''))) not between 3 and 2000
  or p_assessment->>'contract' is distinct from 'invoice-duplicate-review-v1'
  or p_assessment#>>'{target,recordId}' is distinct from p_record_id::text
  or p_assessment#>>'{target,snapshotId}' is distinct from p_snapshot_id::text
  or p_assessment#>>'{target,xmlSha256}' is distinct from b#>>'{read,target,xmlSha256}' then
  raise sqlstate 'PT400' using message='Bound assessment, reason and evidence required'; end if;
 if p_action in ('CLEAR','DISTINCT','PRIMARY') then
  if b#>'{read,truncated}' is distinct from 'false'::jsonb
   or p_assessment#>'{coverage,scanTruncated}' is distinct from 'false'::jsonb
   or p_assessment#>'{coverage,findingsTruncated}' is distinct from 'false'::jsonb
   or p_assessment#>'{coverage,unusableBasis}' is distinct from '0'::jsonb
   or p_assessment#>'{coverage,incompleteSignals}' is distinct from '0'::jsonb
   or p_assessment#>'{coverage,otherCasesRead}' is distinct from to_jsonb(jsonb_array_length(b#>'{read,others}')) then
   raise sqlstate 'PT409' using message='Incomplete comparison cannot authorize release'; end if;
 end if;
 if p_action='CLEAR' and (p_assessment->>'status' is distinct from 'NO_MATCH_IN_SUPPORTED_CHECKS'
   or p_assessment->'findingCount' is distinct from '0'::jsonb) then
  raise sqlstate 'PT409' using message='CLEAR requires a complete comparison without findings'; end if;
 if p_action in ('DISTINCT','PRIMARY') then
  if not role_row.can_adjudicate_invoice_duplicates or length(btrim(coalesce(role_row.invoice_duplicate_authority_reference,'')))<3
   or exists(select 1 from public.bridge_invoice_evidence where snapshot_id=p_snapshot_id and actor_id=p_actor_id)
   or exists(select 1 from public.review_decisions d join public.validation_results v on v.id=d.validation_result_id
    join public.conflicts c on c.id=v.conflict_id where c.record_id=p_record_id and d.reviewer_id::text=p_actor_id::text) then
   raise sqlstate 'PT403' using message='Independent appointed duplicate adjudicator required'; end if;
  if p_assessment->>'status' is distinct from 'REVIEW_SUGGESTED' then
   raise sqlstate 'PT409' using message='Adjudication requires findings'; end if;
  if p_action='DISTINCT' and exists(select 1 from jsonb_array_elements(p_assessment->'findings') f where f->>'code'='IDENTICAL_XML') then
   raise sqlstate 'PT409' using message='Identical XML cannot be declared distinct'; end if;
 end if;
 if p_action='PRIMARY' then
  n:=jsonb_array_length(p_assessment->'findings');
  if cardinality(p_peer_decision_ids) is distinct from n or n=0 then
   raise sqlstate 'PT409' using message='Every finding needs a blocked copy decision'; end if;
  for peer in select unnest(p_peer_decision_ids) loop
   if not exists(select 1 from jsonb_array_elements(b->'decisions') d
      where d->>'id'=peer::text and d->>'action'='DUPLICATE'
      and exists(select 1 from jsonb_array_elements(p_assessment->'findings') f where f->>'recordId'=d->>'record_id')) then
    raise sqlstate 'PT409' using message='Copy decision is not current'; end if;
  end loop;
  if (select count(distinct x) from unnest(p_peer_decision_ids) x)<>n then
   raise sqlstate 'PT409' using message='Repeated copy decision'; end if;
 elsif cardinality(p_peer_decision_ids) is distinct from 0 then
  raise sqlstate 'PT400' using message='Peer decisions only apply to PRIMARY';
 end if;
 insert into public.invoice_duplicate_decisions(record_id,snapshot_id,corpus_hash,actor_id,action,reason,evidence_reference,
 authority_reference,assessment,peer_decision_ids) values(p_record_id,p_snapshot_id,p_corpus_hash,p_actor_id,p_action,btrim(p_reason),
 btrim(p_evidence_reference),case when p_action in ('DISTINCT','PRIMARY') then role_row.invoice_duplicate_authority_reference end,
 p_assessment,p_peer_decision_ids) returning id into decision_id;
 return jsonb_build_object('decisionId',decision_id,'action',p_action,'corpusHash',p_corpus_hash);
end;
$$;
revoke all on function public.bridge_invoice_duplicate_review_basis(uuid,uuid,uuid) from public,anon,authenticated;
revoke all on function public.bridge_decide_invoice_duplicates(uuid,uuid,uuid,text,text,text,text,jsonb,uuid[]) from public,anon,authenticated;
grant execute on function public.bridge_invoice_duplicate_review_basis(uuid,uuid,uuid) to service_role;
grant execute on function public.bridge_decide_invoice_duplicates(uuid,uuid,uuid,text,text,text,text,jsonb,uuid[]) to service_role;
