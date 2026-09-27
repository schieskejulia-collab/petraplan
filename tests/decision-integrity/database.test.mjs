import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { before, beforeEach, afterEach, after, test } from 'node:test';
import assert from 'node:assert/strict';
const db = new PGlite();
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const [record, snapshot, actor, candidate, address, conflict, resolution, validation, review, session, decision, structure, criterion] = Array.from({length:13},(_,i)=>id(i+1));
before(async () => {
 await db.exec(await readFile(new URL('./schema.sql', import.meta.url), 'utf8'));
 await db.exec((await readFile(new URL('../../db/address_layer.sql', import.meta.url), 'utf8')).replace('create extension if not exists pgcrypto;', ''));
 await db.exec(await readFile(new URL('../../supabase/migrations/20260927222002_chinch64_decision_integrity.sql', import.meta.url), 'utf8'));
 await db.exec(await readFile(new URL('../../supabase/migrations/20260927222450_chinch64_existing_basis_guard.sql', import.meta.url), 'utf8'));
 await db.exec('grant all on all tables in schema public to service_role');
});
beforeEach(async () => {
 await db.exec('begin');
 await db.query(`insert into ingestion_logs values ($1,'processed','source-hash','{"untouched":true}');`, [snapshot]);
 await db.query('insert into records values ($1,$2)',[record,snapshot]);
 await db.query('insert into bridge_actor_roles values ($1,true,true,true)',[actor]);
 await db.query(`insert into address_registry (id,source_id,first_snapshot_id,first_record_id,address,kind,source_path,registered_at) values ($1,'northwind',$2,$3,'order.STATUS','field','order.ShippedDate',now())`,[address,snapshot,record]);
 await db.query(`insert into conversion_candidates (id,candidate_key,record_id,snapshot_id,source_address_id,source_path,conversion_kind,evidence,state,created_at) values ($1,'STATUS-DERIVATION',$2,$3,$4,'order.ShippedDate','derive','test evidence','candidate',now())`,[candidate,record,snapshot,address]);
 await db.query('insert into conflicts values ($1,$2)',[conflict,record]);
 await db.query('insert into resolution_records values ($1,$2)',[resolution,conflict]);
 await db.query(`insert into validation_results (id,conflict_id,resolution_record_id,status,created_at) values ($1,$2,$3,'passed','2026-09-01T00:00:00Z')`,[validation,conflict,resolution]);
 await db.query('insert into review_records values ($1,$2,$3)',[review,resolution,validation]);
 await db.query('insert into review_sessions (id,review_record_id,structure_id,validation_result_id) values ($1,$2,$3,$4)',[session,review,structure,validation]);
 await db.query(`insert into review_decisions (id,review_session_id,decision,final,reviewer_authorized,reviewer_id,authorization_level,evidence_checked,criteria_checked,reason,decided_at,validation_result_id,evidence_refs) values ($1,$2,'approved',true,true,$3,'reviewer',true,true,'Reviewed evidence',now(),$4,$5)`,[decision,session,actor,validation,[`ingestion:${snapshot}`,`validation:${validation}`]]);
 await db.query('insert into review_criteria values ($1,$2,true)',[criterion,structure]);
 await db.query('insert into review_criterion_results (review_session_id,criterion_id,passed) values ($1,$2,true)',[session,criterion]);
});
afterEach(()=>db.exec('rollback'));
after(()=>db.close());
const decide = (state='confirmed', overrides={}) => db.query('select bridge_decide_candidate($1,$2,$3,$4,$5,$6,$7) as result',[overrides.record??record,candidate,overrides.snapshot??snapshot,overrides.actor??actor,state,overrides.reason??'Explicit test decision',null]);
const release = (overrides={}) => db.query('select bridge_release_case($1,$2,$3,$4,$5,$6) as result',[record,overrides.snapshot??snapshot,overrides.validation??validation,overrides.session??session,overrides.actor??actor,'Explicit test release']);
async function fails(fn, code) {
 await db.exec('savepoint expected_failure');
 await assert.rejects(fn, e => e.code === code);
 await db.exec('rollback to expected_failure');
}
async function count(table) { return (await db.query(`select count(*)::int as n from ${table}`)).rows[0].n; }
async function rejectCandidate() { await decide('rejected'); }

test('candidate decision and history are committed together without altering source or release',async()=>{
 const source = await db.query('select * from ingestion_logs');
 await decide();
 assert.equal((await db.query('select state from conversion_candidates')).rows[0].state,'confirmed');
 const history=(await db.query('select * from candidate_state_history')).rows[0];
 assert.equal(history.changed_by,actor); assert.equal(history.snapshot_id,snapshot);
 assert.equal(history.reason,'Explicit test decision'); assert.equal(history.evidence_reference,'order.ShippedDate');
 assert.deepEqual(await db.query('select * from ingestion_logs'), source);
 assert.equal(await count('release_certificates'),0); assert.equal(await count('validation_results'),1);
});
test('history insert failure rolls back candidate update',async()=>{
 await db.exec(`create function fail_history() returns trigger language plpgsql as $$ begin raise exception 'forced history failure'; end $$;
 create trigger fail_history before insert on candidate_state_history for each row execute function fail_history();`);
 await fails(()=>decide(),'P0001');
 assert.equal((await db.query('select state from conversion_candidates')).rows[0].state,'candidate');
 assert.equal(await count('candidate_state_history'),0);
});
test('repeated or opposite decision cannot overwrite a decided candidate',async()=>{
 await decide(); await fails(()=>decide(),'PT409'); await fails(()=>decide('rejected'),'PT409');
 assert.equal(await count('candidate_state_history'),1);
});
test('missing role, reason, wrong case, and changed snapshot reject without writes',async()=>{
 await fails(()=>decide('confirmed',{actor:id(90)}),'PT403');
 await fails(()=>decide('confirmed',{reason:' '}),'PT400');
 await fails(()=>decide('confirmed',{record:id(90)}),'PT404');
 await fails(()=>decide('confirmed',{snapshot:id(90)}),'PT409');
 assert.equal(await count('candidate_state_history'),0);
});
test('candidate linked to another snapshot cannot be decided',async()=>{
 await db.query(`insert into ingestion_logs values ($1,'processed','other-hash','{}')`,[id(90)]);
 await db.query('update conversion_candidates set snapshot_id=$1',[id(90)]);
 await fails(()=>decide(),'PT409');
});
test('unprocessed snapshot blocks both decision and release',async()=>{
 await db.exec("update ingestion_logs set status='pending'");
 await fails(()=>decide(),'PT409'); await fails(()=>release(),'PT409');
});
test('browser roles cannot execute either RPC',async()=>{
 for(const role of ['anon','authenticated']) {
  await db.exec(`set local role ${role}`);
  await fails(()=>decide(),'42501'); await fails(()=>release(),'42501');
  await db.exec('reset role');
 }
});
test('release requires release permission and no open candidates',async()=>{
 await fails(()=>release(),'PT409'); await rejectCandidate();
 await fails(()=>release({actor:id(90)}),'PT403'); assert.equal(await count('release_certificates'),0);
});
test('review for older passing validation does not authorize new validation',async()=>{
 await rejectCandidate();
 await db.query(`insert into validation_results (id,conflict_id,resolution_record_id,status) values ($1,$2,$3,'passed')`,[id(90),conflict,resolution]);
 await fails(()=>release(),'PT409'); await fails(()=>release({validation:id(90)}),'PT409');
 assert.equal(await count('release_certificates'),0);
});
test('new incomplete review blocks reuse of an older approved review',async()=>{
 await rejectCandidate();
 await db.query('insert into review_sessions (id,review_record_id,structure_id,validation_result_id) values ($1,$2,$3,$4)',[id(90),review,structure,validation]);
 await fails(()=>release(),'PT409');
});
test('all review layers and snapshot evidence must match',async()=>{
 await rejectCandidate();
 await db.query('update review_sessions set validation_result_id=$1',[id(90)]);
 await fails(()=>release(),'PT409');
 await db.query('update review_sessions set validation_result_id=$1',[validation]);
 await db.exec("update review_decisions set evidence_refs='{}'");
 await fails(()=>release(),'PT409');
});
test('missing or failed required criteria block release',async()=>{
 await rejectCandidate();
 await db.exec('update review_criterion_results set passed=false'); await fails(()=>release(),'PT409');
 await db.exec('delete from review_criterion_results'); await fails(()=>release(),'PT409');
});
test('negative validation cannot produce a release',async()=>{
 await rejectCandidate(); await db.exec("update validation_results set status='failed'");
 await fails(()=>release(),'PT409');
});
test('release stores exact basis atomically and repeat is idempotent',async()=>{
 await rejectCandidate(); const result=(await release()).rows[0].result;
 const cert=(await db.query('select * from release_certificates')).rows[0];
 assert.equal(cert.validation_result_id,validation); assert.equal(cert.review_decision_id,decision);
 assert.equal(cert.truth_snapshot.source_snapshot_id,snapshot); assert.equal(cert.truth_snapshot.source_hash,'source-hash');
 assert.equal(cert.certificate_hash.length,64);
 assert.equal(await count('release_logs'),1); assert.equal(await count('bridge_decision_audit'),1);
 const repeat=(await release()).rows[0].result;
 assert.equal(repeat.certificate_id,result.certificate_id); assert.equal(repeat.reused,true);
 assert.equal(await count('release_certificates'),1); assert.equal(await count('release_status_history'),1);
});
test('audit insert failure rolls back certificate, history, and log',async()=>{
 await rejectCandidate();
 await db.exec(`create function fail_audit() returns trigger language plpgsql as $$ begin raise exception 'forced audit failure'; end $$;
 create trigger fail_audit before insert on bridge_decision_audit for each row execute function fail_audit();`);
 await fails(()=>release(),'P0001');
 for(const table of ['release_certificates','release_logs','release_status_history','bridge_decision_audit']) assert.equal(await count(table),0);
});
test('re-release after a new review creates a new certificate and preserves the old basis',async()=>{
 await rejectCandidate(); await release();
 const old=(await db.query('select * from release_certificates')).rows[0];
 await db.query(`insert into validation_results (id,conflict_id,resolution_record_id,status) values ($1,$2,$3,'passed')`,[id(90),conflict,resolution]);
 await db.query('insert into review_records values ($1,$2,$3)',[id(91),resolution,id(90)]);
 await db.query('insert into review_sessions (id,review_record_id,structure_id,validation_result_id) values ($1,$2,$3,$4)',[id(92),id(91),structure,id(90)]);
 await db.query(`insert into review_decisions (id,review_session_id,decision,final,reviewer_authorized,reviewer_id,authorization_level,evidence_checked,criteria_checked,reason,decided_at,validation_result_id,evidence_refs) values ($1,$2,'approved',true,true,$3,'reviewer',true,true,'New reviewed evidence',clock_timestamp(),$4,$5)`,[id(93),id(92),actor,id(90),[`ingestion:${snapshot}`,`validation:${id(90)}`]]);
 await db.query('insert into review_criterion_results (review_session_id,criterion_id,passed) values ($1,$2,true)',[id(92),criterion]);
 const result=(await release({validation:id(90),session:id(92)})).rows[0].result;
 assert.notEqual(result.certificate_id,old.id);
 assert.deepEqual((await db.query('select * from release_certificates where id=$1',[old.id])).rows[0],old);
 assert.equal(await count('release_certificates'),2);
});
test('service role can execute RPCs while browser roles remain denied',async()=>{
 await db.exec('set local role service_role');
 await decide('rejected'); await release();
 await db.exec('reset role');
 assert.equal(await count('release_certificates'),1);
});
test('stale or revoked exact release basis cannot be reissued',async()=>{
 await rejectCandidate(); const old=(await release()).rows[0].result.certificate_id;
 await db.query("insert into release_status_history (release_certificate_id,new_status,changed_by,reason) values ($1,'revoked',$2,'Explicit revocation')",[old,actor]);
 await fails(()=>release(),'PT409');
 assert.equal(await count('release_certificates'),1);
 const history=(await db.query('select new_status from release_status_history where release_certificate_id=$1 order by created_at desc',[old])).rows;
 assert.equal(history[0].new_status,'revoked');
});
