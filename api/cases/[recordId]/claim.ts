import { createClient } from '@supabase/supabase-js';
import { getCaseTrace } from '../../../api-server/src/services/caseTrace.js';
import { buildExplicitClaimDraft, CLAIM_TYPES, type ClaimType } from '../../../api-server/src/services/claimFromCandidate.js';
import { invalidateReleaseAfterNewClaim } from '../../../api-server/src/services/claimReleaseInvalidation.js';

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

async function many<T>(promise: any): Promise<T[]> {
  const { data, error } = await promise;
  if (error) throw error;
  return (data ?? []) as T[];
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

    const candidate = await one<any>(
      supabase.from('conversion_candidates').select('*').eq('id', candidateId).eq('record_id', recordId).maybeSingle(),
    );
    if (!candidate) return res.status(404).json({ error: 'Candidate not found for this case' });
    if (String(candidate.state) !== 'confirmed') {
      return res.status(409).json({ error: 'Nur ein bestätigter Kandidat darf Grundlage eines expliziten Claims werden.' });
    }

    const existing = await one<any>(
      supabase.from('claims').select('id,status').eq('candidate_id', candidateId).neq('status', 'SUPERSEDED').limit(1).maybeSingle(),
    );
    if (existing) {
      return res.status(409).json({ error: `Für diesen Kandidaten existiert bereits Claim ${String(existing.id)} (${String(existing.status)}).` });
    }

    const sourceAddress = await one<any>(
      supabase.from('address_registry').select('id,address,kind').eq('id', candidate.source_address_id).maybeSingle(),
    );
    if (!sourceAddress) return res.status(409).json({ error: 'Candidate source address is missing' });

    const impactLinks = await many<any>(
      supabase.from('impact_links').select('address_id').eq('candidate_id', candidateId),
    );
    const impactAddressIds = [...new Set(impactLinks.map((link) => String(link.address_id)).filter(Boolean))];
    const impactAddresses = impactAddressIds.length
      ? await many<any>(supabase.from('address_registry').select('id,address,kind').in('id', impactAddressIds))
      : [];

    const confirmation = await one<any>(
      supabase
        .from('candidate_state_history')
        .select('id,changed_by,changed_at,reason,evidence_reference')
        .eq('candidate_id', candidateId)
        .eq('state', 'confirmed')
        .order('changed_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    );

    const draft = buildExplicitClaimDraft({
      candidate,
      sourceAddress,
      allowedSubjectAddresses: impactAddresses,
      subjectAddress,
      statement,
      claimType,
      createdBy: user.id,
      producerRole: role.role_name,
      sourceSystem: String(trace.source.ingestion?.source_system ?? trace.source.record.source_system ?? '') || null,
      confirmation,
    });

    const claim = await one<any>(
      supabase.from('claims').insert(draft.claim).select('*').single(),
    );
    if (!claim?.id) throw new Error('Claim insert returned no id');

    const links = draft.evidenceLinks.map((link) => ({ ...link, claim_id: claim.id }));
    const { error: evidenceError } = await supabase.from('claim_evidence_links').insert(links);
    if (evidenceError) {
      await supabase.from('claims').delete().eq('id', claim.id);
      throw evidenceError;
    }

    let releaseInvalidation;
    try {
      releaseInvalidation = await invalidateReleaseAfterNewClaim({
        supabase,
        recordId,
        claimId: String(claim.id),
        actorUserId: user.id,
      });
    } catch (invalidationError) {
      // The claim must never survive if the safety revocation could not be persisted.
      // Deleting the claim also removes its claim_evidence_links via ON DELETE CASCADE.
      await supabase.from('claims').delete().eq('id', claim.id);
      throw invalidationError;
    }

    return res.status(200).json({
      claim_id: claim.id,
      release_invalidation: releaseInvalidation,
      trace: await dependencies.getCaseTrace(supabase, recordId),
    });
  } catch (error: any) {
    console.error(error);
    return res.status(500).json({ error: error?.message ?? 'Claim could not be created' });
  }
}

export default async function handler(req: any, res: any) {
  return handleClaim(req, res);
}
