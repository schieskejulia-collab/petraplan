import {before,beforeEach,after,test} from 'node:test';import assert from 'node:assert/strict';import pg from 'pg';import {setTimeout as pause} from 'node:timers/promises';
import {install,artifact,id,ids} from '../decision-integrity/invoice-duplicate-enforcement-fixture.mjs';
import {criteria,review} from '../decision-integrity/atomic-review-fixture.mjs';
import {persistInvoiceCase} from '../../scripts/capture-invoice-case.mjs';
const url=new URL(process.env.PETRAPLAN_TEST_DATABASE_URL??'invalid:');
if(!['localhost','127.0.0.1','[::1]'].includes(url.hostname)||url.pathname!=='/petraplan_test')throw Error('Isolated local petraplan_test required');
const pool=new pg.Pool({connectionString:url.href,max:6,statement_timeout:15000});
const adapt=c=>({query:(...a)=>c.query(...a),exec:s=>c.query(s)}),db=adapt(pool),rid=id(900);let captured,session;
before(async()=>assert.match((await pool.query('show server_version')).rows[0].server_version,/^17\./));
beforeEach(async()=>{
 await db.exec('drop schema public cascade;drop schema if exists auth cascade;drop schema if exists extensions cascade;create schema public');await install(db);
 captured=await persistInvoiceCase(db,{recordId:rid,actorId:ids.actor},artifact());
 const basis=(await db.query('select public.bridge_invoice_duplicate_review_basis($1,$2,$3) b',[rid,captured.snapshot_id,ids.actor])).rows[0].b;
 // Controlled server assessment isolates database transaction ordering. Actual
 // classifier/HTTP and KoSIT integration have separate tests.
 const a={contract:'invoice-duplicate-review-v1',target:basis.read.target,status:'NO_MATCH_IN_SUPPORTED_CHECKS',findingCount:0,findings:[],coverage:{scanTruncated:false,findingsTruncated:false,unusableBasis:0,incompleteSignals:0,otherCasesRead:0}};
 await db.query('select public.bridge_decide_invoice_duplicates($1,$2,$3,$4,$5,$6,$7,$8,$9)',[rid,captured.snapshot_id,ids.actor,basis.corpusHash,'CLEAR','Explicit isolated test clearance','Fixture evidence',a,[]]);
 const claims=(await db.query('select public.bridge_claims_basis($1) b',[rid])).rows[0].b;
 session=(await review(db,{record:rid,snapshot:captured.snapshot_id,validation:captured.validation_id,basis:claims,criteria})).rows[0].result.review_session_id;
});after(()=>pool.end());
const release=d=>d.query('select public.bridge_release_case($1,$2,$3,$4,$5,$6)',[rid,captured.snapshot_id,captured.validation_id,session,ids.actor,'Separate explicit release']);
const capture=d=>persistInvoiceCase(d,{recordId:id(901),actorId:ids.actor},artifact('NEW'));
async function race(first,second,finish='commit'){
 const a=await pool.connect(),b=await pool.connect();let waiting;
 try{
  await a.query('set role service_role');await b.query('set role service_role');await a.query('begin');await first(adapt(a));
  const pid=(await b.query('select pg_backend_pid() pid')).rows[0].pid;waiting=second(adapt(b)).then(value=>({value}),error=>({error}));
  let blocked=false;for(let n=0;n<250;n++){if((await pool.query('select wait_event_type from pg_stat_activity where pid=$1',[pid])).rows[0]?.wait_event_type==='Lock'){blocked=true;break;}await pause(20);}
  assert(blocked,'Second connection must wait on database lock');await a.query(finish);return await waiting;
 }finally{await a.query('rollback').catch(()=>{});if(waiting)await waiting;await a.query('reset role');await b.query('reset role');a.release();b.release();}
}
test('new case commits before waiting release: stale comparison cannot issue certificate',async()=>{
 const r=await race(capture,release);assert.equal(r.error?.code,'PT409');assert.equal((await pool.query('select count(*)::int n from release_certificates')).rows[0].n,0);
});
test('rolled back new case leaves waiting release a usable original corpus',async()=>{
 const r=await race(capture,release,'rollback');assert.equal(r.error,undefined);assert.equal((await pool.query('select count(*)::int n from release_certificates')).rows[0].n,1);
});
test('release commits before waiting new case: historical certificate remains but current clearance becomes blocked',async()=>{
 const r=await race(release,capture);assert.equal(r.error,undefined);
 assert.equal((await pool.query('select public.bridge_check_invoice_duplicate_release($1) c',[rid])).rows[0].c.allowed,false);
 assert.equal((await pool.query('select count(*)::int n from release_certificates')).rows[0].n,1);
 await assert.rejects(release(db),{code:'PT409'});
});
test('HOLD decision wins against concurrent release',async()=>{
 const hold=async d=>{const b=(await d.query('select public.bridge_invoice_duplicate_review_basis($1,$2,$3) b',[rid,captured.snapshot_id,ids.actor])).rows[0].b;
 await d.query('select public.bridge_decide_invoice_duplicates($1,$2,$3,$4,$5,$6,$7,$8,$9)',[rid,captured.snapshot_id,ids.actor,b.corpusHash,'HOLD','Hold for supporting evidence','Evidence requested',{contract:'invoice-duplicate-review-v1',target:b.read.target},[]]);};
 const r=await race(hold,release);assert.equal(r.error?.code,'PT409');
});
test('repeatable read cannot reuse a snapshot from before a corpus lock',async()=>{
 const c=await pool.connect();try{await c.query('begin isolation level repeatable read');await assert.rejects(release(adapt(c)),{code:'PT409'});}finally{await c.query('rollback');c.release();}
});
