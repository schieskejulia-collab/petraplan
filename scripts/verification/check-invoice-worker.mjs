import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { inspectViaWorker } from '../invoice-worker/protocol.mjs';

const origin=new URL(process.env.PETRAPLAN_INVOICE_WORKER_URL);
if(!['localhost','127.0.0.1','[::1]'].includes(origin.hostname))
  throw new Error('Container smoke probe is limited to a local test worker');
for(const file of ['0114-ubl.xml','positive.pdf']) {
  const bytes=await readFile(resolve(process.env.PETRAPLAN_INVOICE_FIXTURES,file));
  const result=await inspectViaWorker(bytes,{origin:origin.origin,token:process.env.PETRAPLAN_INVOICE_WORKER_TOKEN});
  assert.equal(result.result.technicalEvidence.validatorDecision,'accept');
  assert.equal(result.result.technicalEvidence.accepted,true);
  assert.equal(result.result.technicalEvidence.reportContract.status,'MATCHED');
  assert.equal(result.result.decision.status,'READY_FOR_REVIEW');
  assert.equal(result.result.decision.releaseAllowed,false);
  if(file.endsWith('.pdf'))assert.equal(result.result.pdfComparison.status,'NEEDS_VISUAL_CONFIRMATION');
}
console.log('Local container processed XML and PDF through KoSIT/OCR; no release authority.');
