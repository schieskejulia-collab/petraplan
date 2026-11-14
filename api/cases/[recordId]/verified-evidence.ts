import { createClient } from '@supabase/supabase-js';
import { retrieveTrustedSource } from '../../../api-server/src/services/trustedSourceReader.js';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
async function read(query:any):Promise<any> {
 const {data,error,count}=await query;if(error)throw error;
 if(Array.isArray(data)&&typeof count==='number'&&count>data.length)throw new Error('Evidence history query is incomplete');
 return data;
}
const dependencies={createClient,retrieveTrustedSource};

/** No client-supplied URL, source digest, retrieved bytes, verifier or Claim status
 * is accepted. Trust roots and domain grants remain administrative. */
export async function handleVerifiedEvidence(req:any,res:any,deps=dependencies) {
 try {
  if(!['GET','POST'].includes(req.method)) {res.setHeader('Allow','GET, POST');return res.status(405).json({error:'Method not allowed'});}
  const recordId=String(req.query?.recordId??'');
  if(!UUID.test(recordId))return res.status(400).json({error:'recordId must be a UUID'});
  const token=String(req.headers?.authorization??'').match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if(!token)return res.status(401).json({error:'Authentication required'});
  const url=process.env.SUPABASE_URL,key=process.env.SUPABASE_SECRET_KEY??process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!url||!key)return res.status(503).json({error:'Server configuration incomplete'});
  const db=deps.createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data:auth,error:authError}=await db.auth.getUser(token);
  if(authError||!auth.user)return res.status(401).json({error:'Invalid or expired session'});
  const actor=auth.user.id;
  const role=await read(db.from('bridge_actor_roles').select('active,can_review,can_revoke').eq('user_id',actor).eq('active',true).maybeSingle());
  if(!role?.can_review)return res.status(403).json({error:'Technical review permission required'});
  const record=await read(db.from('records').select('id,ingestion_log_id').eq('id',recordId).maybeSingle());
  if(!record)return res.status(404).json({error:'Case not found'});

  if(req.method==='GET') {
   const verificationId=req.query?.verification_id;
   if(verificationId!==undefined) {
    if(!UUID.test(String(verificationId)))return res.status(400).json({error:'Invalid verification ID'});
    const value=await read(db.from('source_verification_records').select('*').eq('id',verificationId).eq('record_id',recordId).maybeSingle());
    if(!value)return res.status(404).json({error:'Verified source content not found for this case'});
    if(typeof value.content_bytes!=='string'||!/^\\x(?:[0-9a-f]{2})+$/i.test(value.content_bytes))throw new Error('Stored source bytes are unavailable');
    const {content_bytes,...metadata}=value;
    const bytes=Buffer.from(content_bytes.slice(2),'hex');
    const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
    const [sourceWithdrawal,verificationWithdrawal]=await Promise.all([
     read(db.from('evidence_withdrawals').select('id,reason,withdrawn_at').eq('source_id',value.source_id).maybeSingle()),
     read(db.from('evidence_withdrawals').select('id,reason,withdrawn_at').eq('verification_id',value.id).maybeSingle()),
    ]);
    return res.status(200).json({verification:metadata,source_text:text,byte_length:bytes.length,
     withdrawals:[sourceWithdrawal,verificationWithdrawal].filter(Boolean),meaning_confirmed:false,validation_allowed:false,release_allowed:false});
   }
   const [verifications,assessments]=await Promise.all([
    read(db.from('source_verification_records').select('id,source_id,snapshot_id,claim_id,rule_version_id,claim_basis,content_sha256,media_type,verified_by,verified_at',{count:'exact'}).eq('record_id',recordId).order('verified_at')),
    read(db.from('semantic_evidence_assessments').select('*',{count:'exact'}).eq('record_id',recordId).order('assessed_at')),
   ]);
   return res.status(200).json({verifications:verifications??[],assessments:assessments??[],validation_allowed:false,release_allowed:false});
  }

  const body=req.body??{};
  if(body.action==='retrieve') {
   if(!UUID.test(String(body.source_id??''))||!UUID.test(String(body.rule_version_id??'')))return res.status(400).json({error:'Registered source and rule version IDs are required'});
   const rule=await read(db.from('semantic_rule_versions').select('id,record_id,snapshot_id').eq('id',body.rule_version_id).eq('record_id',recordId).maybeSingle());
   if(!rule||rule.snapshot_id!==record.ingestion_log_id)return res.status(409).json({error:'Rule does not belong to the current case snapshot'});
   const source=await read(db.from('trusted_evidence_sources').select('*').eq('id',body.source_id).maybeSingle());
   if(!source)return res.status(404).json({error:'Administratively registered source version not found'});
   let origins:unknown;
   try {origins=JSON.parse(process.env.PETRAPLAN_EVIDENCE_ALLOWED_ORIGINS??'[]');}catch {origins=null;}
   if(!Array.isArray(origins)||!origins.length||!origins.every(x=>typeof x==='string'))return res.status(503).json({error:'Der zugelassene Quellenzugriff ist noch nicht konfiguriert.'});
   let evidence;
   try {evidence=await deps.retrieveTrustedSource(source,origins);}catch(error) {
    return res.status(409).json({code:'EVIDENCE_VERIFICATION_FAILED',error:error instanceof Error?error.message:'Evidence could not be verified'});
   }
   const result=await read(db.rpc('bridge_record_source_verification',{
    p_source_id:source.id,p_record_id:recordId,p_snapshot_id:record.ingestion_log_id,p_rule_version_id:rule.id,p_actor_id:actor,
    p_content_hex:evidence.bytes.toString('hex'),p_media_type:evidence.mediaType,p_resolved_address:evidence.resolvedAddress,
    p_tls_peer_sha256:evidence.tlsPeerSha256,p_retrieval_started_at:evidence.startedAt,
   }));
   return res.status(201).json(result);
  }
  if(body.action==='assess') {
   if(!UUID.test(String(body.verification_id??''))||!UUID.test(String(body.authority_id??'')))return res.status(400).json({error:'Actual source verification and domain authority IDs are required'});
   const verification=await read(db.from('source_verification_records').select('id').eq('id',body.verification_id).eq('record_id',recordId).maybeSingle());
   if(!verification)return res.status(404).json({error:'Source verification not found for this case'});
   const result=await read(db.rpc('bridge_assess_verified_evidence',{
    p_verification_id:verification.id,p_actor_id:actor,p_authority_id:body.authority_id,
    p_decision:body.decision,p_reason:body.reason,p_coverage:body.coverage,p_coverage_reason:body.coverage_reason,
    p_anchor:body.anchor,p_criteria:body.criteria??{},
   }));
   return res.status(201).json(result);
  }
  if(body.action==='check') {
   if(!UUID.test(String(body.rule_version_id??'')))return res.status(400).json({error:'Rule version ID is required'});
   return res.status(200).json(await read(db.rpc('bridge_check_verified_evidence',{p_record_id:recordId,p_rule_version_id:body.rule_version_id,p_actor_id:actor})));
  }
  if(body.action==='withdraw_verification'||body.action==='withdraw_assessment') {
   if(!UUID.test(String(body.target_id??'')))return res.status(400).json({error:'Evidence target ID is required'});
   const kind=body.action==='withdraw_verification'?'verification':'assessment';
   const table=kind==='verification'?'source_verification_records':'semantic_evidence_assessments';
   const target=await read(db.from(table).select('id').eq('id',body.target_id).eq('record_id',recordId).maybeSingle());
   if(!target)return res.status(404).json({error:'Evidence target not found for this case'});
   return res.status(201).json(await read(db.rpc('bridge_withdraw_evidence',{
    p_kind:kind,p_target_id:target.id,p_actor_id:actor,p_reason:body.reason,p_authority_id:body.authority_id??null,
   })));
  }
  return res.status(400).json({error:'Unsupported evidence action; source trust cannot be assigned from this endpoint'});
 }catch(error:any) {
  const code=String(error?.code??'');
  if(['PT400','PT403','PT404','PT409'].includes(code))return res.status(Number(code.slice(2))).json({error:error.message});
  if(['PGRST202','PGRST205','42P01','42883'].includes(code))return res.status(503).json({error:'Die unabhaengige Belegpruefung ist in dieser Datenbank noch nicht eingerichtet.'});
  if(['23502','23514','22P02','22021'].includes(code))return res.status(400).json({error:'Evidence or assessment input is incomplete or invalid'});
  if(code==='23505')return res.status(409).json({error:'This evidence decision already exists; retain its history and use an explicit withdrawal'});
  console.error('Verified evidence operation failed:',error);
  return res.status(500).json({error:'Verified evidence operation failed'});
 }
}
export default async function handler(req:any,res:any){return handleVerifiedEvidence(req,res);}
