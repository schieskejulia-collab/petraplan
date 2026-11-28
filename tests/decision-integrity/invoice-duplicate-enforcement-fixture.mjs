import {createHash} from 'node:crypto';
import {installInvoiceCaseFixture} from './invoice-case-fixture.mjs';
import {read,id,ids} from './atomic-review-fixture.mjs';
export {id,ids};
export async function install(db){
 await installInvoiceCaseFixture(db);
 for(const file of ['20261128040000_invoice_duplicate_read.sql','20261128050000_invoice_duplicate_decisions.sql','20261128051000_invoice_duplicate_release_guard.sql'])await db.exec(await read('../../supabase/migrations/'+file));
}
export function artifact(number='ONE'){
 const invoice=Buffer.from(`<Invoice>${number}</Invoice>`),report=Buffer.from('<Report/>');
 const hash=b=>createHash('sha256').update(b).digest('hex');const source=hash(invoice);
 return {invoice,report,result:{contract:'en16931-invoice-v1',syntax:'UBL',sourceSha256:source,fields:{},
 technicalEvidence:{invoiceSha256:source,reportSha256:hash(report),accepted:true,validatorDecision:'accept',messages:[]},decision:{status:'READY_FOR_REVIEW',releaseAllowed:false,blockers:[]},
 duplicateSignals:{contract:'invoice-duplicate-signals-v1',sourceSha256:source,authority:'DOCUMENT_CLAIMS_ONLY',invoiceType:'380',number,issueDate:'2026-11-28',amount:'119',currency:'EUR',contentDigest:hash(Buffer.from(number)),lineCount:1,performanceContextPresent:true,issues:[],
 seller:{name:'Seller',identifiers:[{kind:'vat',value:'DE123456789',path:'/seller'}]},buyer:{name:'Buyer',identifiers:[{kind:'vat',value:'DE987654321',path:'/buyer'}]}}}};
}
