import { before, beforeEach, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { setTimeout as pause } from 'node:timers/promises';
import pg from 'pg';
import { installInvoiceCaseFixture } from '../decision-integrity/invoice-case-fixture.mjs';
import { criteria, id, ids, read, review } from '../decision-integrity/atomic-review-fixture.mjs';
import { persistInvoiceCase } from '../../scripts/capture-invoice-case.mjs';

const databaseUrl = new URL(process.env.PETRAPLAN_TEST_DATABASE_URL ?? 'invalid:');
if (!['localhost', '127.0.0.1', '[::1]'].includes(databaseUrl.hostname)
  || databaseUrl.pathname !== '/petraplan_test') {
  throw new Error('Invoice races require the explicit local petraplan_test database.');
}
const pool = new pg.Pool({ connectionString: databaseUrl.href, max: 6, statement_timeout: 15000 });
const db = { query: (...args) => pool.query(...args), exec: sql => pool.query(sql) };
const adapt = client => ({ query: (...args) => client.query(...args), exec: sql => client.query(sql) });
const recordId=id(377), approver=id(378);
const artifact=revision=>{
  const invoice=Buffer.from(`<Invoice revision="${revision}"/>`), report=Buffer.from('<KoSIT/>'), pdf=Buffer.from(`%PDF-${revision}`);
  const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
  return {invoice,report,pdf,result:{contract:'en16931-invoice-v1',syntax:'CII',sourceSha256:hash(invoice),
    fields:{'BT-1':{status:'observed',values:[{original:'EX-RACE'}]},'BT-27':{status:'observed',values:[{original:'Supplier'}]}},
    technicalEvidence:{accepted:true,validatorDecision:'accept',invoiceSha256:hash(invoice),reportSha256:hash(report),messages:[]},
    pdfComparison:{status:'DIFFERENT',pdfSha256:hash(pdf)},
    decision:{status:'BLOCKED',releaseAllowed:false,blockers:['PDF_VISUAL_AMOUNT_CONFLICT']}}};
};
let original,requestId;
before(async()=>assert.match((await db.query('show server_version')).rows[0].server_version,/^17\./));
beforeEach(async()=>{
  await db.exec('drop schema public cascade; drop schema if exists auth cascade; drop schema if exists extensions cascade; create schema public;');
  await installInvoiceCaseFixture(db);
  await db.exec(await read('../../supabase/migrations/20261117210000_invoice_pdf_exceptions.sql'));
  await db.query('insert into auth.users values($1)',[approver]);
  await db.query(`insert into bridge_actor_roles(user_id,role_name,active,can_review,can_release,can_revoke,can_approve_invoice_exception,invoice_exception_authority_reference)
    values($1,'exception_reviewer',true,true,true,true,true,'Pilot appointment')`,[approver]);
  original=await persistInvoiceCase(db,{recordId,actorId:ids.actor},artifact('first'));
  requestId=(await db.query('select bridge_request_invoice_exception($1,$2,$3,$4,$5,$6,$7) result',
    [recordId,original.snapshot_id,original.validation_id,ids.actor,'Investigated PDF difference','Reference EX-3','Internal analysis only'])).rows[0].result.request_id;
});
after(()=>pool.end());
const decide=client=>client.query('select bridge_decide_invoice_exception($1,$2,$3,$4) result',
  [requestId,approver,'APPROVED','Independent exception assessment']);
async function waitForCaseLock(pid) {
  const deadline = Date.now() + 7000;
  while (Date.now() < deadline) {
    const activity = (await db.query(
      'select wait_event_type from pg_stat_activity where pid=$1', [pid],
    )).rows[0];
    if (activity?.wait_event_type === 'Lock') return;
    await pause(20);
  }
  throw new Error('Second invoice connection did not wait on the transaction lock.');
}

for(const scenario of ['competing decisions','revision wins']) test(`invoice exception: ${scenario}`,async()=>{
  const first=await pool.connect(),second=await pool.connect();let waiting;
  try {
    await first.query('set role service_role');await second.query('set role service_role');
    await first.query('begin');
    if(scenario==='revision wins') await persistInvoiceCase(adapt(first),{recordId,actorId:ids.actor,expectedSnapshotId:original.snapshot_id},artifact('revision'));
    else await decide(first);
    const firstPid=(await first.query('select pg_backend_pid() pid')).rows[0].pid;
    const secondPid=(await second.query('select pg_backend_pid() pid')).rows[0].pid;
    assert.notEqual(firstPid,secondPid);
    waiting=decide(second).then(value=>({value}),error=>({error}));
    await waitForCaseLock(secondPid);
    await first.query('commit');
    const result=await waiting;
    assert.equal(result.error?.code,'PT409');
    assert.match(result.error.message,scenario==='revision wins'?/snapshot changed/:/already decided/);
    assert.equal((await db.query('select count(*)::int n from invoice_exception_decisions')).rows[0].n,scenario==='revision wins'?0:1);
    assert.equal((await db.query('select count(*)::int n from release_certificates where record_id=$1',[recordId])).rows[0].n,0);
  } finally {
    await first.query('rollback').catch(()=>{});
    if(waiting)await waiting;
    await first.query('reset role');await second.query('reset role');first.release();second.release();
  }
});
