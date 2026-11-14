import {before,beforeEach,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as pause} from 'node:timers/promises';
import pg from 'pg';
import {installTrustedEvidenceFixture,seedTrustedEvidenceFixture,issueEvidenceFixtureCertificate,opposingSource,ids,id,evidenceSourceId,authorityId,verify,assess,check,withdraw} from '../decision-integrity/trusted-evidence-fixture.mjs';

const url=new URL(process.env.PETRAPLAN_TEST_DATABASE_URL??'invalid:');
if(!['localhost','127.0.0.1','[::1]'].includes(url.hostname)||url.pathname!=='/petraplan_test')throw new Error('A local petraplan_test database is required; remote databases are refused.');
const pool=new pg.Pool({connectionString:url.href,max:6,statement_timeout:15000});
const db={query:(...args)=>pool.query(...args),exec:sql=>pool.query(sql)};
const adapt=client=>({query:(...args)=>client.query(...args),exec:sql=>client.query(sql)});
let context;
before(async()=>assert.match((await db.query('show server_version')).rows[0].server_version,/^17\./));
beforeEach(async()=>{await db.exec('drop schema public cascade;drop schema if exists auth cascade;create schema public;');
 await installTrustedEvidenceFixture(db);context=await seedTrustedEvidenceFixture(db);});
after(()=>pool.end());
async function waitForLock(pid) {
 const deadline=Date.now()+7000;
 while(Date.now()<deadline) {
  if((await db.query('select wait_event_type from pg_stat_activity where pid=$1',[pid])).rows[0]?.wait_event_type==='Lock')return;
  await pause(20);
 }throw new Error('Concurrent evidence request never reached its expected PostgreSQL lock');
}
async function race(first,second,{admin=false,delay=0}={}) {
 const a=await pool.connect(),b=await pool.connect();let pending;
 try {
  if(!admin)await a.query('set role service_role');await b.query('set role service_role');
  await a.query('begin');await first(adapt(a));
  const pid=(await b.query('select pg_backend_pid() pid')).rows[0].pid;
  pending=Promise.resolve().then(()=>second(adapt(b))).then(value=>({value}),error=>({error}));
  await waitForLock(pid);if(delay)await pause(delay);await a.query('commit');return await pending;
 }finally {
  await a.query('rollback').catch(()=>{});if(pending)await pending;
  await a.query('reset role').catch(()=>{});await b.query('reset role').catch(()=>{});a.release();b.release();
 }
}
const record=async()=> (await verify(db,context)).rows[0].result.verification_id;

test('source withdrawn while retrieval is in flight cannot be persisted as verified afterwards',async()=>{
 const r=await race(a=>withdraw(a,'source',evidenceSourceId),b=>verify(b,context),{admin:true});
 assert.equal(r.error?.code,'PT409');assert.equal((await db.query('select count(*)::int n from public.source_verification_records')).rows[0].n,0);
});

test('authority revoked while meaning review waits is rechecked after its advisory lock',async()=>{
 const verification=await record();
 const r=await race(a=>a.query('insert into public.semantic_rule_authority_revocations(authority_id,revoked_by,reason) values($1,$2,$3)',
  [authorityId,ids.actor,'Concurrent withdrawal of domain authority']),b=>assess(b,verification),{admin:true});
 assert.equal(r.error?.code,'PT403');assert.equal((await db.query('select count(*)::int n from public.semantic_evidence_assessments')).rows[0].n,0);
});

test('source withdrawal committed while readiness waits defeats its previous supporting assessment',async()=>{
 const verification=await record();await assess(db,verification);
 const r=await race(a=>withdraw(a,'source',evidenceSourceId),b=>check(b,context),{admin:true});
 assert.equal(r.error,undefined);assert.equal(r.value.state,'BLOCKED_VERIFIED_MEANING_REQUIRED');assert.equal(r.value.release_allowed,false);
});

test('authority expiry is checked after the wait, not from the earlier request time',async()=>{
 const verification=await record();
 await db.query(`insert into public.semantic_rule_authorities(id,user_id,record_id,snapshot_id,target_address,role_name,authority_reference,granted_by,granted_at,valid_until)
  values($1,$2,$3,$4,$5,'short_fixture_authority','fixture-short-grant',$2,clock_timestamp()-interval '1 hour',clock_timestamp()+interval '2 seconds')`,
 [id(111),ids.actor,ids.record,ids.snapshot,context.candidate.address]);
 await assess(db,verification,{authority:id(111)});
 const r=await race(a=>a.query("select pg_advisory_xact_lock(hashtextextended('petraplan:evidence:authority:'||$1::text,0))",[id(111)]),b=>check(b,context),{admin:true,delay:2200});
 assert.equal(r.error,undefined);assert.equal(r.value.state,'BLOCKED_VERIFIED_MEANING_REQUIRED');
});

test('expired rule approval cannot be kept alive by a longer-lived meaning assessor grant',async()=>{
 await db.exec('drop schema public cascade;drop schema auth cascade;create schema public;');
 await installTrustedEvidenceFixture(db);context=await seedTrustedEvidenceFixture(db,{authoritySeconds:2});
 const verification=await record();
 await db.query(`insert into public.semantic_rule_authorities(id,user_id,record_id,snapshot_id,target_address,role_name,authority_reference,granted_by,granted_at,valid_until)
  values($1,$2,$3,$4,$5,'fixture_assessor','fixture-long-assessor',$2,clock_timestamp()-interval '1 hour',clock_timestamp()+interval '1 hour')`,
 [id(111),ids.actor,ids.record,ids.snapshot,context.candidate.address]);
 await assess(db,verification,{authority:id(111)});
 const r=await race(a=>a.query("select pg_advisory_xact_lock(hashtextextended('petraplan:evidence:authority:'||$1::text,0))",[authorityId]),b=>check(b,context),{admin:true,delay:2200});
 assert.equal(r.error,undefined);assert.equal(r.value.state,'BLOCKED_STALE_BASIS');
});

test('source freshness expires during a blocked readiness request',async()=>{
 await db.exec('drop schema public cascade;drop schema auth cascade;create schema public;');
 await installTrustedEvidenceFixture(db);context=await seedTrustedEvidenceFixture(db,{maxAgeSeconds:2});
 const verification=await record();await assess(db,verification);
 const r=await race(a=>a.query("select pg_advisory_xact_lock(hashtextextended('petraplan:evidence:source:'||$1::text,0))",[evidenceSourceId]),b=>check(b,context),{admin:true,delay:2200});
 assert.equal(r.error,undefined);assert.equal(r.value.state,'BLOCKED_VERIFIED_MEANING_REQUIRED');
});

test('new counterevidence committed while readiness waits blocks unchanged mapping and revokes prior trust',async()=>{
 const first=await record();await assess(db,first);await issueEvidenceFixtureCertificate(db);
 const other=await opposingSource(db);
 const next=(await verify(db,context,{source:other.source,hex:other.bytes.toString('hex')})).rows[0].result.verification_id;
 const r=await race(a=>assess(a,next,{decision:'CONTRADICTS',coverage:'UNKNOWN',anchor:other.anchor}),b=>check(b,context));
 assert.equal(r.error,undefined);assert.equal(r.value.state,'BLOCKED_CONFLICT_OR_INSUFFICIENT_EVIDENCE');
 assert.equal((await db.query('select public.bridge_current_release($1) r',[ids.record])).rows[0].r.effective_status,'revoked');
 assert.equal((await db.query('select count(*)::int n from public.release_status_history')).rows[0].n,1);
});

test('withdrawal of one verification defeats readiness even with an unchanged source registry row',async()=>{
 const verification=await record();await assess(db,verification);
 const r=await race(a=>withdraw(a,'verification',verification),b=>check(b,context));
 assert.equal(r.error,undefined);assert.equal(r.value.state,'BLOCKED_VERIFIED_MEANING_REQUIRED');
});
