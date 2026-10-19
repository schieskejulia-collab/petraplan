import { buildClaimCheckPlan } from '../../../api-server/src/services/claimCheckPlan.js';
import { createClient } from '@supabase/supabase-js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
async function read(query: any): Promise<any> {
  const { data, error } = await query;
  if (error) throw error;
  return data;
}

export async function handleClaimChecks(req: any, res: any, dependencies = { createClient }) {
  try {
    if (!['GET', 'POST'].includes(req.method)) {
      res.setHeader('Allow', 'GET, POST');
      return res.status(405).json({ error: 'Method not allowed' });
    }
    const recordId = String(req.query?.recordId ?? '');
    if (!UUID.test(recordId)) return res.status(400).json({ error: 'recordId must be a UUID' });
    const token = String(req.headers?.authorization ?? '').match(/^Bearer (.+)$/)?.[1]?.trim();
    if (!token) return res.status(401).json({ error: 'Authentication required' });
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) return res.status(503).json({ error: 'Server configuration incomplete' });
    const db = dependencies.createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: auth, error: authError } = await db.auth.getUser(token);
    if (authError || !auth.user) return res.status(401).json({ error: 'Invalid or expired session' });
    const actor = auth.user.id;
    const role = await read(db.from('bridge_actor_roles').select('active,can_review').eq('user_id', actor).eq('active', true).maybeSingle());
    if (!role?.can_review) return res.status(403).json({ error: 'Review permission required' });
    const record = await read(db.from('records').select('id,ingestion_log_id').eq('id', recordId).maybeSingle());
    if (!record) return res.status(404).json({ error: 'Case not found' });

    if (req.method === 'GET') {
      const [requirements, evidence] = await Promise.all([
        read(db.from('claim_check_requirements').select('*').eq('record_id',recordId).order('created_at')),
        read(db.from('representation_evidence').select('*').eq('record_id',recordId)),
      ]);
      const ids = (requirements ?? []).map((r:any)=>r.id);
      const claimIds = [...new Set((requirements ?? []).map((r:any)=>r.claim_id))];
      const [observations, entries] = await Promise.all([
        ids.length ? read(db.from('claim_check_observations').select('*').in('requirement_id',ids).order('sequence')) : [],
        Promise.all(claimIds.map(async (id:any)=>[id,await read(db.rpc('bridge_semantic_claim_basis',{p_claim_id:id}))])),
      ]);
      return res.status(200).json({requirements:buildClaimCheckPlan(requirements??[],observations??[],evidence??[],Object.fromEntries(entries),record.ingestion_log_id),
        evidence:evidence??[],scope:'CASE_ONLY',planning_only:true,claim_confirmation_automatic:false});
    }
    const body = req.body ?? {};
    if (body.action === 'add') {
      const previous = body.previous_requirement_id == null ? null : String(body.previous_requirement_id);
      if (!UUID.test(String(body.claim_id??'')) || (previous!==null && !UUID.test(previous))) return res.status(400).json({error:'Invalid Claim or previous requirement ID'});
      const definition=body.definition;
      if (!definition || !['question','required_information','check_condition','counter_condition','coverage_requirement','next_check'].every(f=>typeof definition[f]==='string' && definition[f].trim().length>=8)
        || typeof definition.required_address!=='string' || !definition.required_address.trim()) return res.status(400).json({error:'Prüffrage, Fundstelle, Bedingungen, Vollständigkeit und nächster Schritt sind erforderlich.'});
      const requirement=await read(db.rpc('bridge_add_claim_check',{p_record_id:recordId,p_claim_id:body.claim_id,p_actor_id:actor,p_definition:definition,p_previous_id:previous}));
      return res.status(201).json({requirement});
    }
    if (body.action !== 'record') return res.status(400).json({error:'Unsupported check action'});
    const o=body.observation;
    if (!UUID.test(String(body.requirement_id??'')) || !o || !['MISSING','UNKNOWN','SUPPORTS','CONTRADICTS'].includes(o.result)
      || !['UNKNOWN','INCOMPLETE','COMPLETE'].includes(o.coverage_status) || typeof o.reason!=='string' || o.reason.trim().length<8
      || (o.representation_evidence_id!=null && !UUID.test(o.representation_evidence_id))) return res.status(400).json({error:'Ungültiger Prüfbericht'});
    const observation=await read(db.rpc('bridge_record_claim_check',{p_record_id:recordId,p_requirement_id:body.requirement_id,p_actor_id:actor,p_observation:o}));
    return res.status(201).json({observation,claim_confirmation_automatic:false});
  } catch (error: any) {
    const code = String(error?.code ?? '');
    if (['PT400', 'PT403', 'PT404', 'PT409'].includes(code)) return res.status(Number(code.slice(2))).json({ error: error.message });
    if (['PGRST202', 'PGRST205', '42P01', '42883'].includes(code)) {
      return res.status(503).json({ error: 'Die Prüfanforderungen sind in dieser Datenbank noch nicht eingerichtet.' });
    }
    if (['23502', '23514', '22P02'].includes(code)) return res.status(400).json({ error: 'Prüfanforderung oder Prüfbericht ist unvollständig oder ungültig.' });
    if (code === '23505') return res.status(409).json({ error: 'Diese Prüfanforderung wurde bereits ersetzt. Bitte neu laden.' });
    console.error('Claim check planning failed:', error);
    return res.status(500).json({ error: 'Prüfanforderung konnte nicht gespeichert werden.' });
  }
}

export default async function handler(req: any, res: any) {
  return handleClaimChecks(req, res);
}
