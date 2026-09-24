import { createClient } from '@supabase/supabase-js';
import { getCaseTrace } from '../../../api-server/src/services/caseTrace.js';
import { reconcileReleaseGate } from '../../../api-server/src/services/releaseReconciliation.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function authToken(req: any) {
  const header = String(req.headers?.authorization ?? '');
  return header.startsWith('Bearer ') ? header.slice(7).trim() : '';
}

async function one<T>(promise: any): Promise<T | null> {
  const { data, error } = await promise;
  if (error) throw error;
  return (data ?? null) as T | null;
}

function objectOrEmpty(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, any>
    : {};
}

export default async function handler(req: any, res: any) {
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

    const supabase = createClient(supabaseUrl, supabaseSecretKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: userData, error: userError } = await supabase.auth.getUser(token);
    if (userError || !userData.user) return res.status(401).json({ error: 'Invalid or expired session' });

    const role = await one<any>(
      supabase.from('bridge_actor_roles').select('*').eq('user_id', userData.user.id).eq('active', true).maybeSingle(),
    );
    if (!role?.can_revoke) return res.status(403).json({ error: 'Revoke permission required for controlled release-gate test' });

    const trace: any = await getCaseTrace(supabase, recordId);
    if (!trace) return res.status(404).json({ error: 'Case not found' });

    const ingestion = trace.source.ingestion;
    if (!ingestion?.id || ingestion.status !== 'processed') {
      return res.status(409).json({ error: 'Der Quell-Snapshot ist noch nicht vollständig verarbeitet.' });
    }

    const extracted = objectOrEmpty(ingestion.extracted_schema);
    if (String(extracted.source_mode ?? '') !== 'northwind-proof') {
      return res.status(409).json({ error: 'Controlled negative validation test is restricted to northwind-proof cases.' });
    }

    const certificates = Array.isArray(trace.release?.certificates) ? trace.release.certificates : [];
    const certificate = certificates.length ? certificates[certificates.length - 1] : null;
    if (!certificate?.id) return res.status(409).json({ error: 'A release certificate is required before this test can run.' });
    if (String(trace.release?.effective_status ?? '').toLowerCase() !== 'trusted') {
      return res.status(409).json({ error: 'The case must currently be trusted before the post-release negative validation test can run.' });
    }

    const authoritative = trace.validation?.authoritative;
    if (!authoritative?.id || !authoritative?.conflict_id || !authoritative?.resolution_record_id) {
      return res.status(409).json({ error: 'An authoritative validation with an existing conflict/resolution chain is required.' });
    }

    const certifiedAtMs = certificate.certified_at ? Date.parse(String(certificate.certified_at)) : NaN;
    const createdAt = new Date(Math.max(Date.now(), Number.isFinite(certifiedAtMs) ? certifiedAtMs + 1000 : Date.now())).toISOString();
    const reason = String(req.body?.reason ?? '').trim() || 'Controlled post-release negative validation test.';

    const validation = await one<any>(
      supabase.from('validation_results').insert({
        conflict_id: authoritative.conflict_id,
        resolution_record_id: authoritative.resolution_record_id,
        validation_type: 'business_rule',
        status: 'failed',
        reason,
        created_at: createdAt,
        evidence: {
          controlled_test: true,
          test_type: 'post_release_negative_validation',
          purpose: 'verify_release_revocation_gate',
          source_mode: 'northwind-proof',
          source_snapshot_id: ingestion.id,
          source_hash: ingestion.source_hash,
          source_snapshot_unchanged: true,
          previous_authoritative_validation_id: authoritative.id,
          release_certificate_id: certificate.id,
          certified_at: certificate.certified_at ?? null,
          test_validation_created_at: createdAt,
          note: 'This test intentionally creates a later failed validation without changing Source, Snapshot, Candidates, Representation Evidence or Review.',
        },
      }).select('*').single(),
    );
    if (!validation) throw new Error('Controlled negative validation was not created');

    const reconciliation = await reconcileReleaseGate({
      supabase,
      recordId,
      actorUserId: userData.user.id,
      triggerValidationId: validation.id,
    });

    return res.status(200).json({
      controlled_test: true,
      validation_id: validation.id,
      validation_created_at: validation.created_at,
      release_reconciliation: reconciliation,
      trace: await getCaseTrace(supabase, recordId),
    });
  } catch (error) {
    console.error('PetraPlan controlled negative validation test failed:', error);
    return res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown controlled test error' });
  }
}
