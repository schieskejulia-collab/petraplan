import { getCaseTrace } from '../../api-server/src/services/caseTrace.js';
import { buildRdfProvReadModel } from '../../api-server/src/services/rdfProvReadModel.js';
import { buildAddressClaimReadModel } from '../../api-server/src/services/addressClaimReadModel.js';
import { claimFreshnessBlockers, unresolvedSemanticClaimBlockers } from '../../api-server/src/services/claimFreshness.js';
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
    const ingestion = trace.source.ingestion as Record<string, unknown> | null;
    const rdfProv = buildRdfProvReadModel({
      recordId,
      snapshot: ingestion
        ? {
            id: String(ingestion.id ?? ''),
            sourceSystem: String(ingestion.source_system ?? ''),
            observedAt: String(ingestion.ingested_at ?? ''),
          }
        : null,
      addresses: trace.address_layer.addresses,
      candidates: trace.address_layer.candidates,
      impactLinks: trace.address_layer.links,
      claims: claimLayer.claims,
      claimEvidenceLinks: claimLayer.evidence_links,
    });

    const certificate = trace.release.certificates.at(-1);
    const validation = trace.validation.authoritative;
    const hasClaimBlockers = claimFreshnessBlockers(claimLayer.claims, validation).length > 0
      || unresolvedSemanticClaimBlockers(claimLayer.claims).length > 0;
    const effectiveReleaseStatus = hasClaimBlockers ? null : trace.release.effective_status;
    const addressClaimRead = [...new Set(trace.address_layer.addresses.map((a: any) => String(a.address ?? '')).filter(Boolean))]
      .map(address => buildAddressClaimReadModel({
        address,
        recordId,
        snapshotId: ingestion?.id ? String(ingestion.id) : null,
        claims: claimLayer.claims,
        evidenceLinks: claimLayer.evidence_links,
        effectiveReleaseStatus,
        authoritativeValidationId: validation?.id ?? null,
        certificateValidationId: certificate?.validation_result_id ?? null,
      }));

    return res.status(200).json({
      ...trace,
      address_claim_read: addressClaimRead,
      claim_layer: claimLayer,
      rdf_prov: rdfProv,
    });
  } catch (error) {
    console.error('PetraPlan /api/cases/:recordId failed:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
