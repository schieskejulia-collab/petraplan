import { listCases } from '../../api-server/src/services/caseList.js';
import { requireBridgeRole } from '../_lib/auth.js';

export default async function handler(req: any, res: any) {
  try {
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      return res.status(405).json({ error: 'Method not allowed' });
    }

    const ctx = await requireBridgeRole(req, res);
    if (!ctx) return;

    const rawLimit = Number(req.query?.limit ?? 20);
    const rawOffset = Number(req.query?.offset ?? 0);
    const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(Math.floor(rawLimit), 1), 50) : 20;
    const offset = Number.isFinite(rawOffset) ? Math.max(Math.floor(rawOffset), 0) : 0;

    const items = await listCases(ctx.supabase, limit, offset);
    return res.status(200).json({ items, limit, offset });
  } catch (error) {
    console.error('PetraPlan /api/cases failed:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
