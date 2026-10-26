import {before,after,beforeEach,afterEach,test} from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {installTrustedEvidenceFixture,seedTrustedEvidenceFixture,issueEvidenceFixtureCertificate,opposingSource,ids,id,evidenceSourceId,authorityId,documentBytes,verify,assess,check,withdraw} from './trusted-evidence-fixture.mjs';

const db=new PGlite();let context;
before(()=>installTrustedEvidenceFixture(db));
beforeEach(async()=>{await db.exec('begin');context=await seedTrustedEvidenceFixture(db);});
afterEach(()=>db.exec('rollback'));
after(()=>db.close());
async function fails(fn,code) {await db.exec('savepoint expected_failure');await assert.rejects(fn,error=>error.code===code);await db.exec('rollback to expected_failure');}
const count=async table=>(await db.query(`select count(*)::int n from public.${table}`)).rows[0].n;
const recorded=async()=> (await verify(db,context)).rows[0].result.verification_id;

test('registered actual bytes are independently hashed and frozen; no meaning or validation is inferred',async()=>{
 await db.exec('set local role service_role');
 const result=(await verify(db,context)).rows[0].result;
 assert.equal(result.meaning_confirmed,false);assert.equal(result.validation_allowed,false);
 const row=(await db.query('select * from public.source_verification_records')).rows[0];
 assert.equal(row.verified_by,ids.actor);assert.equal(row.claim_id,context.claimId);
 assert.deepEqual(Buffer.from(row.content_bytes),documentBytes);
 assert.equal(row.source_url,'https://evidence.example/spec/v1.txt');
 assert.equal((await check(db,context)).state,'BLOCKED_VERIFIED_MEANING_REQUIRED');
 assert.equal((await db.query('select status from public.claims')).rows[0].status,'UNPROVEN');
 assert.equal(await count('validation_results'),1);assert.equal(await count('release_certificates'),0);
});

test('changed bytes, wrong media, stale snapshot, fabricated verifier and old retrieval are rejected',async()=>{
 for(const override of [{hex:Buffer.from('different bytes').toString('hex')},{mediaType:'text/xml'},{snapshot:id(999)},{startedAt:'2000-01-01T00:00:00Z'}])
  await fails(()=>verify(db,context,override),'PT409');
 await fails(()=>verify(db,context,{actor:id(999)}),'PT403');
 assert.equal(await count('source_verification_records'),0);
});

test('source trust cannot be self-provisioned, rewritten or source-wide withdrawn by the server role',async()=>{
 await db.exec('set local role service_role');
 await fails(()=>db.exec("insert into public.trusted_evidence_sources(source_key,revision) values('self',1)"),'42501');
 await fails(()=>db.exec("update public.trusted_evidence_sources set expected_sha256=repeat('0',64)"),'42501');
 await fails(()=>withdraw(db,'source',evidenceSourceId),'PT403');
});

test('an authorized source-content assessment reaches only independent technical validation readiness',async()=>{
 const verification=await recorded();
 await db.exec('set local role service_role');
 await assess(db,verification);
 const ready=await check(db,context);
 assert.equal(ready.state,'READY_FOR_INDEPENDENT_TECHNICAL_VALIDATION');
 assert.equal(ready.verification_ids[0],verification);assert.equal(ready.assessment_ids.length,1);
 assert.equal(ready.validation_allowed,false);assert.equal(ready.release_allowed,false);
 assert.equal((await db.query('select status from public.claims')).rows[0].status,'UNPROVEN');
});

test('technical reviewer permissions alone cannot substitute for scoped domain authority',async()=>{
 const verification=await recorded();
 await fails(()=>assess(db,verification,{authority:id(999)}),'PT403');
 await db.query(`insert into public.semantic_rule_authorities(id,user_id,record_id,snapshot_id,target_address,role_name,authority_reference,granted_by,granted_at,valid_until)
 values($1,$2,$3,$4,'wrong:target','domain','wrong-scope',$2,clock_timestamp()-interval '1 hour',clock_timestamp()+interval '1 hour')`,[id(111),ids.actor,ids.record,ids.snapshot]);
 await fails(()=>assess(db,verification,{authority:id(111)}),'PT403');
 assert.equal(await count('semantic_evidence_assessments'),0);
});

test('fabricated excerpts, unknown coverage and unconfirmed review criteria cannot support meaning',async()=>{
 const verification=await recorded();
 await fails(()=>assess(db,verification,{anchor:{byte_start:0,byte_end:5,excerpt:'false'}}),'PT409');
 await fails(()=>assess(db,verification,{coverage:'UNKNOWN'}),'PT409');
 await fails(()=>assess(db,verification,{criteria:{}}),'PT409');
 assert.equal(await count('semantic_evidence_assessments'),0);
});

test('counterevidence stays blocking until an explicit authorized withdrawal; history is retained',async()=>{
 const a=await recorded(),b=await recorded();
 await assess(db,a);
 const negative=(await assess(db,b,{decision:'CONTRADICTS',coverage:'UNKNOWN'})).rows[0].result.assessment_id;
 assert.equal((await check(db,context)).state,'BLOCKED_CONFLICT_OR_INSUFFICIENT_EVIDENCE');
 await withdraw(db,'assessment',negative);
 assert.equal((await check(db,context)).state,'READY_FOR_INDEPENDENT_TECHNICAL_VALIDATION');
 assert.equal(await count('semantic_evidence_assessments'),2);assert.equal(await count('evidence_withdrawals'),1);
});

test('source or observation withdrawal defeats a previously supporting basis',async()=>{
 const verification=await recorded();await assess(db,verification);
 await withdraw(db,'verification',verification);
 assert.equal((await check(db,context)).state,'BLOCKED_VERIFIED_MEANING_REQUIRED');
 await withdraw(db,'source',evidenceSourceId);
 await fails(()=>verify(db,context),'PT409');
});

test('authority revocation and changed Claim evidence defeat old supporting metadata',async()=>{
 const verification=await recorded();await assess(db,verification);
 await db.query('insert into public.semantic_rule_authority_revocations(authority_id,revoked_by,reason) values($1,$2,$3)',[authorityId,ids.actor,'Explicit withdrawal of this domain authority']);
 assert.notEqual((await check(db,context)).state,'READY_FOR_INDEPENDENT_TECHNICAL_VALIDATION');
 await fails(()=>assess(db,verification),'PT403');
});

test('changed Claim evidence or candidate mapping cannot reuse a verified source assessment',async()=>{
 const verification=await recorded();await assess(db,verification);
 await db.query(`insert into public.claim_evidence_links(claim_id,evidence_type,evidence_reference,relation,directness,scope,linked_by)
 values($1,'NEW_OBSERVATION','extra-evidence','QUALIFIES','DIRECT','{}',$2)`,[context.claimId,ids.actor]);
 assert.equal((await check(db,context)).state,'BLOCKED_STALE_BASIS');
});

test('T0/T1: unchanged raw values and mapping, new opposing source meaning revoke old trust and preserve history',async()=>{
 const sourceBefore=await db.query('select raw_payload,source_hash from public.ingestion_logs');
 const verification=await recorded();await assess(db,verification);
 const certificate=await issueEvidenceFixtureCertificate(db);
 const oldCertificate=(await db.query('select * from public.release_certificates where id=$1',[certificate])).rows[0];
 const other=await opposingSource(db);
 const next=(await verify(db,context,{source:other.source,hex:other.bytes.toString('hex')})).rows[0].result.verification_id;
 await assess(db,next,{decision:'CONTRADICTS',coverage:'UNKNOWN',anchor:other.anchor});
 assert.equal((await check(db,context)).state,'BLOCKED_CONFLICT_OR_INSUFFICIENT_EVIDENCE');
 assert.equal((await db.query('select public.bridge_current_release($1) r',[ids.record])).rows[0].r.effective_status,'revoked');
 assert.deepEqual((await db.query('select * from public.release_certificates where id=$1',[certificate])).rows[0],oldCertificate);
 assert.deepEqual(await db.query('select raw_payload,source_hash from public.ingestion_logs'),sourceBefore);
 assert.equal(await count('release_status_history'),1);assert.equal(await count('audit_log'),1);
});

test('failed safety audit rolls back the opposing assessment and its revocation together',async()=>{
 const verification=await recorded();await assess(db,verification);await issueEvidenceFixtureCertificate(db);
 const other=await opposingSource(db);
 const next=(await verify(db,context,{source:other.source,hex:other.bytes.toString('hex')})).rows[0].result.verification_id;
 await db.exec(`create function public.fail_evidence_audit() returns trigger language plpgsql as $$ begin raise exception 'Injected evidence audit failure'; end $$;
  create trigger fail_evidence_audit before insert on public.bridge_decision_audit for each row execute function public.fail_evidence_audit();`);
 await fails(()=>assess(db,next,{decision:'CONTRADICTS',coverage:'UNKNOWN',anchor:other.anchor}),'P0001');
 assert.equal(await count('semantic_evidence_assessments'),1);assert.equal(await count('release_status_history'),0);assert.equal(await count('audit_log'),0);
});

test('verification bytes, assessments and withdrawals cannot be rewritten or truncated',async()=>{
 const verification=await recorded();const assessment=(await assess(db,verification)).rows[0].result.assessment_id;
 await withdraw(db,'assessment',assessment);
 for(const table of ['source_verification_records','semantic_evidence_assessments','evidence_withdrawals']) {
  await fails(()=>db.exec(`delete from public.${table}`),'PT409');
  await fails(()=>db.exec(`truncate public.${table} cascade`),'PT409');
 }
 assert.equal(await count('source_verification_records'),1);assert.equal(await count('semantic_evidence_assessments'),1);
});

test('browser roles cannot create verifications or semantic assessments',async()=>{
 for(const role of ['anon','authenticated']) {
  await db.exec(`set local role ${role}`);
  await fails(()=>verify(db,context),'42501');
  await db.exec('reset role');
 }
});
