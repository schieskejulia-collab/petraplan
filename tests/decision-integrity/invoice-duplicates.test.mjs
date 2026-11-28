import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createHash} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {installInvoiceCaseFixture} from './invoice-case-fixture.mjs';
import {id,ids,read} from './atomic-review-fixture.mjs';
import {persistInvoiceCase} from '../../scripts/capture-invoice-case.mjs';
import {assessInvoiceDuplicates} from '../../dist/services/invoiceDuplicates.js';
import {createInvoiceDuplicatesHandler} from '../../.decision-test-build/api/cases/[recordId]/invoice-duplicates.js';
import {parseInvoiceDuplicates} from '../../frontend/mobile-app/src/lib/invoice-duplicates-client.ts';
const hash=b=>createHash('sha256').update(b).digest('hex');
// Controlled trust-boundary fixtures, not formally validated invoices.
function artifact(number='001'){
 const invoice=Buffer.from(`<fixture>${number}</fixture>`),report=Buffer.from('<test-report/>');
 return {invoice,report,result:{contract:'en16931-invoice-v1',syntax:'UBL',fields:{},sourceSha256:hash(invoice),
  technicalEvidence:{invoiceSha256:hash(invoice),reportSha256:hash(report),accepted:false,validatorDecision:'reject'},
  decision:{status:'BLOCKED',releaseAllowed:false}}};
}
function response(){return {code:null,body:null,headers:{},setHeader(k,v){this.headers[k]=v;},status(c){this.code=c;return this;},json(v){this.body=v;return this;}};}

test('duplicate read SQL, API and client preserve source binding, permissions and decision state',async t=>{
 const db=new PGlite();t.after(()=>db.close());await installInvoiceCaseFixture(db);
 await db.exec(await read('../../supabase/migrations/20261128040000_invoice_duplicate_read.sql'));
 await db.exec('set role service_role');
 const capture=async(n,a,previous=null)=>persistInvoiceCase(db,{recordId:id(n),actorId:ids.actor,expectedSnapshotId:previous},a);
 const first=await capture(701,artifact()),second=await capture(702,artifact());
 const compare=async(snapshot=first.snapshot_id,actor=ids.actor,scope='single-project-pilot',limit=200)=>
  (await db.query('select public.bridge_invoice_duplicate_candidates($1,$2,$3,$4,$5) as result',[id(701),snapshot,actor,scope,limit])).rows[0].result;
 await t.test('read finds original XML bytes and leaves every public table unchanged',async()=>{
  const tables=(await db.query("select tablename from pg_tables where schemaname='public' order by tablename")).rows.map(x=>x.tablename);
  const snapshot=async()=>Promise.all(tables.map(async table=>[table,(await db.query(`select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) as v from public.\"${table}\" t`)).rows[0].v]));
  const before=await snapshot(),raw=await compare(),result=assessInvoiceDuplicates(raw);
  assert.equal(result.findings[0].code,'IDENTICAL_XML');assert.equal(result.findings[0].recordId,id(702));
  assert.equal(result.status,'REVIEW_SUGGESTED');assert.equal(result.releaseAssessment,'NOT_EVALUATED');
  assert.deepEqual(await snapshot(),before);assert.deepEqual(parseInvoiceDuplicates(result,id(701),first.snapshot_id),result);
 });
 await t.test('stale target, missing actor, wrong scope and excessive limit fail closed',async()=>{
  for(const [args,code] of [[[id(999)],'PT409'],[[first.snapshot_id,id(999)],'PT403'],[[first.snapshot_id,ids.actor,'all'],'PT403'],[[first.snapshot_id,ids.actor,'single-project-pilot',201],'PT400']])
   await assert.rejects(compare(...args),{code});
 });
 await t.test('browser roles cannot call either RPC directly',async()=>{
  for(const role of ['anon','authenticated']){
   await db.exec(`set role ${role}`);
   await assert.rejects(compare(),{code:'42501'});
   await assert.rejects(db.query('select public.bridge_invoice_duplicate_row($1)',[id(701)]),{code:'42501'});
   await db.exec('set role service_role');
  }
 });
 await t.test('API uses authenticated actor, enforces opt-in and never turns an error into an empty success',async()=>{
  let role={can_review:true},calls=0,error=null;
  const auth=async()=>({user:{id:ids.actor},role,supabase:{async rpc(name,args){calls++;assert.equal(args.p_actor_id,ids.actor);assert.equal(args.p_limit,200);return error?{error}:{data:await compare(args.p_snapshot_id)};}}});
  const request={method:'GET',query:{recordId:id(701),snapshotId:first.snapshot_id,p_actor_id:id(999)}};
  const enabled=createInvoiceDuplicatesHandler(auth,{PETRAPLAN_INVOICE_DUPLICATE_SCOPE:'single-project-pilot'});
  let res=response();await enabled(request,res);assert.equal(res.code,200);assert.equal(res.headers['Cache-Control'],'private, no-store');
  res=response();await createInvoiceDuplicatesHandler(auth,{})(request,res);assert.equal(res.code,503);assert.equal(calls,1);
  role={can_review:false};res=response();await enabled(request,res);assert.equal(res.code,403);assert.equal(calls,1);role={can_review:true};
  res=response();await enabled({...request,method:'POST'},res);assert.equal(res.code,405);
  res=response();await enabled({...request,query:{recordId:'bad'}},res);assert.equal(res.code,400);
  error={code:'PT409'};res=response();await enabled(request,res);assert.equal(res.code,409);
  error={code:'XX000'};res=response();await enabled(request,res);assert.equal(res.code,503);
  res=response();await createInvoiceDuplicatesHandler(async(req,res)=>{res.status(401).json({error:'Unauthorized'});return null;},{})(request,res);assert.equal(res.code,401);
 });
 await t.test('malformed client findings and forged counts fail closed',async()=>{
  const valid=assessInvoiceDuplicates(await compare());
  for(const mutate of [x=>delete x.findings[0].changedFields,x=>x.coverage.otherCasesRead=-1,x=>x.findings[0].xmlSha256='bad',x=>x.findings[0].pdfRelationship='unknown',x=>x.status='NO_MATCH_IN_SUPPORTED_CHECKS',x=>x.findingCount=3]){
   const bad=structuredClone(valid);mutate(bad);assert.throws(()=>parseInvoiceDuplicates(bad,id(701),first.snapshot_id));
  }
 });
 await t.test('only current other snapshot participates; history is retained',async()=>{
  const next=await capture(702,artifact('002'),second.snapshot_id);
  const result=assessInvoiceDuplicates(await compare());assert.equal(result.findings.length,0);assert.equal(result.status,'INCOMPLETE');
  const raw=await compare();assert.equal(raw.others[0].basis.snapshotId,next.snapshot_id);
  assert.equal((await db.query('select count(*)::int as n from bridge_invoice_evidence where record_id=$1',[id(702)])).rows[0].n,2);
 });
 await t.test('bounded scan exposes truncation and missing evidence',async()=>{
  await db.query("insert into records(id,title,category,source_system,meaning) values($1,'Missing evidence','invoice','petraplan-invoice','Test only')",[id(703)]);
  assert.equal((await compare(first.snapshot_id,ids.actor,'single-project-pilot',1)).truncated,true);
  const result=assessInvoiceDuplicates(await compare());assert.equal(result.coverage.unusableBasis,1);assert.equal(result.status,'INCOMPLETE');
 });
 await t.test('changed projection source hash is detected rather than trusted',async()=>{
  await db.query("update ingestion_logs set extracted_schema=jsonb_set(extracted_schema,'{sourceSha256}',to_jsonb($2::text)) where id=$1",[first.snapshot_id,'f'.repeat(64)]);
  const raw=await compare();assert.equal(raw.target.proofBound,false);assert.throws(()=>assessInvoiceDuplicates(raw),/unbound/);
 });
});

test('real KoSIT capture finds a changed-number suspicion but excludes changed performance',{
 skip:!(process.env.PETRAPLAN_INVOICE_FIXTURES&&process.env.PETRAPLAN_KOSIT_JAR&&process.env.PETRAPLAN_KOSIT_SCENARIOS)&&'Requires pinned local resources',
},async t=>{
 const {mkdtemp,readFile,writeFile,rm}=await import('node:fs/promises');
 const {tmpdir}=await import('node:os');const {join}=await import('node:path');
 const {inspectInvoiceFile}=await import('../../scripts/capture-invoice-case.mjs');
 const directory=await mkdtemp(join(tmpdir(),'duplicate-number-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const original=await readFile(join(process.env.PETRAPLAN_INVOICE_FIXTURES,'01.01a.xml'),'utf8');
 const renamed=original.replace('<cbc:ID>123456XX</cbc:ID>','<cbc:ID>DUPLICATE-NUMBER-CONTROL</cbc:ID>');
 const changedPeriod=renamed.replace('<cbc:StartDate>2016-01-01</cbc:StartDate>','<cbc:StartDate>2016-02-01</cbc:StartDate>');
 assert.notEqual(renamed,original);assert.notEqual(changedPeriod,renamed);
 const db=new PGlite();t.after(()=>db.close());await installInvoiceCaseFixture(db);
 await db.exec(await read('../../supabase/migrations/20261128040000_invoice_duplicate_read.sql'));await db.exec('set role service_role');
 const captures=[];
 for(const [n,xml] of [original,renamed,changedPeriod].entries()){
  const file=join(directory,`${n}.xml`);await writeFile(file,xml);
  const inspected=await inspectInvoiceFile(file,{jar:process.env.PETRAPLAN_KOSIT_JAR,scenarios:process.env.PETRAPLAN_KOSIT_SCENARIOS});
  assert.equal(inspected.result.technicalEvidence.accepted,true);
  captures.push(await persistInvoiceCase(db,{recordId:id(801+n),actorId:ids.actor},inspected));
 }
 const raw=(await db.query('select public.bridge_invoice_duplicate_candidates($1,$2,$3,$4,200) as r',
  [id(801),captures[0].snapshot_id,ids.actor,'single-project-pilot'])).rows[0].r;
 const result=assessInvoiceDuplicates(raw);assert.equal(result.findingCount,1);
 assert.equal(result.findings[0].recordId,id(802));assert.equal(result.findings[0].code,'SIMILAR_CONTENT_WEAK_PARTIES');
 assert.equal(result.findings[0].number,'DUPLICATE-NUMBER-CONTROL');assert(result.coverage.incompleteSignals>0);
});
