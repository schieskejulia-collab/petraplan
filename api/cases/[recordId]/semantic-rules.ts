import { createClient } from '@supabase/supabase-js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
async function read(query: any): Promise<any> {
  const { data, error } = await query;
  if (error) throw error;
  return data;
}

export async function handleSemanticRules(req: any, res: any, dependencies = { createClient }) {
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
      const [versions, authorities] = await Promise.all([
        read(db.from('semantic_rule_versions').select('*').eq('record_id', recordId).order('proposed_at')),
        read(db.from('semantic_rule_authorities').select('*').eq('record_id', recordId)),
      ]);
      const ids = (versions ?? []).map((rule: any) => rule.id);
      const authorityIds = (authorities ?? []).map((grant: any) => grant.id);
      const [decisions, revocations] = await Promise.all([
        ids.length ? read(db.from('semantic_rule_decisions').select('*').in('rule_version_id', ids).order('sequence')) : [],
        authorityIds.length ? read(db.from('semantic_rule_authority_revocations').select('authority_id').in('authority_id', authorityIds)) : [],
      ]);
      const now = Date.now();
      return res.status(200).json({
        rules: (versions ?? []).map((rule: any) => {
          const history = (decisions ?? []).filter((decision: any) => decision.rule_version_id === rule.id).map((decision: any) => {
            const grant = (authorities ?? []).find((item: any) => item.id === decision.authority_id);
            return { ...decision, authority_role: grant?.role_name ?? null, authority_reference: grant?.authority_reference ?? null };
          });
          const authority = (authorities ?? []).find((grant: any) => grant.user_id === actor && grant.snapshot_id === rule.snapshot_id
            && grant.target_address === rule.target_address && Date.parse(grant.granted_at) <= now
            && Date.parse(grant.valid_until) > now && !(revocations ?? []).some((event: any) => event.authority_id === grant.id));
          return { ...rule, status: history.at(-1)?.decision ?? 'PROPOSED', history,
            decision_authority: authority ?? null, snapshot_current: rule.snapshot_id === record.ingestion_log_id };
        }),
        scope: 'CASE_ONLY',
        claim_confirmation_automatic: false,
      });
    }

    const body = req.body ?? {};
    if (body.action === 'propose') {
      const claimId = String(body.claim_id ?? '');
      const previous = body.previous_version_id == null ? null : String(body.previous_version_id);
      if (!UUID.test(claimId) || (previous !== null && !UUID.test(previous))) return res.status(400).json({ error: 'Invalid Claim or previous version ID' });
      const definition = body.definition;
      if (!definition || typeof definition !== 'object' || Array.isArray(definition)
        || !['question', 'condition', 'conclusion', 'justification'].every(field => typeof definition[field] === 'string' && definition[field].trim().length >= 8)
        || !['evidence', 'limitations', 'exceptions', 'unresolved_items'].every(field => Array.isArray(definition[field]))) {
        return res.status(400).json({ error: 'Frage, Bedingung, Schlussfolgerung und Begründung sowie Belege und Grenzen sind erforderlich.' });
      }
      const rule = await read(db.rpc('bridge_propose_semantic_rule', {
        p_record_id: recordId, p_claim_id: claimId, p_actor_id: actor,
        p_definition: definition, p_previous_version_id: previous,
      }));
      return res.status(201).json({ rule });
    }

    const actions: Record<string, string> = { approve: 'APPROVED', reject: 'REJECTED', revoke: 'REVOKED', supersede: 'SUPERSEDED' };
    if (!Object.hasOwn(actions, body.action)) return res.status(400).json({ error: 'Unsupported rule action' });
    const versionId = String(body.rule_version_id ?? ''), authorityId = String(body.authority_id ?? '');
    if (!UUID.test(versionId) || !UUID.test(authorityId)) return res.status(400).json({ error: 'Rule version and documented scope authority are required' });
    const reason = String(body.reason ?? '').trim();
    if (reason.length < 8) return res.status(400).json({ error: 'Bitte die fachliche Entscheidung begründen.' });
    const decision = await read(db.rpc('bridge_decide_semantic_rule', {
      p_record_id: recordId, p_version_id: versionId, p_actor_id: actor,
      p_authority_id: authorityId, p_decision: actions[body.action], p_reason: reason,
      p_criteria: body.criteria ?? {},
    }));
    return res.status(200).json({ decision });
  } catch (error: any) {
    const code = String(error?.code ?? '');
    if (['PT400', 'PT403', 'PT404', 'PT409'].includes(code)) return res.status(Number(code.slice(2))).json({ error: error.message });
    if (['PGRST202', 'PGRST205', '42P01', '42883'].includes(code)) {
      return res.status(503).json({ error: 'Der Regelkatalog ist in dieser Datenbank noch nicht eingerichtet.' });
    }
    if (['23502', '23514', '22P02'].includes(code)) return res.status(400).json({ error: 'Regelvorschlag oder Entscheidungsdaten sind unvollständig oder ungültig.' });
    if (code === '23505') return res.status(409).json({ error: 'Diese Regelversion existiert bereits. Bitte neu laden.' });
    console.error('Semantic rule governance failed:', error);
    return res.status(500).json({ error: 'Regelentscheidung konnte nicht gespeichert werden.' });
  }
}

export default async function handler(req: any, res: any) {
  return handleSemanticRules(req, res);
}
