import { requireBridgeRole } from '../../_lib/auth.js';
import { assessInvoiceDuplicates } from '../../../api-server/src/services/invoiceDuplicates.js';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function createInvoiceDuplicatesHandler(authenticate:any=requireBridgeRole,environment:any=process.env){
 return async(req:any,res:any)=>{
  res.setHeader('Cache-Control','private, no-store');res.setHeader('Vary','Authorization');
  if(req.method!=='GET'){res.setHeader('Allow','GET');return res.status(405).json({error:'Nur GET ist erlaubt.'});}
  const {recordId,snapshotId}=req.query??{};
  if(typeof recordId!=='string'||!UUID.test(recordId)||typeof snapshotId!=='string'||!UUID.test(snapshotId))
   return res.status(400).json({error:'Fall und aktuelle Rechnungsfassung sind erforderlich.'});
  try{
   const ctx=await authenticate(req,res);if(!ctx)return;
   if(ctx.role.can_review!==true)return res.status(403).json({error:'Review-Berechtigung erforderlich.'});
   if(environment.PETRAPLAN_INVOICE_DUPLICATE_SCOPE!=='single-project-pilot')
    return res.status(503).json({error:'Die projektweite Dublettenprüfung ist in dieser Umgebung nicht freigeschaltet.'});
   const {data,error}=await ctx.supabase.rpc('bridge_invoice_duplicate_candidates',{
    p_record_id:recordId,p_snapshot_id:snapshotId,p_actor_id:ctx.user.id,p_scope:'single-project-pilot',p_limit:200,
   });
   if(error)throw error;
   const result=assessInvoiceDuplicates(data);
   if(result.target.recordId!==recordId||result.target.snapshotId!==snapshotId)throw Error('Unbound comparison response');
   return res.status(200).json(result);
  }catch(error:any){
   if(['PT400','PT403','PT404','PT409'].includes(error?.code))return res.status(Number(error.code.slice(2))).json({
    error:error.code==='PT409'?'Die Rechnungsfassung wurde geändert. Bitte den Fall neu laden.':'Die Vergleichsgrundlage ist nicht verfügbar.',
   });
   console.error('Invoice duplicate comparison unavailable',error?.code??'basis');
   return res.status(503).json({error:'Die Dublettenprüfung konnte nicht vollständig ausgeführt werden.'});
  }
 };
}
export default createInvoiceDuplicatesHandler();
