import { createClient } from '@supabase/supabase-js';
import { getCaseTrace } from '../../../api-server/src/services/caseTrace.js';
import { reconcileReleaseGate } from '../../../api-server/src/services/releaseReconciliation.js';
import { applyConfirmedNorthwindCandidates } from '../../../frontend/mobile-app/src/lib/bridge-confirmed-candidates.js';
import { evaluateRecordWithConflictTruth } from '../../../frontend/mobile-app/src/lib/bridge-conflict-truth.js';
import { parseRawRecord } from '../../../frontend/mobile-app/src/lib/bridge-pipeline.js';

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

async function many<T>(promise: any): Promise<T[]> {
  const { data, error } = await promise;
  if (error) throw error;
  return (data ?? []) as T[];
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
    if (!role?.can_review) return res.status(403).json({ error: 'Review permission required' });

    const trace: any = await getCaseTrace(supabase, recordId);
    if (!trace) return res.status(404).json({ error: 'Case not found' });

    const ingestion = trace.source.ingestion;
    if (!ingestion?.id || ingestion.status !== 'processed') {
      return res.status(409).json({ error: 'Der Quell-Snapshot ist noch nicht vollständig verarbeitet.' });
    }

    const extracted = objectOrEmpty(ingestion.extracted_schema);
    if (String(extracted.source_mode ?? '') !== 'northwind-proof') {
      return res.status(409).json({ error: 'Neuvalidierung bestätigter Kandidaten ist derzeit nur für gespeicherte Northwind-Fälle vorgesehen.' });
    }

    const candidates = await many<any>(
      supabase
        .from('conversion_candidates')
        .select('id, candidate_key, record_id, snapshot_id, state, source_path, conversion_kind, proposed_value, evidence')
        .eq('record_id', recordId)
        .order('created_at'),
    );
    const openCandidates = candidates.filter((candidate) => String(candidate.state) === 'candidate');
    if (openCandidates.length > 0) {
      return res.status(409).json({ error: `${openCandidates.length} Kandidat${openCandidates.length === 1 ? ' ist' : 'en sind'} noch offen.` });
    }

    const confirmed = candidates.filter((candidate) => String(candidate.state) === 'confirmed');
    if (confirmed.length === 0) {
      return res.status(409).json({ error: 'Keine bestätigte Fachentscheidung für eine Neuvalidierung vorhanden.' });
    }

    const baseRaw = parseRawRecord(extracted.bridge_input_raw);
    const previousAdapterConflicts = Array.isArray(extracted.adapter_issues) ? extracted.adapter_issues : [];
    const applied = applyConfirmedNorthwindCandidates({
      raw: baseRaw,
      candidates: confirmed,
      adapterConflicts: previousAdapterConflicts,
      snapshotId: ingestion.id,
    });
    if (applied.applied.length === 0) {
      return res.status(409).json({ error: 'Bestätigte Kandidaten konnten keiner unterstützten Bridge-Fachregel zugeordnet werden.' });
    }

    const now = new Date().toISOString();
    const evaluation = evaluateRecordWithConflictTruth(
      applied.raw,
      now,
      {
        source: String(ingestion.source_system ?? trace.source.record?.source_system ?? 'northwind-proof'),
        transport: 'file',
        destination: 'petraplan-bridge',
        service: 'northwind-confirmed-candidate-revalidation',
        operation: 'revalidateConfirmedCandidates',
        interactionMode: 'one_way',
        correlationId: `revalidation:${recordId}:${now}`,
        contract: 'order-v1',
        transportStatus: 'received',
      },
      {},
      applied.adapterConflicts,
    );

    const authoritative = trace.validation.authoritative;
    if (!authoritative?.conflict_id || !authoritative?.resolution_record_id) {
      return res.status(409).json({ error: 'Keine bestehende Truth-Chain-Auflösung für die Neuvalidierung gefunden.' });
    }

    const validation = await one<any>(
      supabase.from('validation_results').insert({
        conflict_id: authoritative.conflict_id,
        resolution_record_id: authoritative.resolution_record_id,
        validation_type: 'business_rule',
        status: evaluation.release.releaseAllowed ? 'passed' : 'failed',
        reason: evaluation.release.reason,
        evidence: {
          revalidation: true,
          source_mode: 'northwind-proof',
          source_hash: ingestion.source_hash,
          source_snapshot_id: ingestion.id,
          source_snapshot_unchanged: true,
          confirmed_candidate_decisions: applied.applied,
          contract: evaluation.contract.name,
          bridge_state: evaluation.state,
          constraints: evaluation.constraints,
          mapped_payload: evaluation.mapped,
          bridge_input_raw: applied.raw,
          adapter_conflicts: evaluation.adapterConflicts ?? [],
          trace: evaluation.trace,
          report: evaluation.report,
        },
      }).select('*').single(),
    );
    if (!validation) throw new Error('Revalidation result was not created');

    const blocking = evaluation.constraints.filter((item: any) => item.severity === 'blocking' && !item.passed);
    const affectedFields = [...new Set(blocking.map((item: any) => String(item.field ?? item.id)))];
    const { error: conflictUpdateError } = await supabase
      .from('conflicts')
      .update({
        status: evaluation.release.releaseAllowed ? 'resolved' : 'warning',
        conflict: !evaluation.release.releaseAllowed,
        reason: evaluation.release.reason,
        affected_fields: affectedFields.length ? affectedFields : ['BRIDGE'],
        resolution_status: evaluation.release.releaseAllowed ? 'resolved' : 'review_required',
        resolution_note: evaluation.release.releaseAllowed
          ? 'Bestätigte Fachentscheidungen wurden in einem neuen Bridge-Lauf angewendet; die unveränderte Source wurde erfolgreich neu validiert.'
          : 'Neuvalidierung mit bestätigten Fachentscheidungen bleibt blockiert.',
      })
      .eq('id', authoritative.conflict_id);
    if (conflictUpdateError) throw conflictUpdateError;

    const reconciliation = await reconcileReleaseGate({
      supabase,
      recordId,
      actorUserId: userData.user.id,
      triggerValidationId: validation.id,
    });

    return res.status(200).json({
      trace: await getCaseTrace(supabase, recordId),
      validation_id: validation.id,
      applied_candidates: applied.applied,
      release_allowed: evaluation.release.releaseAllowed,
      release_reconciliation: reconciliation,
    });
  } catch (error) {
    console.error('PetraPlan candidate revalidation failed:', error);
    return res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown revalidation error' });
  }
}
