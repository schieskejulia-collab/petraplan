/** Read-only suspicions from source-bound observations, never a release verdict. */
const HASH=/^[a-f0-9]{64}$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type Value=Record<string,any>;
type Party={name:string|null;identifiers:Array<{kind:string;value:string;path:string}>};
type Signals={contract:string;sourceSha256:string;invoiceType:string|null;number:string|null;issueDate:string|null;
 amount:string|null;currency:string|null;seller:Party;buyer:Party;contentDigest:string|null;lineCount:number;
 performanceContextPresent:boolean;issues:string[];authority:string};
type Basis={recordId:string;snapshotId:string;title:string;xmlSha256:string;pdfSha256:string|null;proofBound:boolean;accepted:boolean;signals:unknown};
export type DuplicateCode='IDENTICAL_XML'|'SAME_REPORTED_IDENTITY'|'SIMILAR_CONTENT'|'SIMILAR_CONTENT_WEAK_PARTIES';
export interface DuplicateFinding {
 code:DuplicateCode;recordId:string;snapshotId:string;title:string;number:string|null;
 issueDate:string|null;amount:string|null;currency:string|null;xmlSha256:string;
 pdfRelationship:'SAME_PDF'|'DIFFERENT_PDF'|'NOT_BOTH_PDF';
 reasons:string[];changedFields:string[];
}
export interface InvoiceDuplicateResult {
 contract:'invoice-duplicate-review-v1';readOnly:true;releaseAssessment:'NOT_EVALUATED';
 scope:'single-project-pilot';observedAt:string;target:{recordId:string;snapshotId:string;xmlSha256:string};
 status:'REVIEW_SUGGESTED'|'INCOMPLETE'|'NO_MATCH_IN_SUPPORTED_CHECKS';
 coverage:{otherCasesRead:number;unusableBasis:number;incompleteSignals:number;scanTruncated:boolean;findingsTruncated:boolean;limit:number};
 findingCount:number;findings:DuplicateFinding[];
}
function object(v:unknown):Value|null{return v!==null&&typeof v==='object'&&!Array.isArray(v)?v as Value:null;}
function nullable(v:unknown,max:number){return v===null||(typeof v==='string'&&v.trim().length>0&&v.length<=max);}
function date(v:unknown){return v===null||(typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)
 &&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v);}
function party(v:unknown):v is Party {
 const p=object(v);return !!p&&nullable(p.name,256)&&Array.isArray(p.identifiers)&&p.identifiers.length<=8
  &&p.identifiers.every((id:unknown)=>{const x=object(id);return x&&typeof x.kind==='string'
   &&/^(vat|legal:[A-Za-z0-9_-]{1,16})$/.test(x.kind)&&typeof x.value==='string'&&x.value.length>0&&x.value.length<=128
   &&typeof x.path==='string'&&x.path.length>0&&x.path.length<=2048;});
}
function signals(v:unknown,hash:string):Signals|null {
 const s=object(v);
 if(!s||s.contract!=='invoice-duplicate-signals-v1'||s.sourceSha256!==hash||s.authority!=='DOCUMENT_CLAIMS_ONLY'
   ||!nullable(s.number,256)||!date(s.issueDate)||!(s.invoiceType===null||(typeof s.invoiceType==='string'&&/^[0-9]{3}$/.test(s.invoiceType)))
   ||!(s.amount===null||(typeof s.amount==='string'&&/^-?(?:0|[1-9][0-9]{0,17})(?:\.[0-9]{1,6})?$/.test(s.amount)))
   ||!(s.currency===null||(typeof s.currency==='string'&&/^[A-Z]{3}$/.test(s.currency)))
   ||!(s.contentDigest===null||(typeof s.contentDigest==='string'&&HASH.test(s.contentDigest)))
   ||!party(s.seller)||!party(s.buyer)||!Number.isInteger(s.lineCount)||s.lineCount<0||s.lineCount>2000
   ||typeof s.performanceContextPresent!=='boolean'||!Array.isArray(s.issues)||!s.issues.every((x:unknown)=>typeof x==='string'))return null;
 return s as Signals;
}
function basis(v:unknown):Basis|null {
 const b=object(v);if(!b||typeof b.recordId!=='string'||!UUID.test(b.recordId)||typeof b.snapshotId!=='string'||!UUID.test(b.snapshotId)
  ||typeof b.xmlSha256!=='string'||!HASH.test(b.xmlSha256)||!(b.pdfSha256===null||(typeof b.pdfSha256==='string'&&HASH.test(b.pdfSha256)))
  ||b.proofBound!==true||typeof b.accepted!=='boolean'||typeof b.title!=='string'||b.title.length>300)return null;
 return b as Basis;
}
function identifiers(p:Party){return p.identifiers.map(x=>x.kind+'\0'+x.value);}
function shared(a:Party,b:Party){const keys=new Set(identifiers(a));return identifiers(b).some(x=>keys.has(x));}
function conflicting(a:Party,b:Party){
 const kinds=new Set(a.identifiers.map(x=>x.kind));return [...kinds].some(kind=>{
  const av=a.identifiers.filter(x=>x.kind===kind),bv=b.identifiers.filter(x=>x.kind===kind);
  return bv.length>0&&!av.some(x=>bv.some(y=>x.value===y.value));
 });
}
function complete(s:Signals|null){return !!s&&!!s.number&&!!s.invoiceType&&!!s.issueDate&&s.amount!==null&&!!s.currency
 &&!!s.contentDigest&&s.seller.identifiers.length>0&&s.buyer.identifiers.length>0&&s.issues.length===0;}
function classify(a:Basis,sa:Signals|null,b:Basis,sb:Signals|null):{code:DuplicateCode;reasons:string[];changedFields:string[]}|null {
 if(a.xmlSha256===b.xmlSha256)return {code:'IDENTICAL_XML',reasons:['Die gespeicherten XML-Originale haben denselben SHA-256. Das ist noch keine bestätigte wirtschaftliche Dublette.'],changedFields:[]};
 if(!a.accepted||!b.accepted||!sa||!sb||!sa.invoiceType||sa.invoiceType!==sb.invoiceType)return null;
 if(conflicting(sa.seller,sb.seller)||conflicting(sa.buyer,sb.buyer))return null;
 const strong=shared(sa.seller,sb.seller)&&shared(sa.buyer,sb.buyer);
 const changedFields=(['number','issueDate','amount','currency','contentDigest'] as const).filter(k=>sa[k]!==sb[k]);
 if(strong&&sa.number&&sa.number===sb.number&&sa.issueDate&&sb.issueDate&&sa.issueDate.slice(0,4)===sb.issueDate.slice(0,4)){
  return {code:'SAME_REPORTED_IDENTITY',reasons:['Beide Dokumente nennen gleiche Lieferanten- und Empfängerkennungen sowie dieselbe Rechnungsnummer und dasselbe Rechnungsjahr. Kennungen sind Dokumentangaben, keine Registerprüfung.'],changedFields};
 }
 const sameContent=sa.issueDate&&sa.issueDate===sb.issueDate&&sa.amount!==null&&sa.amount===sb.amount
  &&sa.currency&&sa.currency===sb.currency&&sa.contentDigest&&sa.contentDigest===sb.contentDigest;
 if(!sameContent)return null;
 if(strong)return {code:'SIMILAR_CONTENT',reasons:['Gleiche erklärte Parteien, Datum, Währung, Zahlbetrag und erfasste Positions-/Leistungsmerkmale; die Rechnungsnummer darf abweichen. Derselbe wirtschaftliche Vorgang ist noch zu belegen.'],changedFields};
 if(sa.seller.name&&sa.seller.name===sb.seller.name&&sa.buyer.name&&sa.buyer.name===sb.buyer.name){
  return {code:'SIMILAR_CONTENT_WEAK_PARTIES',reasons:['Namen und erfasste Rechnungsmerkmale stimmen überein. Belastbare gemeinsame Parteienkennungen fehlen; ähnlich benannte Parteien können verschieden sein.'],changedFields};
 }
 return null;
}

export function assessInvoiceDuplicates(raw:unknown):InvoiceDuplicateResult {
 const r=object(raw),target=basis(r?.target);
 if(!r||r.contract!=='invoice-duplicate-read-v1'||r.scope!=='single-project-pilot'||!target||!Array.isArray(r.others)
  ||typeof r.truncated!=='boolean'||!Number.isInteger(r.limit)||r.limit<1||r.limit>200||r.others.length>r.limit
  ||typeof r.observedAt!=='string'||!Number.isFinite(Date.parse(r.observedAt)))throw Error('Incomplete or unbound duplicate comparison basis');
 const st=signals(target.signals,target.xmlSha256);let unusable=0,incomplete=complete(st)&&target.accepted?0:1;
 const findings:DuplicateFinding[]=[];const seen=new Set<string>([target.recordId]);
 for(const entry of r.others){
  const e=object(entry);if(!e||typeof e.recordId!=='string'||!UUID.test(e.recordId)||seen.has(e.recordId))throw Error('Ambiguous comparison case identity');
  seen.add(e.recordId);const other=basis(e.basis);
  if(!other){unusable++;continue;}
  if(other.recordId!==e.recordId)throw Error('Comparison identity mismatch');
  const so=signals(other.signals,other.xmlSha256);if(!complete(so)||!other.accepted)incomplete++;
  const match=classify(target,st,other,so);if(!match)continue;
  findings.push({...match,recordId:other.recordId,snapshotId:other.snapshotId,title:other.title,number:so?.number??null,
   issueDate:so?.issueDate??null,amount:so?.amount??null,currency:so?.currency??null,xmlSha256:other.xmlSha256,
   pdfRelationship:target.pdfSha256&&other.pdfSha256?(target.pdfSha256===other.pdfSha256?'SAME_PDF':'DIFFERENT_PDF'):'NOT_BOTH_PDF'});
 }
 const order:DuplicateCode[]=['IDENTICAL_XML','SAME_REPORTED_IDENTITY','SIMILAR_CONTENT','SIMILAR_CONTENT_WEAK_PARTIES'];
 findings.sort((a,b)=>order.indexOf(a.code)-order.indexOf(b.code)||a.recordId.localeCompare(b.recordId));
 return {contract:'invoice-duplicate-review-v1',readOnly:true,releaseAssessment:'NOT_EVALUATED',scope:'single-project-pilot',observedAt:r.observedAt,
  target:{recordId:target.recordId,snapshotId:target.snapshotId,xmlSha256:target.xmlSha256},
  status:findings.length?'REVIEW_SUGGESTED':(r.truncated||unusable||incomplete?'INCOMPLETE':'NO_MATCH_IN_SUPPORTED_CHECKS'),
  coverage:{otherCasesRead:r.others.length,unusableBasis:unusable,incompleteSignals:incomplete,scanTruncated:r.truncated,findingsTruncated:findings.length>50,limit:r.limit},
  findingCount:findings.length,findings:findings.slice(0,50)};
}
