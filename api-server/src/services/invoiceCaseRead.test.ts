import assert from 'node:assert/strict';
import test from 'node:test';
import { buildInvoiceCaseSnapshots } from './invoiceCaseRead.js';

function stored(technical: Record<string, unknown>) {
  const hash = 'a'.repeat(64), report = 'b'.repeat(64);
  const entry = {snapshot_id:'snapshot',validation_id:'validation',created_at:'2026-11-27T12:00:00Z',
    ingestion:{source_hash:hash,extracted_schema:{contract:'en16931-invoice-v1',syntax:'CII',sourceSha256:hash,
      fields:{'BT-115':{status:'observed',values:[{original:'0',path:'/payable',currency:{value:'EUR'}}]}},
      technicalEvidence:{invoiceSha256:hash,reportSha256:report,messages:[],...technical}}}};
  const validation = {id:'validation',evidence:{source_snapshot_id:'snapshot',source_hash:hash,report_sha256:report}};
  return {entry,validation};
}

test('case projection preserves validator acceptance separately from bridge contract rejection', () => {
  const {entry,validation}=stored({accepted:false,validatorDecision:'accept',reportContract:{status:'STEP_SET_MISMATCH'}});
  const result=buildInvoiceCaseSnapshots([entry],'snapshot',[validation])[0];
  assert.equal(result.proof?.accepted,false);
  assert.equal(result.proof?.validatorDecision,'accept');
  assert.equal(result.proof?.reportContractStatus,'STEP_SET_MISMATCH');
  assert.equal(result.payable?.value,'0');
  validation.evidence.source_hash='wrong';
  assert.equal(buildInvoiceCaseSnapshots([entry],'snapshot',[validation])[0].proof,null);
});

test('historical evidence without validator decision remains unknown rather than fabricated rejection', () => {
  const {entry,validation}=stored({accepted:false});
  const result=buildInvoiceCaseSnapshots([entry],'snapshot',[validation])[0];
  assert.equal(result.proof?.validatorDecision,null);
  assert.equal(result.proof?.reportContractStatus,null);
});
