import assert from 'node:assert/strict';import {test} from 'node:test';import {PGlite} from '@electric-sql/pglite';
import {install,artifact,id,ids} from './invoice-duplicate-enforcement-fixture.mjs';
import {persistInvoiceCase} from '../../scripts/capture-invoice-case.mjs';
import {assessInvoiceDuplicates} from '../../dist/services/invoiceDuplicates.js';
import {getCaseTrace,listCases} from '../../dist/services/caseTrace.js';
import {fixtureClient} from '../browser/fixture-client.mjs';
import {criteria,review} from './atomic-review-fixture.mjs';
import {createInvoiceDuplicateDecisionHandler} from '../../.decision-test-build/api/cases/[recordId]/invoice-duplicate-decision.js';
const rid=id(900);
async function basis(db,r=rid,actor=ids.actor){const snapshot=(await db.query('select ingestion_log_id from records where id=$1',[r])).rows[0].ingestion_log_id;return (await db.query('select public.bridge_invoice_duplicate_review_basis($1,$2,$3) b',[r,snapshot,actor])).rows[0].b;}
async function decide(db,action='CLEAR',r=rid,actor=ids.actor,peers=[]){const b=await basis(db,r,actor);return (await db.query('select public.bridge_decide_invoice_duplicates($1,$2,$3,$4,$5,$6,$7,$8,$9) d',[r,b.read.target.snapshotId,actor,b.corpusHash,action,'Explicit fixture adjudication','Isolated test evidence',assessInvoiceDuplicates(b.read),peers])).rows[0].d;}
const check=async(db,r=rid,d=null)=>(await db.query('select public.bridge_check_invoice_duplicate_release($1,$2) c',[r,d])).rows[0].c;
async function setup(t){const db=new PGlite();t.after(()=>db.close());await install(db);await db.exec('set role service_role');return db;}
async function capture(db,n=900,a=artifact()){return persistInvoiceCase(db,{recordId:id(n),actorId:ids.actor},a);}
async function approve(db,c){const claims=(await db.query('select public.bridge_claims_basis($1) b',[rid])).rows[0].b;return (await review(db,{record:rid,snapshot:c.snapshot_id,validation:c.validation_id,basis:claims,criteria})).rows[0].result;}
const release=(db,c,s)=>db.query('select public.bridge_release_case($1,$2,$3,$4,$5,$6) r',[rid,c.snapshot_id,c.validation_id,s,ids.actor,'Separate explicit fixture release']);

test('enforced duplicate decision binds release and invalidates on new corpus',async t=>{
 const db=await setup(t),c=await capture(db);const a=await approve(db,c);
 await assert.rejects(release(db,c,a.review_session_id),/duplicate clearance/);
 const d=await decide(db);assert.equal((await check(db)).allowed,true);
 await release(db,c,a.review_session_id);
 const certificate=(await db.query('select * from release_certificates where record_id=$1',[rid])).rows[0];
 assert.equal(certificate.truth_snapshot.invoice_duplicate_decision_id,d.decisionId);
 await release(db,c,a.review_session_id);assert.equal((await db.query('select count(*)::int n from release_certificates')).rows[0].n,1);
 const previous=process.env.PETRAPLAN_INVOICE_DUPLICATE_ENFORCEMENT;process.env.PETRAPLAN_INVOICE_DUPLICATE_ENFORCEMENT='1';t.after(()=>{if(previous===undefined)delete process.env.PETRAPLAN_INVOICE_DUPLICATE_ENFORCEMENT;else process.env.PETRAPLAN_INVOICE_DUPLICATE_ENFORCEMENT=previous;});
 const client=await fixtureClient(db,ids.actor,'local-only');
 assert.equal((await getCaseTrace(client,rid)).release.effective_status,'trusted');
 await capture(db,901,artifact('OTHER'));
 assert.equal((await getCaseTrace(client,rid)).release.effective_status,'blocked');
 assert.equal((await listCases(client,20,0)).find(x=>x.id===rid).release_status,'blocked');
 assert.equal((await check(db,rid,d.decisionId)).allowed,false);
 await assert.rejects(release(db,c,a.review_session_id),/duplicate clearance/);
 assert.equal((await db.query('select count(*)::int n from release_certificates')).rows[0].n,1);
 await decide(db);await assert.rejects(release(db,c,a.review_session_id),/Revoke previous/);
 await assert.rejects(db.query("update invoice_duplicate_decisions set reason='changed'"));
 await assert.rejects(db.exec('truncate invoice_duplicate_decisions'));
});

test('confirmed copy blocks itself and permits only an independent primary decision',async t=>{
 const db=await setup(t);await capture(db);await capture(db,901);
 const b=await basis(db);assert.equal(assessInvoiceDuplicates(b.read).findings[0].code,'IDENTICAL_XML');
 await assert.rejects(decide(db),/CLEAR requires/);
 const blocked=await decide(db,'DUPLICATE',id(901));assert.equal((await check(db,id(901))).allowed,false);
 await assert.rejects(decide(db,'DISTINCT'),/Independent/);
 const independent=id(999);await db.query('insert into auth.users values($1)',[independent]);
 await db.query("insert into bridge_actor_roles(user_id,role_name,active,can_review,can_release,can_revoke,can_adjudicate_invoice_duplicates,invoice_duplicate_authority_reference) values($1,'adjudicator',true,true,true,true,true,'Isolated written appointment')",[independent]);
 await assert.rejects(decide(db,'DISTINCT',rid,independent),/Identical XML/);
 await assert.rejects(decide(db,'PRIMARY',rid,independent),/Every finding/);
 const primary=await decide(db,'PRIMARY',rid,independent,[blocked.decisionId]);assert.equal((await check(db,rid,primary.decisionId)).allowed,true);
 await decide(db,'HOLD',id(901));assert.equal((await check(db)).allowed,false);
});

test('API computes assessment itself and rejects stale user comparison, missing scope and permissions',async t=>{
 const db=await setup(t),c=await capture(db);const b=await basis(db);
 let role={can_review:true},calls=[];
 const auth=async()=>({user:{id:ids.actor},role,supabase:{async rpc(name,args){calls.push({name,args});try{return {data:(await db.query(`select public.${name}(${Object.keys(args).map((_,i)=>'$'+(i+1)).join(',')}) r`,Object.values(args))).rows[0].r};}catch(error){return {error};}}}});
 const handler=createInvoiceDuplicateDecisionHandler(auth,{PETRAPLAN_INVOICE_DUPLICATE_SCOPE:'single-project-pilot',PETRAPLAN_INVOICE_DUPLICATE_ENFORCEMENT:'1'});
 const request={method:'POST',query:{recordId:rid,snapshotId:c.snapshot_id},body:{action:'CLEAR',corpusHash:b.corpusHash,reason:'Explicit observed basis',evidenceReference:'Evidence ID',assessment:{forged:true}}};
 const response=()=>({code:0,body:null,setHeader(){},status(c){this.code=c;return this;},json(b){this.body=b;return this;}});
 let res=response();await handler(request,res);assert.equal(res.code,201);assert.equal(calls.at(-1).args.p_assessment.contract,'invoice-duplicate-review-v1');
 res=response();await handler({...request,body:{...request.body,corpusHash:'0'.repeat(64)}},res);assert.equal(res.code,409);
 res=response();await createInvoiceDuplicateDecisionHandler(auth,{})(request,res);assert.equal(res.code,503);
 role={can_review:false};res=response();await handler(request,res);assert.equal(res.code,403);
 for(const rpc of ['bridge_invoice_duplicate_review_basis','bridge_decide_invoice_duplicates','bridge_capture_invoice_case_without_duplicate_lock','bridge_release_case_without_duplicate_guard']){
  const permissions=(await db.query("select has_function_privilege('authenticated',p.oid,'EXECUTE') as allowed from pg_proc p where p.proname=$1",[rpc])).rows;assert(permissions.every(x=>!x.allowed));
 }
});
