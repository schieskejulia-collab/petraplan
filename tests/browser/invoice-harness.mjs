// Localhost-only live handlers/worker/SQL fixture. No hosted credentials.
import { createServer } from 'node:http';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { resolve,extname } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { createInvoiceUploadHandler } from '../../api/bridge/invoice-upload.js';
import { createInvoiceExceptionHandler } from '../../api/cases/[recordId]/invoice-exception.js';
import { createInvoicePdfHandler } from '../../api/cases/[recordId]/invoice-pdf.js';
import { createInvoiceWorker } from '../../scripts/invoice-worker/server.mjs';
import { createDecisionHandler } from '../../.decision-test-build/api/cases/[recordId]/decision.js';
import { getCaseTrace,listCases } from '../../dist/services/caseTrace.js';
import { installInvoiceCaseFixture } from '../decision-integrity/invoice-case-fixture.mjs';
import { id,ids,read } from '../decision-integrity/atomic-review-fixture.mjs';
import { fixtureClient } from './fixture-client.mjs';

if(process.env.PETRAPLAN_BROWSER_FIXTURE!=='1')throw new Error('Explicit local fixture opt-in required');
if(process.env.SUPABASE_SECRET_KEY||process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.PETRAPLAN_INVOICE_DATABASE_URL)
  throw new Error('Do not pass hosted database credentials to this fixture');
process.env.SUPABASE_URL='https://fixture.invalid';process.env.SUPABASE_SECRET_KEY='local-test-only';
const token='local-invoice-browser-test';
const db=new PGlite();
await installInvoiceCaseFixture(db);
await db.exec(await read('../../supabase/migrations/20261117210000_invoice_pdf_exceptions.sql'));
// Two explicitly seeded test identities. This proves ID separation only, not
// real Supabase login or that accounts belong to distinct people.
const approverId=id(278),approverToken='local-invoice-independent-approver';
await db.query('insert into auth.users values($1)',[approverId]);
await db.query(`insert into bridge_actor_roles(user_id,role_name,active,can_review,can_release,can_revoke,
  can_approve_invoice_exception,invoice_exception_authority_reference)
  values($1,'exception_reviewer',true,true,true,true,true,'Isolated browser fixture appointment')`,[approverId]);
await db.query(`update bridge_actor_roles set can_approve_invoice_exception=true,
  invoice_exception_authority_reference='Isolated browser fixture appointment' where user_id=$1`,[ids.actor]);
await db.exec('set role service_role');
const client=await fixtureClient(db,ids.actor,token);
const identities=new Map([[token,ids.actor],[approverToken,approverId]]);
client.auth.getUser=async supplied=>({data:{user:identities.has(supplied)?{id:identities.get(supplied)}:null},error:null});
async function authenticate(req,res){
  const authorization=String(req.headers.authorization??'');
  const userId=authorization.startsWith('Bearer ')?identities.get(authorization.slice(7)):null;
  if(!userId){res.status(401).json({error:'Local test session required'});return null;}
  const role=(await db.query('select * from bridge_actor_roles where user_id=$1',[userId])).rows[0];
  return {supabase:client,user:{id:userId},role};
}
const upload=createInvoiceUploadHandler(authenticate);
const exception=createInvoiceExceptionHandler(authenticate);
const pdf=createInvoicePdfHandler(authenticate);
const decision=createDecisionHandler({createClient:()=>client,getCaseTrace});
const worker=createInvoiceWorker({token,jar:process.env.PETRAPLAN_KOSIT_JAR,
  scenarios:process.env.PETRAPLAN_KOSIT_SCENARIOS,allowPdf:true});
worker.listen(0,'127.0.0.1');await once(worker,'listening');
process.env.PETRAPLAN_INVOICE_WORKER_URL=`http://127.0.0.1:${worker.address().port}`;
process.env.PETRAPLAN_INVOICE_WORKER_TOKEN=token;
process.env.PETRAPLAN_PDF_TEST_UPLOADS='1';
const dist=resolve('frontend/mobile-app/dist');
const server=createServer(async(req,res)=>{
  res.status=code=>{res.statusCode=code;return res;};
  res.json=data=>{res.setHeader('content-type','application/json');res.end(JSON.stringify(data));return res;};
  res.send=data=>{res.end(data);return res;};
  try {
    const url=new URL(req.url,'http://127.0.0.1');
    if(url.pathname.startsWith('/api/')) {
      let bytes=0,chunks=[];
      for await(const chunk of req){bytes+=chunk.length;if(bytes>12*1024*1024)throw new Error('Fixture request too large');chunks.push(chunk);}
      req.body=chunks.length?JSON.parse(Buffer.concat(chunks).toString()):{};
      req.query=Object.fromEntries(url.searchParams);
      const match=url.pathname.match(/^\/api\/cases\/([a-f0-9-]+)(?:\/(decision|invoice-exception|invoice-pdf))?$/);
      if(url.pathname==='/api/bridge/invoice-upload')return await upload(req,res);
      if(!(await authenticate(req,res)))return;
      if(url.pathname==='/api/cases')return res.json({items:await listCases(client,50,0)});
      if(match){
        req.query.recordId=match[1];
        if(match[2]==='decision')return await decision(req,res);
        if(match[2]==='invoice-exception')return await exception(req,res);
        if(match[2]==='invoice-pdf')return await pdf(req,res);
        const trace=await getCaseTrace(client,match[1]);
        return trace?res.json(trace):res.status(404).json({error:'Case not found'});
      }
      return res.status(404).json({error:'Fixture endpoint not available'});
    }
    const path=url.pathname.startsWith('/assets/')?resolve(dist,'.'+url.pathname):resolve(dist,'index.html');
    if(!path.startsWith(dist+'/'))return res.status(404).end();
    res.setHeader('content-type',({'.js':'text/javascript','.css':'text/css','.html':'text/html'})[extname(path)]??'application/octet-stream');
    res.end(await readFile(path));
  }catch(error){console.error('Fixture request failed',error.message);if(!res.headersSent)res.status(500).json({error:error.message});else res.end();}
});
server.listen(0,'127.0.0.1');await once(server,'listening');
console.log(JSON.stringify({origin:`http://127.0.0.1:${server.address().port}`,token,actorId:ids.actor,approverToken,approverId}));
async function close(){await new Promise(r=>server.close(r));await new Promise(r=>worker.close(r));await db.close();process.exit(0);}
process.once('SIGTERM',close);process.once('SIGINT',close);
