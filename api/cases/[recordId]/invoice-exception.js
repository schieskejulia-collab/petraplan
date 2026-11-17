import { requireBridgeRole } from '../../_lib/auth.ts';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function createInvoiceExceptionHandler(authenticate = requireBridgeRole) {
  return async function invoiceException(req,res) {
    if(req.method !== 'POST') { res.setHeader('Allow','POST'); return res.status(405).json({error:'Nur POST ist erlaubt.'}); }
    const recordId=req.query?.recordId;
    if(typeof recordId!=='string' || !UUID.test(recordId)) return res.status(400).json({error:'Ungültiger Fall.'});
    try {
      const ctx=await authenticate(req,res);
      if(!ctx) return;
      const {action,snapshotId,validationId,requestId,reason,evidenceReference,purpose}=req.body??{};
      if(typeof reason!=='string' || reason.trim().length<8) return res.status(400).json({error:'Eine konkrete Begründung ist erforderlich.'});
      let name,parameters;
      if(action==='REQUEST') {
        if(!ctx.role.can_review) return res.status(403).json({error:'Review-Berechtigung erforderlich.'});
        if(!UUID.test(snapshotId??'') || !UUID.test(validationId??'')
          || typeof evidenceReference!=='string' || evidenceReference.trim().length<3
          || typeof purpose!=='string' || purpose.trim().length<3) return res.status(400).json({error:'Fassung, Beleg und Verwendungszweck fehlen.'});
        name='bridge_request_invoice_exception';
        parameters={p_record_id:recordId,p_snapshot_id:snapshotId,p_validation_id:validationId,p_actor_id:ctx.user.id,
          p_reason:reason,p_evidence_reference:evidenceReference,p_purpose:purpose};
      } else if(action==='APPROVED'||action==='REJECTED') {
        if(!UUID.test(requestId??'')) return res.status(400).json({error:'Ausnahmeantrag fehlt.'});
        const {data:request,error}=await ctx.supabase.from('invoice_exception_requests').select('record_id').eq('id',requestId).maybeSingle();
        if(error) throw error;
        if(request?.record_id!==recordId) return res.status(404).json({error:'Antrag gehört nicht zu diesem Fall.'});
        name='bridge_decide_invoice_exception';
        parameters={p_request_id:requestId,p_actor_id:ctx.user.id,p_decision:action,p_reason:reason};
      } else return res.status(400).json({error:'Unbekannte Ausnahmeentscheidung.'});
      const {data,error}=await ctx.supabase.rpc(name,parameters);
      if(error) throw error;
      return res.status(200).json(data);
    } catch(error) {
      if(['PT400','PT403','PT404','PT409'].includes(error?.code)) return res.status(Number(error.code.slice(2))).json({error:error.message});
      if(error?.code==='23505') return res.status(409).json({error:'Für diese Fassung liegt bereits ein Ausnahmeantrag vor.'});
      console.error('Invoice exception failed',error?.code??'unknown');
      return res.status(500).json({error:'Ausnahme konnte nicht gespeichert werden.'});
    }
  };
}
export default createInvoiceExceptionHandler();
