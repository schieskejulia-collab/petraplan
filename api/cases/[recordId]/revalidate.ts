import { createClient } from '@supabase/supabase-js';
import { getCaseTrace } from '../../../api-server/src/services/caseTrace.js';
import { revalidationEvidenceBlockers } from '../../../api-server/src/services/revalidationEvidence.js';

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

export async function handleRevalidation(req: any, res: any, dependencies = { createClient, getCaseTrace }) {
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

    const role = await one<any>(
      supabase.from('bridge_actor_roles').select('*').eq('user_id', userData.user.id).eq('active', true).maybeSingle(),
    );
    if (!role?.can_review) return res.status(403).json({ error: 'Review permission required' });

    const trace: any = await dependencies.getCaseTrace(supabase, recordId);
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

    const claims = await many<any>(
      supabase.from('claims').select('*').eq('record_id', recordId),
    );
    const blockers = revalidationEvidenceBlockers({
      recordId, snapshotId: ingestion.id, candidates: confirmed, claims,
    });

    // No mutation: a new passing validation must not be manufactured from
    // candidate confirmation while the semantic authority verifier is absent.
    return res.status(409).json({
      error: `Die fachliche Belegprüfung ist noch offen. ${[...new Set(blockers.map(blocker => blocker.reason))].join(' ')}`,
      code: 'SEMANTIC_EVIDENCE_REQUIRED',
      evidence_state: 'UNKNOWN',
      blockers,
    });
  } catch (error) {
    console.error('PetraPlan candidate revalidation failed:', error);
    return res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown revalidation error' });
  }
}

export default async function handler(req: any, res: any) {
  return handleRevalidation(req, res);
}
