import { before,after,beforeEach,test } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as pause } from 'node:timers/promises';
import pg from 'pg';
import { ids,id,criteria,reviewTables,installAtomicReviewFixture,seedAtomicReviewFixture,seedCandidate,claim,review,issueFixtureCertificate,revoke } from '../decision-integrity/atomic-review-fixture.mjs';

const url=new URL(process.env.PETRAPLAN_TEST_DATABASE_URL ?? 'invalid:');
if(!['localhost','127.0.0.1','[::1]'].includes(url.hostname) || url.pathname!=='/petraplan_test')
 throw new Error('These tests require an explicit local petraplan_test database; remote/production URLs are refused.');
const pool=new pg.Pool({connectionString:url.href,max:6,statement_timeout:15000});
const db={query:(...args)=>pool.query(...args),exec:sql=>pool.query(sql)};
const adapt=client=>({query:(...args)=>client.query(...args),exec:sql=>client.query(sql)});

before(async()=>{
 const version=(await db.query('show server_version')).rows[0].server_version;
 assert.match(version,/^17\./,'Concurrency proof must run on PostgreSQL 17');
});
beforeEach(async()=>{
 // Rebuild disposable test schemas; append-only history is never truncated.
 await db.exec('drop schema public cascade; drop schema if exists auth cascade; create schema public;');
 await installAtomicReviewFixture(db);
 await seedAtomicReviewFixture(db);
});
after(()=>pool.end());

async function waitForLock(pid) {
 const deadline=Date.now()+7000;
 while(Date.now()<deadline) {
  const row=(await db.query('select wait_event_type from pg_stat_activity where pid=$1',[pid])).rows[0];
  if(row?.wait_event_type==='Lock') return;
  await pause(20);
 }
 throw new Error('Expected concurrent connection to wait on a PostgreSQL lock');
}
async function race(first,second,finish='commit') {
 const a=await pool.connect(),b=await pool.connect();let outcome;
 try {
  await a.query('set role service_role');await b.query('set role service_role');
  await a.query('begin');
  const value=await first(adapt(a));
  const pid=(await b.query('select pg_backend_pid() pid')).rows[0].pid;
  outcome=Promise.resolve().then(()=>second(adapt(b))).then(value=>({value}),error=>({error}));
  await waitForLock(pid);
  await a.query(finish);
  return {first:value,second:await outcome};
 }finally {
  await a.query('rollback').catch(()=>{});
  if(outcome) await outcome;
  await a.query('reset role').catch(()=>{});await b.query('reset role').catch(()=>{});
  a.release();b.release();
 }
}

test('two overlapping identical reviews create one committed decision and one audited basis',async()=>{
 const r=await race(a=>review(a),b=>review(b));
 assert.equal(r.second.error,undefined);
 assert.equal(r.first.rows[0].result.reused,false);assert.equal(r.second.value.rows[0].result.reused,true);
 assert.equal(r.first.rows[0].result.review_decision_id,r.second.value.rows[0].result.review_decision_id);
 for(const table of reviewTables) assert.equal((await db.query(`select count(*)::int n from public.${table}`)).rows[0].n,table==='review_criterion_results'?3:1);
});

test('an overlapping opposite review cannot replace a final approved decision',async()=>{
 const r=await race(a=>review(a),b=>review(b,{decision:'rejected'}));
 assert.equal(r.second.error?.code,'PT409');
 assert.equal((await db.query('select decision from public.review_decisions')).rows[0].decision,'approved');
});

test('role withdrawn while review waits is rechecked after the role-row lock',async()=>{
 const r=await race(a=>a.query('update public.bridge_actor_roles set active=false where user_id=$1',[ids.actor]),b=>review(b));
 assert.equal(r.second.error?.code,'PT403');
 assert.equal((await db.query('select count(*)::int n from public.review_records')).rows[0].n,0);
});

test('a newly committed validation invalidates the older request waiting on the case lock',async()=>{
 const r=await race(a=>a.query(`insert into public.validation_results(id,conflict_id,resolution_record_id,validation_type,status,reason,created_at)
  values($1,$2,$3,'business_rule','failed','Concurrent negative validation','2026-10-01T11:00:00.000001Z')`,[id(80),ids.conflict,ids.resolution]),b=>review(b));
 assert.equal(r.second.error?.code,'PT409');
 assert.equal((await db.query('select count(*)::int n from public.review_records')).rows[0].n,0);
});

test('evidence committed while review waits defeats its old Claim fingerprint',async()=>{
 const candidate=await seedCandidate(db);
 const result=(await claim(db,candidate,{type:'SOURCE'})).rows[0].result;
 await db.query("update public.claims set created_at='2026-10-01T10:30:00Z'");
 const basis=(await db.query('select public.bridge_claims_basis($1) b',[ids.record])).rows[0].b;
 const r=await race(a=>a.query(`insert into public.claim_evidence_links(claim_id,evidence_type,evidence_reference,relation,directness,scope,linked_by,note)
  values($1,'SOURCE_SNAPSHOT','new-observation','QUALIFIES','DIRECT','{}',$2,'Concurrent additional evidence')`,[result.claim_id,ids.actor]),b=>review(b,{basis}));
 assert.equal(r.second.error?.code,'PT409');
 assert.match(r.second.error?.message,/Claims or evidence changed/);
 assert.equal((await db.query('select count(*)::int n from public.review_records')).rows[0].n,0);
});

test('required-criterion insertion waits until the review transaction has committed',async()=>{
 const r=await race(a=>review(a),b=>b.query(`insert into public.review_criteria(id,structure_id,criterion_key,description) values($1,$2,'new_required_check','Concurrent configuration change')`,[id(81),ids.structure]));
 assert.equal(r.second.error,undefined);
 assert.equal((await db.query('select count(*)::int n from public.review_criterion_results')).rows[0].n,3);
 assert.equal((await db.query('select count(*)::int n from public.review_criteria')).rows[0].n,4);
});

test('revocation rollback leaves no orphan event; a waiting revocation commits once',async()=>{
 const cert=await issueFixtureCertificate(db);
 const r=await race(a=>revoke(a,cert),b=>revoke(b,cert),'rollback');
 assert.equal(r.second.error,undefined);assert.equal(r.second.value.rows[0].result.transitioned,true);
 for(const table of ['release_status_history','release_logs','audit_log']) assert.equal((await db.query(`select count(*)::int n from public.${table}`)).rows[0].n,1);
 assert.equal((await db.query("select count(*)::int n from public.bridge_decision_audit where action='revoke'")).rows[0].n,1);
});

test('overlapping Claim creation cannot duplicate an active candidate Claim or its evidence',async()=>{
 const candidate=await seedCandidate(db);
 const r=await race(a=>claim(a,candidate),b=>claim(b,candidate));
 assert.equal(r.second.error?.code,'PT409');
 assert.equal((await db.query('select count(*)::int n from public.claims')).rows[0].n,1);
 assert.equal((await db.query('select count(*)::int n from public.claim_evidence_links')).rows[0].n,4);
 assert.equal((await db.query('select count(*)::int n from public.release_certificates')).rows[0].n,0);
});
