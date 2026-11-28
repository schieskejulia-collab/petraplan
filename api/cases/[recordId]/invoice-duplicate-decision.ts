import { requireBridgeRole } from '../../_lib/auth.js';
import { assessInvoiceDuplicates } from '../../../api-server/src/services/invoiceDuplicates.js';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
export function createInvoiceDuplicateDecisionHandler(authenticate:any=requireBridgeRole,environment:any=process.env){
 return async(req:any,res:any)=>{
  res.setHeader('Cache-Control','private, no-store');res.setHeader('Vary','Authorization');
  if(!['GET','POST'].includes(req.method))return res.status(405).json({error:'GET oder POST erforderlich.'});
  const {recordId,snapshotId}=req.query??{};
  if(typeof recordId!=='string'||!UUID.test(recordId)||typeof snapshotId!=='string'||!UUID.test(snapshotId))return res.status(400).json({error:'Aktuelle Fallfassung erforderlich.'});
  try{
   const ctx=await authenticate(req,res);if(!ctx)return;
   if(ctx.role.can_review!==true)return res.status(403).json({error:'Review-Berechtigung erforderlich.'});
   if(environment.PETRAPLAN_INVOICE_DUPLICATE_SCOPE!=='single-project-pilot'||environment.PETRAPLAN_INVOICE_DUPLICATE_ENFORCEMENT!=='1')
    return res.status(503).json({error:'Verbindliche Dublettenprüfung ist nicht freigeschaltet.'});
   const {data:b,error}=await ctx.supabase.rpc('bridge_invoice_duplicate_review_basis',{p_record_id:recordId,p_snapshot_id:snapshotId,p_actor_id:ctx.user.id});
   if(error)throw error;
   if(!b||typeof b.corpusHash!=='string'||!/^[a-f0-9]{64}$/.test(b.corpusHash)||!Array.isArray(b.decisions))throw Error('Invalid basis');
   const comparison=assessInvoiceDuplicates(b.read);
   if(comparison.target.recordId!==recordId||comparison.target.snapshotId!==snapshotId)throw Error('Wrong basis');
   const peers=comparison.findings.map(f=>b.decisions.find((d:any)=>d.record_id===f.recordId&&d.action==='DUPLICATE'));
   const currentRelease=await ctx.supabase.rpc('bridge_current_release',{p_record_id:recordId});if(currentRelease.error)throw currentRelease.error;
   if(req.method==='GET')return res.status(200).json({canRevoke:ctx.role.can_revoke===true&&['trusted','exception'].includes(currentRelease.data?.effective_status),contract:'invoice-duplicate-decision-v1',corpusHash:b.corpusHash,comparison,
    decision:b.decisions.find((d:any)=>d.record_id===recordId)??null,
    blockedCopyCount:peers.filter(Boolean).length,canAdjudicate:ctx.role.can_adjudicate_invoice_duplicates===true});
   const body=req.body??{};
   if(body.corpusHash!==b.corpusHash)return res.status(409).json({error:'Rechnungsbestand geändert. Vergleich neu laden.'});
   if(!['CLEAR','DISTINCT','PRIMARY','DUPLICATE','HOLD'].includes(body.action)||typeof body.reason!=='string'||body.reason.trim().length<8||body.reason.length>4000
    ||typeof body.evidenceReference!=='string'||body.evidenceReference.trim().length<3||body.evidenceReference.length>2000)return res.status(400).json({error:'Entscheidung, Belegverweis und Begründung erforderlich.'});
   const result=await ctx.supabase.rpc('bridge_decide_invoice_duplicates',{p_record_id:recordId,p_snapshot_id:snapshotId,p_actor_id:ctx.user.id,
    p_corpus_hash:b.corpusHash,p_action:body.action,p_reason:body.reason,p_evidence_reference:body.evidenceReference,
    p_assessment:comparison,p_peer_decision_ids:body.action==='PRIMARY'?peers.filter(Boolean).map((d:any)=>d.id):[]});
   if(result.error)throw result.error;
   return res.status(201).json(result.data);
  }catch(e:any){
   const status=['PT400','PT403','PT404','PT409'].includes(e?.code)?Number(e.code.slice(2)):503;
   return res.status(status).json({error:status===403?'Eine unabhängige, ausdrücklich bestellte Entscheidungsperson ist erforderlich.':status===409?'Die aktuelle Prüfgrundlage erlaubt diese Entscheidung nicht. Bitte Vergleich und Belege prüfen.':'Dublettenentscheidung nicht verfügbar.'});
  }
 };
}
export default createInvoiceDuplicateDecisionHandler();
