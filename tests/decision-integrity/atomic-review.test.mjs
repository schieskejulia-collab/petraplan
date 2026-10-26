import { before,after,beforeEach,afterEach,test } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { id,ids,criteria,reviewTables,installAtomicReviewFixture,seedAtomicReviewFixture,seedCandidate,claim,review,issueFixtureCertificate,revoke } from './atomic-review-fixture.mjs';

const db=new PGlite();
before(async()=>{await installAtomicReviewFixture(db);await seedAtomicReviewFixture(db);});
beforeEach(()=>db.exec('begin'));
afterEach(()=>db.exec('rollback'));
after(()=>db.close());
const count=async table=>(await db.query(`select count(*)::int n from public.${table}`)).rows[0].n;
async function fails(fn,code) {
 await db.exec('savepoint expected_failure');
 await assert.rejects(fn,error=>error.code===code);
 await db.exec('rollback to expected_failure');
}
async function inject(table) {
 await db.exec(`create function public.inject_atomic_failure() returns trigger language plpgsql as $$ begin raise exception 'Injected atomic failure'; end $$;
 create trigger injected_failure before insert on public.${table} for each row execute function public.inject_atomic_failure();`);
}

test('review commits the exact actor, source, validation, criteria and audit in one transaction',async()=>{
 const source=await db.query('select * from public.ingestion_logs');
 await db.exec('set local role service_role');
 const result=(await review(db)).rows[0].result;
 assert.equal(result.reused,false);
 for(const table of reviewTables) assert.equal(await count(table),table==='review_criterion_results'?3:1);
 const decision=(await db.query('select * from public.review_decisions')).rows[0];
 assert.equal(decision.reviewer_id,ids.actor);assert.equal(decision.validation_result_id,ids.validation);
 assert.equal(decision.authorization_level,'technical_reviewer');
 assert.ok(decision.evidence_refs.includes(`ingestion:${ids.snapshot}`));
 assert.ok(decision.evidence_refs.some(ref=>ref.startsWith('claims:')));
 const log=(await db.query('select * from public.review_logs')).rows[0];
 assert.equal(log.event_type,'decision_committed');
 assert.deepEqual(await db.query('select * from public.ingestion_logs'),source);
 assert.equal(await count('release_certificates'),0);
});

for(const table of reviewTables) test(`failure inserting ${table} rolls back every review write`,async()=>{
 await inject(table);await fails(()=>review(db),'P0001');
 for(const target of reviewTables) assert.equal(await count(target),0,`${target} survived failed ${table}`);
});

test('identical retry reuses one review; a competing decision cannot overwrite it',async()=>{
 const first=(await review(db)).rows[0].result;
 const again=(await review(db)).rows[0].result;
 assert.equal(again.reused,true);assert.equal(again.review_decision_id,first.review_decision_id);
 assert.equal(await count('review_records'),1);assert.equal(await count('bridge_decision_audit'),1);
 await fails(()=>review(db,{decision:'rejected'}),'PT409');
});

test('snapshot, validation, Claim basis and reviewer permission are rechecked in SQL',async()=>{
 for(const override of [{snapshot:id(91)},{validation:id(91)},{basis:'b'.repeat(64)}]) await fails(()=>review(db,override),'PT409');
 await db.exec('update public.bridge_actor_roles set active=false');
 await fails(()=>review(db),'PT403');
 for(const table of reviewTables) assert.equal(await count(table),0);
});

test('a changed source hash, an open candidate or negative validation blocks approval',async()=>{
 await db.exec("update public.validation_results set evidence='{}'");
 await fails(()=>review(db),'PT409');
 await db.query('update public.validation_results set evidence=$1',[{source_hash:'a'.repeat(64)}]);
 await seedCandidate(db,'candidate');
 await fails(()=>review(db),'PT409');
 await db.exec('delete from public.conversion_candidates');
 await db.exec("update public.validation_results set status='failed'");
 await fails(()=>review(db),'PT409');
 const rejected=(await review(db,{decision:'rejected',criteria:{}})).rows[0].result;
 assert.equal(rejected.reused,false);
 const decision=(await db.query('select * from public.review_decisions')).rows[0];
 assert.equal(decision.decision,'rejected');assert.equal(decision.criteria_checked,false);
 assert.equal(await count('release_certificates'),0);
});

test('Claim, observed evidence links and safety revocation commit together without confirming meaning',async()=>{
 const cert=await issueFixtureCertificate(db);
 const candidate=await seedCandidate(db);
 const result=(await claim(db,candidate)).rows[0].result;
 assert.ok(result.claim_id);assert.equal(result.release_invalidation.effectiveStatus,'revoked');
 assert.equal(await count('claims'),1);assert.equal(await count('claim_evidence_links'),4);
 const row=(await db.query('select * from public.claims')).rows[0];
 assert.equal(row.status,'UNPROVEN');assert.equal(row.created_by,ids.actor);assert.equal(row.producer_role,'technical_reviewer');
 assert.equal(row.snapshot_id,ids.snapshot);assert.equal(row.subject_address,candidate.address);
 assert.equal((await db.query('select public.bridge_current_release($1) r',[ids.record])).rows[0].r.certificate_id,cert);
 assert.equal(await count('release_status_history'),1);assert.equal(await count('release_logs'),1);
 await fails(()=>claim(db,candidate),'PT409');
});

for(const table of ['claims','claim_evidence_links','release_status_history','release_logs','bridge_decision_audit']) test(`failed ${table} during Claim creation rolls back Claim, links and revocation`,async()=>{
 await issueFixtureCertificate(db);const candidate=await seedCandidate(db);
 const auditBefore=await count('bridge_decision_audit');
 await inject(table);await fails(()=>claim(db,candidate),'P0001');
 assert.equal(await count('claims'),0);assert.equal(await count('claim_evidence_links'),0);
 assert.equal(await count('release_status_history'),0);assert.equal(await count('release_logs'),0);assert.equal(await count('audit_log'),0);
 assert.equal(await count('bridge_decision_audit'),auditBefore);
 assert.equal((await db.query('select public.bridge_current_release($1) r',[ids.record])).rows[0].r.effective_status,'trusted');
});

test('Claim creation rechecks candidate state, source scope and actor without inventing authority',async()=>{
 const candidate=await seedCandidate(db);
 await fails(()=>claim(db,candidate,{snapshot:id(99)}),'PT409');
 await fails(()=>claim(db,candidate,{subject:'unlinked:target'}),'PT409');
 await fails(()=>claim(db,candidate,{actor:id(99)}),'PT403');
 await db.exec("update public.conversion_candidates set state='rejected'");
 await fails(()=>claim(db,candidate),'PT409');
 assert.equal(await count('claims'),0);
});

test('missing configured criteria, explicit false and nonboolean confirmations cannot approve',async()=>{
 await fails(()=>review(db,{criteria:{...criteria,blockers_resolved:false}}),'PT409');
 await fails(()=>review(db,{criteria:{...criteria,blockers_resolved:'true'}}),'PT400');
 await db.exec("delete from public.review_criteria where criterion_key='blockers_resolved'");
 await fails(()=>review(db),'PT409');
 for(const table of reviewTables) assert.equal(await count(table),0);
});

test('newer or unresolved Claims and equal-timestamp validations fail closed',async()=>{
 await db.query(`insert into public.claims(claim_family_id,claim_type,subject_address,predicate,statement,status,scope_type,created_by,record_id)
 values($1,'SEMANTIC_MAPPING','fixture:target','means','Unverified fixture meaning','UNPROVEN','CASE_ONLY',$2,$3)`,[id(40),ids.actor,ids.record]);
 await fails(()=>review(db),'PT409');
 await db.exec('delete from public.claims');
 await db.query(`insert into public.validation_results(id,conflict_id,resolution_record_id,validation_type,status,reason,created_at)
 values($1,$2,$3,'business_rule','passed','Tied fixture validation','2026-10-01T11:00:00Z')`,[id(41),ids.conflict,ids.resolution]);
 await fails(()=>review(db),'PT409');
});

test('manual revocation commits history, allowed log type and audit atomically; retry does not duplicate',async()=>{
 const cert=await issueFixtureCertificate(db);
 const before=await count('bridge_decision_audit');
 const result=(await revoke(db,cert)).rows[0].result;
 assert.equal(result.transitioned,true);assert.equal(result.effectiveStatus,'revoked');
 assert.equal(await count('release_status_history'),1);assert.equal(await count('release_logs'),1);
 assert.equal(await count('bridge_decision_audit'),before+1);
 assert.equal((await revoke(db,cert)).rows[0].result.transitioned,false);
 assert.equal(await count('release_status_history'),1);
});

for(const table of ['release_status_history','release_logs','bridge_decision_audit','audit_log']) test(`failure inserting ${table} rolls back the full revocation`,async()=>{
 const cert=await issueFixtureCertificate(db);
 const auditBefore=await count('bridge_decision_audit');
 await inject(table);await fails(()=>revoke(db,cert),'P0001');
 assert.equal(await count('release_status_history'),0);assert.equal(await count('release_logs'),0);
 assert.equal(await count('audit_log'),0);
 assert.equal(await count('bridge_decision_audit'),auditBefore);
 assert.equal((await db.query('select public.bridge_current_release($1) r',[ids.record])).rows[0].r.effective_status,'trusted');
});

test('revocation checks actor, latest certificate and actual negative validation again',async()=>{
 const cert=await issueFixtureCertificate(db);
 await fails(()=>revoke(db,id(99)),'PT409');
 await fails(()=>revoke(db,cert,{actor:id(99)}),'PT403');
 await db.query(`insert into public.validation_results(id,conflict_id,resolution_record_id,validation_type,status,reason,created_at)
 values($1,$2,$3,'business_rule','failed','Later negative validation','2026-10-01T12:00:00.000001Z')`,[id(42),ids.conflict,ids.resolution]);
 await fails(()=>revoke(db,cert,{mode:'validation',validation:ids.validation}),'PT409');
 assert.equal((await revoke(db,cert,{mode:'validation',validation:id(42)})).rows[0].result.transitioned,true);
});

test('browser roles cannot invoke the review or revocation RPC',async()=>{
 for(const role of ['anon','authenticated']) {
  await db.exec(`set local role ${role}`);
  await fails(()=>db.query('select public.bridge_commit_review($1,$2,$3,$4,$5,$6,$7,$8)',[ids.record,ids.snapshot,ids.validation,'a'.repeat(64),ids.actor,'approved','Explicit review',criteria]),'42501');
  await fails(()=>revoke(db,id(30)),'42501');
  await db.exec('reset role');
 }
});
