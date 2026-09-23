import { createClient } from '@supabase/supabase-js';
import { listCases } from '../../api-server/src/services/caseList.js';

function bearerToken(req: any): string | null {
  const header = String(req.headers?.authorization ?? '');
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

export default async function handler(req: any, res: any) {
  try {
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      return res.status(405).json({ error: 'Method not allowed' });
    }

    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseSecretKey) {
      console.error('PetraPlan /api/cases server configuration incomplete');
      return res.status(500).json({ error: 'Server configuration incomplete' });
    }

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(supabaseUrl);
    } catch {
      console.error('PetraPlan /api/cases SUPABASE_URL is invalid');
      return res.status(500).json({ error: 'Server configuration invalid' });
    }

    if (parsedUrl.protocol !== 'https:') {
      console.error('PetraPlan /api/cases SUPABASE_URL must use https');
      return res.status(500).json({ error: 'Server configuration invalid' });
    }

    const token = bearerToken(req);
    if (!token) return res.status(401).json({ error: 'Authentication required' });

    const supabase = createClient(supabaseUrl, supabaseSecretKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: authData, error: authError } = await supabase.auth.getUser(token);
    if (authError || !authData.user) {
      return res.status(401).json({ error: 'Invalid or expired authentication' });
    }

    const rawLimit = Number(req.query?.limit ?? 20);
    const rawOffset = Number(req.query?.offset ?? 0);
    const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(Math.floor(rawLimit), 1), 50) : 20;
    const offset = Number.isFinite(rawOffset) ? Math.max(Math.floor(rawOffset), 0) : 0;

    const items = await listCases(supabase, limit, offset);
    return res.status(200).json({ items, limit, offset });
  } catch (error) {
    console.error('PetraPlan /api/cases failed:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
