import { createClient } from '@supabase/supabase-js';
import { getCaseTrace } from '../../api-server/src/services/caseTrace';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default async function handler(req: any, res: any) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const recordId = String(req.query?.recordId ?? '');
  if (!UUID_RE.test(recordId)) {
    return res.status(400).json({ error: 'recordId must be a UUID' });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceRoleKey) {
    return res.status(500).json({ error: 'Server configuration incomplete' });
  }

  const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    const trace = await getCaseTrace(supabase, recordId);
    if (!trace) return res.status(404).json({ error: 'Case not found' });
    return res.status(200).json(trace);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown case trace error';
    return res.status(500).json({ error: message });
  }
}
