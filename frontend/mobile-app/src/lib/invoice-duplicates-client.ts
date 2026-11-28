import type { InvoiceDuplicateResult } from '../../../../api-server/src/services/invoiceDuplicates.js';
export type { InvoiceDuplicateResult };
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH=/^[a-f0-9]{64}$/;
const count=(v:any,max:number)=>Number.isInteger(v)&&v>=0&&v<=max;
const optional=(v:any,pattern:RegExp,max=256)=>v===null||(typeof v==='string'&&v.length<=max&&pattern.test(v));
const strings=(v:any,max=20)=>Array.isArray(v)&&v.length<=max&&v.every((x:any)=>typeof x==='string'&&x.length<=2048);
const CODES=['IDENTICAL_XML','SAME_REPORTED_IDENTITY','SIMILAR_CONTENT','SIMILAR_CONTENT_WEAK_PARTIES'];
export function parseInvoiceDuplicates(v:any,recordId:string,snapshotId:string):InvoiceDuplicateResult {
 if(!v||v.contract!=='invoice-duplicate-review-v1'||v.readOnly!==true||v.releaseAssessment!=='NOT_EVALUATED'
  ||v.scope!=='single-project-pilot'||v.target?.recordId!==recordId||v.target?.snapshotId!==snapshotId
  ||!UUID.test(recordId)||!UUID.test(snapshotId)||!HASH.test(v.target?.xmlSha256??'')
  ||typeof v.observedAt!=='string'||!Number.isFinite(Date.parse(v.observedAt))||!['REVIEW_SUGGESTED','INCOMPLETE','NO_MATCH_IN_SUPPORTED_CHECKS'].includes(v.status)
  ||!Array.isArray(v.findings)||v.findings.length>50||!Number.isInteger(v.findingCount)||v.findingCount<v.findings.length
  ||!v.coverage||typeof v.coverage.scanTruncated!=='boolean'||typeof v.coverage.findingsTruncated!=='boolean'
  ||!count(v.coverage.limit,200)||v.coverage.limit===0||!count(v.coverage.otherCasesRead,v.coverage.limit)
  ||!count(v.coverage.unusableBasis,v.coverage.otherCasesRead)||!count(v.coverage.incompleteSignals,v.coverage.otherCasesRead+1)
  ||v.findingCount>v.coverage.otherCasesRead||v.coverage.findingsTruncated!==(v.findingCount>50)
  ||v.findings.length!==Math.min(v.findingCount,50)
  ||(v.findingCount>0)!==(v.status==='REVIEW_SUGGESTED')
  ||(v.status==='NO_MATCH_IN_SUPPORTED_CHECKS'&&(v.coverage.scanTruncated||v.coverage.unusableBasis||v.coverage.incompleteSignals))
  ||new Set(v.findings.map((f:any)=>f.recordId)).size!==v.findings.length
  ||v.findings.some((f:any)=>!UUID.test(f?.recordId??'')||!UUID.test(f?.snapshotId??'')||!CODES.includes(f?.code)
   ||f.recordId===recordId||typeof f.title!=='string'||f.title.length>300
   ||!HASH.test(f.xmlSha256??'')||!strings(f.reasons)||!strings(f.changedFields)
   ||!f.changedFields.every((x:string)=>['number','issueDate','amount','currency','contentDigest'].includes(x))
   ||!optional(f.number,/\S/)||!optional(f.issueDate,/^\d{4}-\d{2}-\d{2}$/)
   ||!optional(f.amount,/^-?(?:0|[1-9][0-9]{0,17})(?:\.[0-9]{1,6})?$/)
   ||!optional(f.currency,/^[A-Z]{3}$/)||!['SAME_PDF','DIFFERENT_PDF','NOT_BOTH_PDF'].includes(f.pdfRelationship)))
  throw Error('Die Vergleichsantwort passt nicht zur aktuellen Rechnungsfassung.');
 return v;
}
export async function fetchInvoiceDuplicates(recordId:string,snapshotId:string,token:string,request:typeof fetch=fetch){
 const response=await request(`/api/cases/${encodeURIComponent(recordId)}/invoice-duplicates?snapshotId=${encodeURIComponent(snapshotId)}`,
  {headers:{Authorization:`Bearer ${token}`},cache:'no-store'});
 const body=await response.json();if(!response.ok)throw Error(body.error??'Dublettenprüfung nicht verfügbar.');
 return parseInvoiceDuplicates(body,recordId,snapshotId);
}
