// Experiment harness only. Product rules are verified against the frozen manifest.
import { once } from 'node:events';
import { readFile,writeFile,mkdir } from 'node:fs/promises';
import { resolve,join } from 'node:path';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { PGlite } from '@electric-sql/pglite';
import { createInvoiceWorker } from '../invoice-worker/server.mjs';
import { createInvoiceUploadHandler } from '../../api/bridge/invoice-upload.js';
import { persistInvoiceCase } from '../capture-invoice-case.mjs';
import { installInvoiceCaseFixture } from '../../tests/decision-integrity/invoice-case-fixture.mjs';
import { id,ids,read,criteria,review } from '../../tests/decision-integrity/atomic-review-fixture.mjs';
import { getCaseTrace } from '../../dist/services/caseTrace.js';

const plan=resolve('docs/verification/invoice-heldout-03');
const inputs=resolve(process.env.PETRAPLAN_HELDOUT_INPUTS??'../heldout-03/inputs');
const output=resolve(process.env.PETRAPLAN_HELDOUT_OUTPUT??'../heldout-03/results');
const digest=b=>createHash('sha256').update(b).digest('hex');
const load=async file=>JSON.parse(await readFile(file,'utf8'));
const save=async(name,value)=>writeFile(join(output,name),JSON.stringify(value,null,2)+'\n');
await mkdir(output,{recursive:true});
const freeze=await load(join(plan,'freeze.json'));
const expected=await load(join(plan,'expected.json'));
async function verifyFrozen(){
  for(const f of freeze.runtimeFiles)if(digest(await readFile(f.path))!==f.sha256)throw new Error('Frozen product source changed: '+f.path);
  if(digest(await readFile(join(plan,'expected.json')))!==freeze.expectedSha256)throw new Error('Expectations changed');
  if(digest(await readFile(join(plan,'sources.json')))!==freeze.sourcesSha256)throw new Error('Sources changed');
  if(digest(await readFile(join(plan,'protocol.md')))!==freeze.protocolSha256)throw new Error('Protocol changed');
  if(digest(await readFile(process.env.PETRAPLAN_KOSIT_JAR))!==freeze.validatorJarSha256)throw new Error('Validator changed');
  const config=resolve(process.env.PETRAPLAN_KOSIT_SCENARIOS,'..');
  for(const f of freeze.validatorConfigurationFiles)if(digest(await readFile(join(config,f.path)))!==f.sha256)throw new Error('Validator configuration changed: '+f.path);
}
await verifyFrozen();
const db=new PGlite();
await installInvoiceCaseFixture(db);
await db.exec(await read('../../supabase/migrations/20261117210000_invoice_pdf_exceptions.sql'));
await db.exec('set role service_role');
const unavailableTables = new Set(['operation_logs', 'runtime_logs', 'representation_evidence',
  'address_observations', 'conflict_sources', 'resolution_logs', 'resolution_status']);
function fixtureClient(db) {
  return {
    rpc: async (name, params) => ({
      data: (await db.query(`select public.${name}($1,$2) as value`, [params.p_record_id, params.p_validation_id])).rows[0].value,
      error: null,
    }),
    from: table => {
      const where = [];
      const params = [];
      let order = '';
      let single = false;
      const query = {
        select() { return query; },
        eq(column, value) {
          params.push(value);
          where.push(`${column}=$${params.length}`);
          return query;
        },
        in(column, values) {
          const placeholders = values.map(value => { params.push(value); return '$' + params.length; });
          where.push(`${column} in (${placeholders.join(',')})`);
          return query;
        },
        order(column, options) { order = ` order by ${column} ${options?.ascending === false ? 'desc' : 'asc'}`; return query; },
        maybeSingle() { single = true; return query; },
        then(resolve, reject) {
          const execute = async () => {
            let rows = [];
            if (!unavailableTables.has(table)) {
              const select = table === 'bridge_invoice_evidence'
                ? `select e.snapshot_id,e.validation_id,e.created_at,jsonb_build_object('source_hash',i.source_hash,'extracted_schema',i.extracted_schema) ingestion
                   from bridge_invoice_evidence e join ingestion_logs i on i.id=e.snapshot_id`
                : `select * from ${table}`;
              rows = (await db.query(select + (where.length ? ' where ' + where.join(' and ') : '') + order.replace('created_at', table === 'bridge_invoice_evidence' ? 'e.created_at' : 'created_at'), params)).rows;
            }
            if (table === 'review_criterion_results') {
              for (const row of rows) row.review_criteria=(await db.query('select * from review_criteria where id=$1',[row.criterion_id])).rows[0];
            }
            rows = JSON.parse(JSON.stringify(rows));
            return { data: single ? rows[0] ?? null : rows, error: null };
          };
          return execute().then(resolve, reject);
        },
      };
      return query;
    },
  };
}

const client=fixtureClient(db);
client.rpc=async(name,args)=>{
  try {const values=Object.values(args);return {data:(await db.query(`select public.${name}(${values.map((_,i)=>'$'+(i+1)).join(',')}) result`,values)).rows[0].result,error:null};}
  catch(error){return {data:null,error};}
};
const worker=createInvoiceWorker({token:'heldout-local-only-token',jar:process.env.PETRAPLAN_KOSIT_JAR,
  scenarios:process.env.PETRAPLAN_KOSIT_SCENARIOS,allowPdf:true});
worker.listen(0,'127.0.0.1');await once(worker,'listening');
process.env.PETRAPLAN_INVOICE_WORKER_URL=`http://127.0.0.1:${worker.address().port}`;
process.env.PETRAPLAN_INVOICE_WORKER_TOKEN='heldout-local-only-token';
process.env.PETRAPLAN_PDF_TEST_UPLOADS='1';
let latestArtifact;
const upload=createInvoiceUploadHandler(async()=>({user:{id:ids.actor},role:{can_review:true},supabase:{
  async rpc(name,args){
    if(name!=='bridge_capture_invoice_case')throw new Error('Unexpected upload mutation');
    const bytes=v=>v?Buffer.from(v.slice(2),'hex'):null;
    latestArtifact={invoice:bytes(args.p_invoice),report:bytes(args.p_report),pdf:bytes(args.p_pdf),result:args.p_result};
    try{return {data:await persistInvoiceCase(db,{recordId:args.p_record_id,expectedSnapshotId:args.p_expected_snapshot_id,actorId:args.p_actor_id},latestArtifact)}}catch(error){return {error};}
  }
}}));
async function send(filename,recordId,expectedSnapshotId=null){
  latestArtifact=null;let status,body;
  const res={status(value){status=value;return res;},json(value){body=value;},setHeader(){}};
  await upload({method:'POST',body:{recordId,expectedSnapshotId,contentBase64:(await readFile(join(inputs,filename))).toString('base64')}},res);
  return {status,body,artifact:latestArtifact};
}
const sql=async(statement,args)=>(await db.query(statement,args)).rows;
const counts=async record=>(await sql('select count(*)::int n from release_certificates where record_id=$1',[record]))[0].n;
const release=async(record,captured,session)=>(await sql('select bridge_release_case($1,$2,$3,$4,$5,$6) result',
  [record,captured.snapshot_id,captured.validation_id,session,ids.actor,'Explicit held-out test release; not a live payment decision']))[0].result;
const report={baseline:freeze.baselineCommit,startedAt:new Date().toISOString(),results:[],revisionProbe:null};
try {
  for(let i=0;i<expected.length;i++){
    const e=expected[i],recordId=id(9000+i);
    const result={filename:e.filename,recordId,checks:[],termMismatches:[]};
    const check=(name,passed,detail)=>result.checks.push({name,passed,...(detail===undefined?{}:{detail})});
    try {
      if(digest(await readFile(join(inputs,e.filename)))!==e.sha256)throw new Error('Input hash changed');
      const imported=await send(e.filename,recordId),a=imported.artifact;
      result.httpStatus=imported.status;result.import=imported.body;
      check('expected import outcome',e.expectedImport==='REJECTED'?imported.status===422:imported.status===201);
      check('no automatic certificate',await counts(recordId)===0);
      if(a){
        result.decision=a.result.decision;result.technicalAccepted=a.result.technicalEvidence.accepted;
        result.validatorMessages=a.result.technicalEvidence.messages;
        result.pdfComparison=a.result.pdfComparison??null;
        await save(e.filename+'.projection.json',a.result);
        await writeFile(join(output,e.filename+'.kosit.xml'),a.report);
        check('XML hash binds original',a.result.sourceSha256===digest(a.invoice));
        check('report hash matches bytes',a.result.technicalEvidence.reportSha256===digest(a.report));
        check('original input retained',e.filename.endsWith('.pdf')?digest(a.pdf)===e.sha256:digest(a.invoice)===e.sha256);
        check('no automatic release flag',a.result.decision.releaseAllowed===false);
        check('expected technical eligibility',a.result.decision.status===e.expectedXmlEligibility);
        for(const [term,values]of Object.entries(e.terms??{})){
          const actual=a.result.fields[term]?.values?.map(v=>v.original)??[];
          if(!isDeepStrictEqual(actual,values))result.termMismatches.push({term,expected:values,actual});
        }
        check('selected terms preserve original values',result.termMismatches.length===0);
        check('invoice line count',a.result.lines.length===e.lineCount);
        const trace=await getCaseTrace(client,recordId);
        await save(e.filename+'.trace-before.json',trace);
        check('case projection binds current snapshot',trace.invoice.snapshots[0].snapshotId===imported.body.snapshot_id);
        check('case projection payable',trace.invoice.snapshots[0].payable?.value===e.terms['BT-115'][0]);
        const basis=(await sql('select bridge_claims_basis($1) basis',[recordId]))[0].basis;
        try {
          const reviewed=(await review(db,{record:recordId,snapshot:imported.body.snapshot_id,validation:imported.body.validation_id,
            basis,criteria,reason:'Scripted test review against the precommitted source oracle'})).rows[0].result;
          result.review={accepted:true,sessionId:reviewed.review_session_id};
          if(a.result.decision.status==='READY_FOR_REVIEW'){
            check('review does not release automatically',await counts(recordId)===0);
            result.release=await release(recordId,imported.body,reviewed.review_session_id);
            const final=await getCaseTrace(client,recordId);
            await save(e.filename+'.trace-after.json',final);
            result.finalStatus=final.release.effective_status;
            check('explicit release appears in case projection',result.finalStatus==='trusted');
          }else check('blocked review denied',false,'Review unexpectedly accepted');
        }catch(error){result.review={accepted:false,code:error.code,message:error.message};check('review outcome matches eligibility',a.result.decision.status==='BLOCKED',error.message);}
        if(a.result.decision.status==='BLOCKED'){
          check('blocked input retains no certificate',await counts(recordId)===0);
          try {await sql('select bridge_request_invoice_exception($1,$2,$3,$4,$5,$6,$7)',[recordId,imported.body.snapshot_id,
            imported.body.validation_id,ids.actor,'Probe for invalid exception basis','Held-out test source','Internal test only']);
            check('invalid exception basis denied',false);
          }catch(error){result.exceptionAttempt={code:error.code,message:error.message};check('invalid exception basis denied',error.code==='PT409');}
        }
      }else check('rejected import creates no case',(await sql('select id from records where id=$1',[recordId])).length===0);
    }catch(error){result.harnessError={message:error.message,code:error.code};check('harness completed',false,error.message);}
    report.results.push(result);await save('run.json',report);
    console.log(e.filename, result.httpStatus,result.decision?.status??'NO_IMPORT','failed checks',result.checks.filter(c=>!c.passed).length);
  }
  // Both syntaxes are unchanged foreign originals of the same first invoice.
  const first=report.results.find(r=>r.filename==='0114-ubl.xml');
  if(first?.finalStatus==='trusted'){
    const repeated=await send(first.filename,first.recordId,first.import.snapshot_id);
    const revised=await send('0114-uncefact.xml',first.recordId,first.import.snapshot_id);
    const old=(await sql('select bridge_current_release($1) result',[first.recordId]))[0].result;
    const trace=await getCaseTrace(client,first.recordId);await save('revision.trace.json',trace);
    report.revisionProbe={repeated:repeated.body,repeatedHttp:repeated.status,revised:revised.body,revisedHttp:revised.status,
      oldRelease:old,oldReleaseRevoked:old.effective_status==='revoked',
      exactRepeatReused:repeated.body.reused===true&&repeated.body.snapshot_id===first.import.snapshot_id,
      newOriginalRequiresReview:revised.body.snapshot_id!==first.import.snapshot_id&&trace.invoice.snapshots.length===2};
  }
  await verifyFrozen();report.frozenSourcesUnchanged=true;report.finishedAt=new Date().toISOString();await save('run.json',report);
} finally {await new Promise(r=>worker.close(r));await db.close();}
