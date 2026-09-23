import { createClient } from '@supabase/supabase-js';
import { getCaseTrace } from '../../api-server/src/services/caseTrace.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

    const recordId = String(req.query?.recordId ?? '');
    if (!UUID_RE.test(recordId)) {
      return res.status(400).json({ error: 'recordId must be a UUID' });
    }

    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseSecretKey) {
      console.error('PetraPlan /api/cases/:recordId server configuration incomplete');
      return res.status(500).json({ error: 'Server configuration incomplete' });
    }

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(supabaseUrl);
    } catch {
      console.error('PetraPlan /api/cases/:recordId SUPABASE_URL is invalid');
      return res.status(500).json({ error: 'Server configuration invalid' });
    }

    if (parsedUrl.protocol !== 'https:') {
      console.error('PetraPlan /api/cases/:recordId SUPABASE_URL must use https');
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

    const trace = await getCaseTrace(supabase, recordId);
    if (!trace) return res.status(404).json({ error: 'Case not found' });
    return res.status(200).json(trace);
  } catch (error) {
    console.error('PetraPlan /api/cases/:recordId failed:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
