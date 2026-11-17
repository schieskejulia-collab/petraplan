import { createInvoiceExceptionHandler } from '../../api/cases/[recordId]/invoice-exception.js';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { installInvoiceCaseFixture } from './invoice-case-fixture.mjs';
import { id, ids, read, criteria, review } from './atomic-review-fixture.mjs';
import { persistInvoiceCase } from '../../scripts/capture-invoice-case.mjs';

const recordId=id(277), approver=id(278), priorReviewer=id(279);
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');

function artifact(revision='base',accepted=true) {
  const invoice=Buffer.from(`<CII revision="${revision}"/>`);
  const report=Buffer.from('<KoSIT/>');
  const pdf=Buffer.from(`%PDF-${revision}`);
  return {invoice,report,pdf,result:{
    contract:'en16931-invoice-v1',syntax:'CII',sourceSha256:hash(invoice),
    fields:{'BT-1':{status:'observed',values:[{original:'EX-1'}]},
      'BT-27':{status:'observed',values:[{original:'Supplier'}]},
      'BT-115':{status:'observed',values:[{original:'529.87',path:'/amount',currency:{value:'EUR'}}]}},
    pdfComparison:{status:'DIFFERENT',pdfSha256:hash(pdf),candidates:[{page:2,amount:'530.87'}]},
    technicalEvidence:{accepted,validatorDecision:accepted?'accept':'reject',invoiceSha256:hash(invoice),reportSha256:hash(report),messages:[]},
    decision:{status:'BLOCKED',releaseAllowed:false,blockers:accepted?['PDF_VISUAL_AMOUNT_CONFLICT']:['KOSIT_NOT_ACCEPTED','PDF_VISUAL_AMOUNT_CONFLICT']},
  }};
}

async function setup(t) {
  const db=new PGlite();t.after(()=>db.close());
  await installInvoiceCaseFixture(db);
  await db.exec(await read('../../supabase/migrations/20261117210000_invoice_pdf_exceptions.sql'));
  for(const user of [approver,priorReviewer]) {
    await db.query('insert into auth.users values($1)',[user]);
    await db.query(`insert into bridge_actor_roles(user_id,role_name,active,can_review,can_release,can_revoke,
      can_approve_invoice_exception,invoice_exception_authority_reference)
      values($1,'exception_reviewer',true,true,true,true,true,'Appointment: invoices scope pilot')`,[user]);
  }
  await db.query(`update bridge_actor_roles set can_approve_invoice_exception=true,
    invoice_exception_authority_reference='Appointment: invoices scope pilot' where user_id=$1`,[ids.actor]);
  await db.exec('set role service_role');
  return db;
}
const capture=(db,data=artifact(),previous=null)=>persistInvoiceCase(db,{recordId,actorId:ids.actor,expectedSnapshotId:previous},data);
const request=async(db,captured,user=ids.actor)=>(await db.query('select public.bridge_request_invoice_exception($1,$2,$3,$4,$5,$6,$7) result',
  [recordId,captured.snapshot_id,captured.validation_id,user,'PDF display discrepancy investigated','Clarification: customer letter','Invoice analysis only'])).rows[0].result;
const decide=async(db,requestId,user=approver,decision='APPROVED')=>(await db.query('select public.bridge_decide_invoice_exception($1,$2,$3,$4) result',
  [requestId,user,decision,'Independent assessment of originals and clarification'])).rows[0].result;
async function approve(db,captured,user=approver) {
  const basis=(await db.query('select bridge_claims_basis($1) basis',[recordId])).rows[0].basis;
  return (await review(db,{record:recordId,snapshot:captured.snapshot_id,validation:captured.validation_id,basis,actor:user,criteria})).rows[0].result;
}
const release=async(db,captured,session,user=approver)=>(await db.query('select bridge_release_case($1,$2,$3,$4,$5,$6) result',
  [recordId,captured.snapshot_id,captured.validation_id,session,user,'Explicit limited-purpose exception release'])).rows[0].result;

test('exception authority requires independence and does not grant a release by itself',async t=>{
  const db=await setup(t), captured=await capture(db);
  const handler = createInvoiceExceptionHandler(async req => ({
    user:{id:req.userId},role:{can_review:true},supabase:{
      from(){return {select(){return this;},eq(){return this;},
        async maybeSingle(){return {data:{record_id:recordId}};}};},
      async rpc(name,args){
        try {
          const values=Object.values(args);
          return {data:(await db.query(`select public.${name}(${values.map((_,i)=>'$'+(i+1)).join(',')}) result`,values)).rows[0].result};
        } catch(error){return {error};}
      },
    },
  }));
  async function http(userId,body) {
    let status,result;
    const response={setHeader(){},status(value){status=value;return response;},json(value){result=value;}};
    await handler({method:'POST',userId,query:{recordId},body},response);
    return {status,result};
  }
  const uploadedRequest=await http(ids.actor,{action:'REQUEST',snapshotId:captured.snapshot_id,
    validationId:captured.validation_id,reason:'PDF display discrepancy investigated',
    evidenceReference:'Clarification: customer letter',purpose:'Invoice analysis only'});
  assert.equal(uploadedRequest.status,200);
  const pending=uploadedRequest.result;
  assert.equal((await http(ids.actor,{action:'APPROVED',requestId:pending.request_id,
    reason:'Attempted same-person approval'})).status,403);
  await assert.rejects(decide(db,pending.request_id,ids.actor),/independent/);
  await db.query('update bridge_actor_roles set can_approve_invoice_exception=false where user_id=$1',[approver]);
  await assert.rejects(decide(db,pending.request_id),/authority required/);
  await db.query('update bridge_actor_roles set can_approve_invoice_exception=true where user_id=$1',[approver]);
  // A rejection review is still prior involvement in this snapshot.
  const basis=(await db.query('select bridge_claims_basis($1) basis',[recordId])).rows[0].basis;
  await review(db,{record:recordId,snapshot:captured.snapshot_id,validation:captured.validation_id,
    basis,actor:priorReviewer,decision:'rejected',criteria});
  await assert.rejects(decide(db,pending.request_id,priorReviewer),/prior reviewers/);
  const approved=await http(approver,{action:'APPROVED',requestId:pending.request_id,
    reason:'Independent assessment of originals and clarification'});
  assert.equal(approved.status,200);
  const decision=approved.result;
  const accepted={...captured,validation_id:decision.validation_id};
  assert.equal((await db.query('select count(*)::int n from release_certificates where record_id=$1',[recordId])).rows[0].n,0);
  assert.equal((await db.query('select bridge_check_invoice_exception($1,$2) ok',[recordId,decision.validation_id])).rows[0].ok,true);
  await assert.rejects(approve(db,accepted,ids.actor),/independent exception approver/);
  const reviewed=await approve(db,accepted);
  assert.equal((await db.query('select count(*)::int n from release_certificates where record_id=$1',[recordId])).rows[0].n,0);
  await assert.rejects(release(db,accepted,reviewed.review_session_id,ids.actor),/independent exception approver/);
  const certificate=await release(db,accepted,reviewed.review_session_id);
  const row=(await db.query('select truth_snapshot from release_certificates where id=$1',[certificate.certificate_id])).rows[0];
  assert.equal(row.truth_snapshot.invoice_exception_id,decision.decision_id);
  const revised=await capture(db,artifact('revision'),captured.snapshot_id);
  assert.equal((await db.query('select bridge_current_release($1) result',[recordId])).rows[0].result.effective_status,'revoked');
  assert.equal((await db.query('select bridge_check_invoice_exception($1,$2) ok',[recordId,decision.validation_id])).rows[0].ok,false);
  await assert.rejects(release(db,accepted,reviewed.review_session_id),/snapshot has changed/);
  assert.notEqual(revised.snapshot_id,captured.snapshot_id);
});

test('negative XML, duplicate decisions and expired exception permission remain closed',async t=>{
  const db=await setup(t);
  const invalid=await capture(db,artifact('invalid-xml',false));
  await assert.rejects(request(db,invalid),/accepted XML/);
  const good=await capture(db,artifact('valid-xml'),invalid.snapshot_id);
  const pending=await request(db,good);
  const decision=await decide(db,pending.request_id);
  await assert.rejects(decide(db,pending.request_id),/already decided/);
  await db.query('update bridge_actor_roles set can_approve_invoice_exception=false where user_id=$1',[approver]);
  assert.equal((await db.query('select bridge_check_invoice_exception($1,$2) ok',[recordId,decision.validation_id])).rows[0].ok,false);
  await assert.rejects(approve(db,{...good,validation_id:decision.validation_id}),/independent exception approver/);
  await db.exec('set role authenticated');
  await assert.rejects(request(db,good),{code:'42501'});
});

test('rejected exception leaves the original failed validation and no certificate',async t=>{
  const db=await setup(t), captured=await capture(db), pending=await request(db,captured);
  const rejected=await decide(db,pending.request_id,approver,'REJECTED');
  assert.equal(rejected.validation_id,null);
  assert.equal((await db.query('select status from validation_results where id=$1',[captured.validation_id])).rows[0].status,'failed');
  assert.equal((await db.query('select count(*)::int n from release_certificates where record_id=$1',[recordId])).rows[0].n,0);
});

test('PDF exception preserves the failed original and does not erase delivery-period review obligations',async t=>{
  const db=await setup(t), data=artifact('period-warning');
  data.result.technicalEvidence.messages=[{code:'BR-DE-TMP-32'}];
  const captured=await capture(db,data), pending=await request(db,captured);
  const decision=await decide(db,pending.request_id);
  const accepted={...captured,validation_id:decision.validation_id};
  await assert.rejects(approve(db,accepted),/delivery or service period evidence/);
  const basis=(await db.query('select bridge_claims_basis($1) basis',[recordId])).rows[0].basis;
  await review(db,{record:recordId,snapshot:accepted.snapshot_id,validation:accepted.validation_id,
    basis,actor:approver,criteria:{...criteria,delivery_period_evidence:'Independent service-period document'}});
  assert.equal((await db.query('select status from validation_results where id=$1',[captured.validation_id])).rows[0].status,'failed');
  await assert.rejects(db.query('update invoice_exception_decisions set reason=$1 where id=$2',
    ['Changed after the decision',decision.decision_id]),/permission denied|immutable|append.only/i);
  await assert.rejects(db.query('delete from invoice_exception_requests where id=$1',[pending.request_id]),/permission denied|immutable|append.only/i);
});
