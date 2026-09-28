import { getCaseTrace } from '../../api-server/src/services/caseTrace.js';
import { requireBridgeRole } from '../_lib/auth.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function loadClaimLayer(supabase: any, recordId: string) {
  const { data: claims, error: claimsError } = await supabase
    .from('claims')
    .select('*')
    .eq('record_id', recordId)
    .order('created_at', { ascending: true });

  if (claimsError) throw new Error(claimsError.message);

  const claimRows = claims ?? [];
  const claimIds = claimRows.map((claim: any) => claim.id);

  if (!claimIds.length) {
    return {
      claims: [],
      evidence_links: [],
    };
  }

  const { data: evidenceLinks, error: evidenceLinksError } = await supabase
    .from('claim_evidence_links')
    .select('*')
    .in('claim_id', claimIds)
    .order('linked_at', { ascending: true });

  if (evidenceLinksError) throw new Error(evidenceLinksError.message);

  return {
    claims: claimRows,
    evidence_links: evidenceLinks ?? [],
  };
}

export default async function handler(req: any, res: any) {
  try {
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      return res.status(405).json({ error: 'Method not allowed' });
    }

    const recordId = String(req.query?.recordId ?? '');
    if (!UUID_RE.test(recordId)) {
      return res.status(400).json({ error: 'recordId must be a UUID' });
    }

    const ctx = await requireBridgeRole(req, res);
    if (!ctx) return;

    const trace = await getCaseTrace(ctx.supabase, recordId);
    if (!trace) return res.status(404).json({ error: 'Case not found' });

    const claimLayer = await loadClaimLayer(ctx.supabase, recordId);

    return res.status(200).json({
      ...trace,
      claim_layer: claimLayer,
    });
  } catch (error) {
    console.error('PetraPlan /api/cases/:recordId failed:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
