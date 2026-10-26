import { readFile } from 'node:fs/promises';

export const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
export const ids={record:id(1),snapshot:id(2),actor:id(3),conflict:id(4),resolution:id(5),validation:id(6),rule:id(7),structure:id(8)};
export const sourceHash='a'.repeat(64);
export const criteria={source_truth_checked:true,translation_trace_checked:true,blockers_resolved:true};
export const reviewTables=['review_records','review_sessions','review_criterion_results','review_decisions','review_status_history','review_logs','bridge_decision_audit'];
export const read=path=>readFile(new URL(path,import.meta.url),'utf8');
const quote=value=>'"'+value.replaceAll('"','""')+'"';

/** Real observed columns/defaults and review constraints/triggers; adjacent
 * tables contain their observed columns but only the keys needed by the review
 * subschema. This is intentionally not described as a full Supabase replica. */
export async function installAtomicReviewFixture(db) {
 const metadata=JSON.parse(await read('../../docs/verification/2026-10-26-review-schema-observations.json'));
 const claimMetadata=JSON.parse(await read('../../docs/verification/2026-10-26-claim-write-schema-observations.json'));
 metadata.columns.push(...claimMetadata.columns);
 metadata.constraints.push(...claimMetadata.constraints);
 metadata.functions.push(...claimMetadata.functions);
 metadata.triggers.push(...claimMetadata.triggers);
 await db.exec(`do $$ begin
   if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if;
   if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
   if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role bypassrls; end if;
 end $$; create schema auth; create table auth.users(id uuid primary key);`);
 const tables=[...new Set(metadata.columns.map(c=>c.table))];
 for(const table of tables) {
  const columns=metadata.columns.filter(c=>c.table===table).map(c=>
   `${quote(c.name)} ${c.type}${c.default?' default '+c.default:''}${c.required?' not null':''}`);
  await db.exec(`create table public.${quote(table)}(${columns.join(',')})`);
 }
 for(const table of tables) {
  if(!metadata.constraints.some(c=>c.table===table && c.definition.startsWith('PRIMARY KEY')))
   await db.exec(`alter table public.${quote(table)} add primary key (${table==='bridge_actor_roles'?'user_id':'id'})`);
 }
 // Create every primary/unique/check constraint before attaching foreign keys.
 for(const foreign of [false,true]) for(const c of metadata.constraints.filter(c=>c.definition.startsWith('FOREIGN KEY')===foreign))
  await db.exec(`alter table public.${quote(c.table)} add constraint ${quote(c.name)} ${c.definition}`);
 for(const f of metadata.functions) await db.exec(f.definition);
 for(const t of metadata.triggers) await db.exec(t.definition);
 // Mirror the existing case lock on inserted validations for race exercises.
 await db.exec('create trigger bridge_lock_validation_basis before insert on public.validation_results for each row execute function public.bridge_lock_decision_basis();');
 await db.exec('grant usage on schema public,auth to service_role; grant all on all tables in schema public,auth to service_role; grant execute on all functions in schema public to service_role;');
 // Core helper functions are also kept inaccessible to browser roles.
 await db.exec('revoke execute on all functions in schema public from public,anon,authenticated;');
 const original=JSON.parse(await read('../../docs/verification/2026-10-26-original-schema-observations.json'));
 await db.exec('create table public.audit_log(id uuid primary key default gen_random_uuid(),actor_type text,table_name text,record_id uuid,action text,before_data jsonb,after_data jsonb,source text); grant all on public.audit_log to service_role;');
 await db.exec(original.triggers.find(t=>t.function==='audit_row_change').body);
 await db.exec(await read('../../supabase/migrations/20261026161308_release_history_integrity_guard.sql'));
 await db.exec(await read('../../supabase/migrations/20261026162914_atomic_review_and_revocation.sql'));
}

export async function seedAtomicReviewFixture(db) {
 const x=ids;
 await db.query('insert into auth.users values($1)',[x.actor]);
 await db.query(`insert into public.bridge_actor_roles(user_id,role_name,active,can_review,can_release,can_revoke) values($1,'technical_reviewer',true,true,true,true)`,[x.actor]);
 await db.query(`insert into public.ingestion_logs(id,source_system,raw_payload,status,source_hash,ingested_at) values($1,'isolated-fixture','{"amount":2}','processed',$2,'2026-10-01T10:00:00Z')`,[x.snapshot,sourceHash]);
 await db.query(`insert into public.records(id,ingestion_log_id,title,category,meaning) values($1,$2,'Atomic review fixture','test','Isolated technical review; no asserted external meaning')`,[x.record,x.snapshot]);
 await db.query(`insert into public.conflicts(id,record_id,conflict_type,reason,affected_fields,conflict) values($1,$2,'fixture','Isolated fixture','{}',false)`,[x.conflict,x.record]);
 await db.query(`insert into public.resolution_records(id,conflict_id,resolution_action_id,decision,resolution_reason,resolved_by_type,previous_status,new_status)
 values($1,$2,$3,'unresolved','Fixture resolution','system','warning','suggested')`,[x.resolution,x.conflict,id(90)]);
 await db.query(`insert into public.validation_results(id,conflict_id,resolution_record_id,validation_type,status,reason,evidence,created_at)
 values($1,$2,$3,'business_rule','passed','Fixture technical validation',$4,'2026-10-01T11:00:00Z')`,[x.validation,x.conflict,x.resolution,{source_hash:sourceHash}]);
 await db.query(`insert into public.review_rules(id,name,description,rule_scope) values($1,'PetraPlan live bridge review','Technical human review','all')`,[x.rule]);
 await db.query(`insert into public.review_structures(id,rule_id,name,required_fields) values($1,$2,'PetraPlan live bridge decision',$3)`,[x.structure,x.rule,Object.keys(criteria)]);
 for(const [n,key] of Object.keys(criteria).entries()) await db.query(`insert into public.review_criteria(id,structure_id,criterion_key,description) values($1,$2,$3,'Explicit fixture check')`,[id(20+n),x.structure,key]);
}

export async function seedCandidate(db,state='confirmed',n=50) {
 await db.query(`insert into public.address_registry(id,source_id,first_snapshot_id,first_record_id,address,kind,source_path,registered_at)
 values($1,'isolated-fixture',$2,$3,$4,'field','/amount','2026-10-01T10:00:00Z')`,[id(n),ids.snapshot,ids.record,`fixture:amount:${n}`]);
 await db.query(`insert into public.conversion_candidates(id,candidate_key,record_id,snapshot_id,source_address_id,source_path,proposed_value,conversion_kind,evidence,state,created_at)
 values($1,$2,$3,$4,$5,'/amount','2','map','Technical candidate observation',$6,'2026-10-01T10:30:00Z')`,
 [id(n+1),`candidate-${n}`,ids.record,ids.snapshot,id(n),state]);
 if(state==='confirmed') await db.query(`insert into public.candidate_state_history(id,candidate_id,snapshot_id,state,changed_by,changed_at,reason)
 values($1,$2,$3,'confirmed',$4,'2026-10-01T10:31:00Z','Explicit candidate confirmation')`,[id(n+2),id(n+1),ids.snapshot,ids.actor]);
 return {candidate:id(n+1),address:`fixture:amount:${n}`};
}

export async function claim(db,candidate,overrides={}) {
 return db.query('select public.bridge_create_explicit_claim($1,$2,$3,$4,$5,$6,$7) result',[
  overrides.record??ids.record,overrides.snapshot??ids.snapshot,candidate.candidate,overrides.actor??ids.actor,
  overrides.subject??candidate.address,overrides.type??'SEMANTIC_MAPPING',overrides.statement??'Explicit unproven meaning proposal',
 ]);
}

export async function review(db,overrides={}) {
 const basis=(await db.query('select public.bridge_claims_basis($1) b',[ids.record])).rows[0].b;
 return db.query('select public.bridge_commit_review($1,$2,$3,$4,$5,$6,$7,$8) result',[
  overrides.record??ids.record,overrides.snapshot??ids.snapshot,overrides.validation??ids.validation,overrides.basis??basis,
  overrides.actor??ids.actor,overrides.decision??'approved',overrides.reason??'Explicit technical review',overrides.criteria??criteria,
 ]);
}

export async function issueFixtureCertificate(db,n=30) {
 const result=(await review(db)).rows[0].result;
 const row=(await db.query('select review_record_id from public.review_sessions where id=$1',[result.review_session_id])).rows[0];
 await db.query(`insert into public.release_certificates(id,record_id,conflict_id,resolution_record_id,validation_result_id,review_record_id,review_decision_id,
 certified_by_type,certified_by,reason,truth_snapshot,certificate_hash,certified_at)
 values($1,$2,$3,$4,$5,$6,$7,'human',$8,'Fixture certificate','{}',$9,'2026-10-01T12:00:00Z')`,[
  id(n),ids.record,ids.conflict,ids.resolution,ids.validation,row.review_record_id,result.review_decision_id,ids.actor,sourceHash]);
 return id(n);
}

export async function revoke(db,certificate,overrides={}) {
 return db.query('select public.bridge_revoke_case($1,$2,$3,$4,$5,$6,$7) result',[
  overrides.record??ids.record,certificate,overrides.actor??ids.actor,overrides.reason??'Explicit safety revocation',
  overrides.mode??'manual',overrides.validation??null,overrides.claim??null,
 ]);
}
