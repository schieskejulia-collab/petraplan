import { createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import {
  evaluateRecord,
  parseRawRecord,
  type IngressContext,
  type ResponseContext,
} from '../../frontend/mobile-app/src/lib/bridge-pipeline.js';
import { getPinnedNorthwindOrder } from '../../api-server/src/services/pinnedNorthwind.js';
import { buildAddressableNorthwindSnapshot } from '../../api-server/src/services/addressableNorthwind.js';

function authToken(req: any) {
  const header = String(req.headers?.authorization ?? '');
  return header.startsWith('Bearer ') ? header.slice(7).trim() : '';
}

async function one<T>(promise: any): Promise<T | null> {
  const { data, error } = await promise;
  if (error) throw error;
  return (data ?? null) as T | null;
}

function sourceHash(value: unknown) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function objectOrEmpty(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export default async function handler(req: any, res: any) {
  try {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return res.status(405).json({ error: 'Method not allowed' });
    }

    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !supabaseSecretKey) {
      return res.status(500).json({ error: 'Server configuration incomplete' });
    }

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
    if (!role) return res.status(403).json({ error: 'No active Bridge role' });

    const capturedAt = typeof req.body?.captured_at === 'string' && req.body.captured_at
      ? req.body.captured_at
      : new Date().toISOString();

    let raw: any;
    let evaluation: any;
    let sourcePayload: unknown;
    let sourceSystem: string;
    let sourceReference: string;
    let defaultTitle: string;
    let sourceMode: 'manual' | 'northwind-proof' = 'manual';
    let adapterMetadata: Record<string, unknown> = {};

    if (req.body?.northwind_order_id != null) {
      const orderId = Number(req.body.northwind_order_id);
      if (!Number.isInteger(orderId)) return res.status(400).json({ error: 'Invalid northwind_order_id' });
      const northwind = await getPinnedNorthwindOrder(orderId, capturedAt);
      if (!northwind) return res.status(404).json({ error: 'Pinned Northwind order not found' });
      if (!northwind.evaluation || !northwind.adaptation || northwind.sourceSchemaGate !== 'ACCEPTED') {
        return res.status(422).json({ error: 'Northwind source schema gate blocked this order', details: northwind.sourceSchemaIssues });
      }
      raw = northwind.adaptation.raw;
      evaluation = northwind.evaluation;
      sourcePayload = northwind.envelope;
      sourceSystem = northwind.envelope.source;
      sourceReference = `A-${orderId}`;
      defaultTitle = `${sourceReference} · ${northwind.envelope.customer.CompanyName}`;
      sourceMode = 'northwind-proof';
      adapterMetadata = {
        source_schema_gate: northwind.sourceSchemaGate,
        source_schema_issues: northwind.sourceSchemaIssues,
        adapter_issues: northwind.adaptation.issues,
        adapter_evidence: northwind.adaptation.evidence,
        bridge_input_raw: northwind.adaptation.raw,
        addressable_snapshot: buildAddressableNorthwindSnapshot({
          orderId,
          envelope: northwind.envelope,
          adaptation: northwind.adaptation,
          capturedAt,
        }),
      };
    } else {
      raw = parseRawRecord(req.body?.raw_record);
      const ingressOverrides = objectOrEmpty(req.body?.ingress) as Partial<IngressContext>;
      const responseOverrides = objectOrEmpty(req.body?.response) as Partial<ResponseContext>;
      evaluation = evaluateRecord(raw, capturedAt, ingressOverrides, responseOverrides);
      sourcePayload = raw;
      sourceSystem = String(evaluation.ingress.source || 'petraplan-translator');
      sourceReference = String(raw.AUFTRAGS_NR || evaluation.snapshot.sourceRecord || sourceHash(raw).slice(0, 12));
      defaultTitle = `Auftrag ${sourceReference}`;
    }

    const hash = sourceHash(sourcePayload);
    const extractedSchema = {
      source_mode: sourceMode,
      ...adapterMetadata,
      contract: evaluation.contract,
      mapped_payload: evaluation.mapped,
      schema_checks: evaluation.schema,
      semantic_entries: evaluation.semantics,
      field_map: evaluation.fieldMap,
      value_map: evaluation.valueMap,
      transformations: evaluation.transformations,
      canonical_mapping: evaluation.canonicalMapping,
      checks: evaluation.checks,
      constraints: evaluation.constraints,
      bridge_state: evaluation.state,
      bridge_trace: evaluation.trace,
      bridge_report: evaluation.report,
      release_decision: evaluation.release,
      provenance: evaluation.provenance,
      review_required: true,
    };

    const ingestion = await one<any>(
      supabase.from('ingestion_logs').insert({
        source_system: sourceSystem,
        source_reference: sourceReference,
        source_hash: hash,
        raw_payload: sourcePayload,
        extracted_schema: extractedSchema,
        status: 'processed',
        ingested_at: capturedAt,
      }).select('*').single(),
    );
    if (!ingestion) throw new Error('Ingestion row was not created');

    const record = await one<any>(
      supabase.from('records').insert({
        ingestion_log_id: ingestion.id,
        source_system: sourceSystem,
        source_reference: sourceReference,
        title: String(req.body?.title || defaultTitle),
        description: sourceMode === 'northwind-proof'
          ? 'Pinned Northwind proof order selected and persisted through the live Bridge.'
          : 'Live Bridge evaluation persisted from the translator.',
        category: 'order',
        type: 'bridge_translation',
        metadata: {
          source_mode: sourceMode,
          bridge_state: evaluation.state,
          release_decision: evaluation.release,
          mapped_payload: evaluation.mapped,
          bridge_input_raw: raw,
          provenance: evaluation.provenance,
          ...adapterMetadata,
        },
        meaning: `Order data evaluated against ${evaluation.contract.name}.`,
        status: evaluation.release.releaseAllowed ? 'valid' : 'warning',
      }).select('*').single(),
    );
    if (!record) throw new Error('Case record was not created');

    const blocking = evaluation.constraints.filter((item: any) => item.severity === 'blocking' && !item.passed);
    const warning = evaluation.constraints.filter((item: any) => item.severity === 'warning' && !item.passed);
    const affectedFields = [...new Set([
      ...evaluation.issues.filter((item: any) => item.severity === 'blocking').map((item: any) => String(item.field)),
      ...blocking.map((item: any) => String(item.field ?? item.id)),
    ])];

    const evaluationAnchor = await one<any>(
      supabase.from('conflicts').insert({
        record_id: record.id,
        status: evaluation.release.releaseAllowed ? 'resolved' : 'warning',
        conflict: !evaluation.release.releaseAllowed,
        conflict_type: evaluation.release.releaseAllowed ? 'bridge_validation_anchor' : 'bridge_constraint_failure',
        reason: evaluation.release.reason,
        affected_fields: affectedFields.length ? affectedFields : ['BRIDGE'],
        possible_match: false,
        automatic_merge: false,
        resolution_status: evaluation.release.releaseAllowed ? 'resolved' : 'review_required',
        resolution_note: evaluation.release.releaseAllowed ? 'Bridge constraints passed; human release review still required.' : null,
      }).select('*').single(),
    );
    if (!evaluationAnchor) throw new Error('Bridge evaluation anchor was not created');

    const action = await one<any>(
      supabase.from('resolution_actions').insert({
        conflict_id: evaluationAnchor.id,
        action_type: 'suggest',
        action_payload: {
          source_mode: sourceMode,
          bridge_state: evaluation.state,
          release_decision: evaluation.release,
          blockers: blocking,
          warnings: warning,
          adapter_issues: (evaluation.adapterConflicts ?? []),
        },
        actor_type: 'system',
        actor_id: 'petraplan-live-translator',
        reason: 'Persist the translator result without changing Source Truth or inventing semantic mappings.',
      }).select('*').single(),
    );
    if (!action) throw new Error('Resolution action was not created');

    const resolution = await one<any>(
      supabase.from('resolution_records').insert({
        conflict_id: evaluationAnchor.id,
        resolution_action_id: action.id,
        decision: 'unresolved',
        resolution_reason: evaluation.release.releaseAllowed
          ? 'Technical Bridge checks pass; final release remains a human authorized decision.'
          : evaluation.release.reason,
        resolved_by_type: 'system',
        resolved_by: 'petraplan-live-translator',
        previous_status: 'warning',
        new_status: 'suggested',
        verified_at: capturedAt,
      }).select('*').single(),
    );
    if (!resolution) throw new Error('Resolution record was not created');

    const validation = await one<any>(
      supabase.from('validation_results').insert({
        conflict_id: evaluationAnchor.id,
        resolution_record_id: resolution.id,
        validation_type: 'business_rule',
        status: evaluation.release.releaseAllowed ? 'passed' : 'failed',
        reason: evaluation.release.reason,
        evidence: {
          source_mode: sourceMode,
          source_hash: hash,
          source_snapshot_id: evaluation.snapshot.id,
          contract: evaluation.contract.name,
          bridge_state: evaluation.state,
          constraints: evaluation.constraints,
          mapped_payload: evaluation.mapped,
          bridge_input_raw: raw,
          adapter_conflicts: evaluation.adapterConflicts ?? [],
          trace: evaluation.trace,
          report: evaluation.report,
        },
      }).select('*').single(),
    );
    if (!validation) throw new Error('Validation result was not created');

    return res.status(201).json({
      record_id: record.id,
      ingestion_id: ingestion.id,
      validation_id: validation.id,
      source_mode: sourceMode,
      release_allowed: evaluation.release.releaseAllowed,
      bridge_state: evaluation.state,
      open_points: evaluation.report.openPoints,
      errors: evaluation.report.errors,
    });
  } catch (error) {
    console.error('PetraPlan translator ingestion failed:', error);
    return res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown translator ingestion error' });
  }
}
