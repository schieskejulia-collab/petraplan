import assert from 'node:assert/strict';
import test from 'node:test';
import { assessInvoiceDuplicates } from './invoiceDuplicates.js';

const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const clone=<T>(x:T):T=>JSON.parse(JSON.stringify(x));
function row(n=1):any{return {recordId:id(n),snapshotId:id(n+100),title:'Invoice '+n,xmlSha256:String(n).repeat(64),pdfSha256:null,
 proofBound:true,accepted:true,signals:{contract:'invoice-duplicate-signals-v1',sourceSha256:String(n).repeat(64),authority:'DOCUMENT_CLAIMS_ONLY',
 invoiceType:'380',number:'INV-1',issueDate:'2026-11-28',amount:'119',currency:'EUR',contentDigest:'a'.repeat(64),lineCount:1,
 seller:{name:'Seller',identifiers:[{kind:'vat',value:'DE123456789',path:'/seller/vat'}]},
 buyer:{name:'Buyer',identifiers:[{kind:'vat',value:'DE987654321',path:'/buyer/vat'}]},performanceContextPresent:true,issues:[]}};}
function read(a=row(),b:any=row(2)):any{return {contract:'invoice-duplicate-read-v1',scope:'single-project-pilot',observedAt:'2026-11-28T12:00:00Z',
 target:a,others:b?[{recordId:b.recordId,basis:b}]:[],truncated:false,limit:200};}

test('identical source XML is a suspicion even when old signals are unavailable',()=>{
 const a=row(),b=row(2);b.xmlSha256=a.xmlSha256;b.signals=null;a.signals=null;a.pdfSha256='b'.repeat(64);b.pdfSha256='c'.repeat(64);
 const r=assessInvoiceDuplicates(read(a,b));assert.equal(r.findings[0].code,'IDENTICAL_XML');assert.equal(r.findings[0].pdfRelationship,'DIFFERENT_PDF');
 assert.equal(r.releaseAssessment,'NOT_EVALUATED');assert.equal(r.readOnly,true);assert(r.coverage.incompleteSignals>0);
});
test('same declared party identifiers, number and year are shown with changed fields',()=>{
 const a=row(),b=row(2);b.signals.amount='120';b.signals.issueDate='2026-11-29';b.signals.contentDigest='b'.repeat(64);
 const r=assessInvoiceDuplicates(read(a,b));assert.equal(r.findings[0].code,'SAME_REPORTED_IDENTITY');assert(r.findings[0].changedFields.includes('amount'));
});
test('same identity number in another year is not automatically called the same invoice',()=>{
 const a=row(),b=row(2);b.signals.issueDate='2025-11-28';assert.equal(assessInvoiceDuplicates(read(a,b)).findingCount,0);
});
test('different invoice number can still produce a similar-content suspicion',()=>{
 const a=row(),b=row(2);b.signals.number='INV-OTHER';const r=assessInvoiceDuplicates(read(a,b));assert.equal(r.findings[0].code,'SIMILAR_CONTENT');
});
test('recurring performance, other currency, other type, other buyer and different lines are negative controls',()=>{
 for(const change of ['period','currency','type','buyer','quantity']){
  const a=row(),b=row(2);b.signals.number='OTHER';
  if(change==='currency')b.signals.currency='USD';if(change==='type')b.signals.invoiceType='381';
  if(change==='buyer')b.signals.buyer.identifiers[0].value='DE111111111';
  if(change==='period'||change==='quantity')b.signals.contentDigest='d'.repeat(64);
  assert.equal(assessInvoiceDuplicates(read(a,b)).findingCount,0,change);
 }
});
test('same names and amount alone do not produce a suspicion',()=>{
 const a=row(),b=row(2);b.signals.number='OTHER';b.signals.contentDigest='d'.repeat(64);
 a.signals.seller.identifiers=[];b.signals.seller.identifiers=[];assert.equal(assessInvoiceDuplicates(read(a,b)).findingCount,0);
});
test('weak party matching requires the same complete content/date/amount tuple and is labelled weak',()=>{
 const a=row(),b=row(2);b.signals.number='OTHER';a.signals.buyer.identifiers=[];b.signals.buyer.identifiers=[];
 const r=assessInvoiceDuplicates(read(a,b));assert.equal(r.findings[0].code,'SIMILAR_CONTENT_WEAK_PARTIES');assert(r.coverage.incompleteSignals>0);
});
test('conflicting strong identifiers cannot be bypassed by equal names',()=>{
 const a=row(),b=row(2);b.signals.seller.identifiers[0].value='DE999999999';assert.equal(assessInvoiceDuplicates(read(a,b)).findingCount,0);
});
test('malformed, stale, unsupported and unbound signals cannot imply a clean comparison',()=>{
 for(const alter of [(b:any)=>b.signals.sourceSha256='f'.repeat(64),(b:any)=>b.signals.contract='future',
  (b:any)=>b.signals.issueDate='2026-02-30',(b:any)=>b.signals.amount='119e0',(b:any)=>b.proofBound=false]){
  const a=row(),b=row(2);alter(b);const r=assessInvoiceDuplicates(read(a,b));assert.equal(r.findingCount,0);assert.equal(r.status,'INCOMPLETE');
 }
});
test('incomplete pagination is visible even if no candidate matched',()=>{
 const a=row(),b=row(2);b.signals.number='OTHER';b.signals.amount='120';const input=read(a,b);input.truncated=true;
 const r=assessInvoiceDuplicates(input);assert.equal(r.status,'INCOMPLETE');assert.equal(r.coverage.scanTruncated,true);
});
test('ambiguous target, repeated other record and wrong scope are rejected',()=>{
 const a=row(),b=row(2);for(const input of [read({...a,proofBound:false},b),{...read(a,b),scope:'all-tenants'},
  {...read(a,b),others:[{recordId:a.recordId,basis:a}]},{...read(a,b),others:[{recordId:b.recordId,basis:b},{recordId:b.recordId,basis:b}]}]){
  assert.throws(()=>assessInvoiceDuplicates(input));
 }
});
test('zero and large exact decimal strings compare without floating point conversion',()=>{
 for(const value of ['0','999999999999999999.123456']){
  const a=row(),b=row(2);b.signals.number='OTHER';a.signals.amount=value;b.signals.amount=value;
  assert.equal(assessInvoiceDuplicates(read(a,b)).findings[0].code,'SIMILAR_CONTENT');
 }
});
test('rejected original XML can match exact bytes but not a claimed business identity',()=>{
 const a=row(),b=row(2);a.accepted=false;assert.equal(assessInvoiceDuplicates(read(a,b)).findingCount,0);
 b.xmlSha256=a.xmlSha256;assert.equal(assessInvoiceDuplicates(read(a,b)).findings[0].code,'IDENTICAL_XML');
});
test('input evidence is not mutated by the read-only assessment',()=>{
 const input=read(),before=clone(input);assessInvoiceDuplicates(input);assert.deepEqual(input,before);
});

test('finding cap preserves total count and labels truncated results',()=>{
 const a=row(),raw=read(a,null);
 raw.others=Array.from({length:60},(_,n)=>{const b=row(2);b.recordId=id(n+2);b.snapshotId=id(n+102);return {recordId:b.recordId,basis:b};});
 const result=assessInvoiceDuplicates(raw);assert.equal(result.findingCount,60);assert.equal(result.findings.length,50);
 assert.equal(result.coverage.findingsTruncated,true);assert.equal(result.status,'REVIEW_SUGGESTED');
});
