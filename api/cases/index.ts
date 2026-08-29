import { createClient } from '@supabase/supabase-js';
import { listCases } from '../../api-server/src/services/caseTrace';

export default async function handler(req: any, res: any) {
  try {
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      return res.status(405).json({ error: 'Method not allowed' });
    }

    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseSecretKey) {
      return res.status(500).json({
        error: 'Server configuration incomplete',
        missing: {
          SUPABASE_URL: !supabaseUrl,
          SUPABASE_SECRET_KEY: !supabaseSecretKey,
        },
      });
    }

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(supabaseUrl);
    } catch {
      return res.status(500).json({ error: 'SUPABASE_URL is not a valid absolute URL' });
    }

    if (parsedUrl.protocol !== 'https:') {
      return res.status(500).json({ error: 'SUPABASE_URL must use https' });
    }

    const supabase = createClient(supabaseUrl, supabaseSecretKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const rawLimit = Number(req.query?.limit ?? 20);
    const rawOffset = Number(req.query?.offset ?? 0);
    const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(Math.floor(rawLimit), 1), 50) : 20;
    const offset = Number.isFinite(rawOffset) ? Math.max(Math.floor(rawOffset), 0) : 0;

    const items = await listCases(supabase, limit, offset);
    return res.status(200).json({ items, limit, offset });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown case list error';
    console.error('PetraPlan /api/cases failed:', error);
    return res.status(500).json({ error: message });
  }
}
