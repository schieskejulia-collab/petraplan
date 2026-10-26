import { createClient } from '@supabase/supabase-js';
import { getCaseTrace } from '../../../api-server/src/services/caseTrace.js';
import { CLAIM_TYPES, type ClaimType } from '../../../api-server/src/services/claimFromCandidate.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Role = {
  user_id: string;
  role_name: string;
  active: boolean;
  can_review: boolean;
};

function authToken(req: any) {
  const header = String(req.headers?.authorization ?? '');
  return header.startsWith('Bearer ') ? header.slice(7).trim() : '';
}

async function one<T>(promise: any): Promise<T | null> {
  const { data, error } = await promise;
  if (error) throw error;
  return (data ?? null) as T | null;
}

export async function handleClaim(req: any, res: any, dependencies = { createClient, getCaseTrace }) {
  try {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return res.status(405).json({ error: 'Method not allowed' });
    }

    const recordId = String(req.query?.recordId ?? '');
    if (!UUID_RE.test(recordId)) return res.status(400).json({ error: 'recordId must be a UUID' });

    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !supabaseSecretKey) return res.status(500).json({ error: 'Server configuration incomplete' });

    const token = authToken(req);
    if (!token) return res.status(401).json({ error: 'Authentication required' });

    const supabase = dependencies.createClient(supabaseUrl, supabaseSecretKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: userData, error: userError } = await supabase.auth.getUser(token);
    if (userError || !userData.user) return res.status(401).json({ error: 'Invalid or expired session' });
    const user = userData.user;

    const role = await one<Role>(
      supabase.from('bridge_actor_roles').select('user_id,role_name,active,can_review').eq('user_id', user.id).eq('active', true).maybeSingle(),
    );
    if (!role?.can_review) return res.status(403).json({ error: 'Review permission required' });

    const trace = await dependencies.getCaseTrace(supabase, recordId);
    if (!trace) return res.status(404).json({ error: 'Case not found' });
    if (trace.source.ingestion?.status !== 'processed') {
      return res.status(409).json({ error: 'Der Quell-Snapshot ist noch nicht vollständig verarbeitet.' });
    }

    const candidateId = String(req.body?.candidate_id ?? '');
    if (!UUID_RE.test(candidateId)) return res.status(400).json({ error: 'candidate_id must be a UUID' });

    const statement = String(req.body?.statement ?? '').trim();
    const subjectAddress = String(req.body?.subject_address ?? '').trim();
    const claimType = String(req.body?.claim_type ?? '') as ClaimType;
    if (!CLAIM_TYPES.includes(claimType)) return res.status(400).json({ error: 'Unsupported claim_type' });

    if (statement.length < 8 || !subjectAddress) return res.status(400).json({error:'A Claim subject and explicit statement of at least eight characters are required.'});

    const { data: result, error: claimError } = await supabase.rpc('bridge_create_explicit_claim', {
      p_record_id: recordId, p_snapshot_id: trace.source.ingestion.id, p_candidate_id: candidateId,
      p_actor_id: user.id, p_subject_address: subjectAddress,
      p_claim_type: claimType, p_statement: statement,
    });
    if (claimError) throw claimError;
    if (!result?.claim_id) throw new Error('Atomic Claim creation returned no id');

    return res.status(200).json({
      claim_id: result.claim_id,
      release_invalidation: result.release_invalidation,
      trace: await dependencies.getCaseTrace(supabase, recordId),
    });
  } catch (error: any) {
    const code=String(error?.code ?? '');
    if (['PT400','PT403','PT404','PT409'].includes(code)) return res.status(Number(code.slice(2))).json({error:error.message});
    if (code==='PGRST202' || code==='42883') return res.status(503).json({error:'Die Datenbankfunktion fuer atomare Claim-Erstellung ist noch nicht eingerichtet.'});
    console.error(error);
    return res.status(500).json({ error: error?.message ?? 'Claim could not be created' });
  }
}

export default async function handler(req: any, res: any) {
  return handleClaim(req, res);
}
