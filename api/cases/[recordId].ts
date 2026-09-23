import { getCaseTrace } from '../../api-server/src/services/caseTrace.js';
import { requireBridgeRole } from '../_lib/auth.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
    return res.status(200).json(trace);
  } catch (error) {
    console.error('PetraPlan /api/cases/:recordId failed:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
