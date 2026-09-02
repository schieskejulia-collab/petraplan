import express from 'express';
import { createClient } from '@supabase/supabase-js';
import { getCaseTrace, listCases } from '../services/caseTrace.js';

const router = express.Router();

const supabaseUrl = process.env.SUPABASE_URL || 'https://localhost:54321';
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'stub-key-for-smoke-testing';

// Only require real Supabase credentials if not in smoke test mode
if (process.env.IDEMPOTENCY_SMOKE_ENABLED !== 'true') {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  }
}

const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

router.get('/api/cases', async (req, res) => {
  const rawLimit = Number(req.query.limit ?? 20);
  const rawOffset = Number(req.query.offset ?? 0);
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(Math.floor(rawLimit), 1), 50) : 20;
  const offset = Number.isFinite(rawOffset) ? Math.max(Math.floor(rawOffset), 0) : 0;

  try {
    const items = await listCases(supabase, limit, offset);
    return res.json({ items, limit, offset });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown case list error';
    return res.status(500).json({ error: message });
  }
});

router.get('/api/cases/:recordId', async (req, res) => {
  const { recordId } = req.params;

  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(recordId)) {
    return res.status(400).json({ error: 'recordId must be a UUID' });
  }

  try {
    const trace = await getCaseTrace(supabase, recordId);
    if (!trace) return res.status(404).json({ error: 'Case not found' });
    return res.json(trace);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown case trace error';
    return res.status(500).json({ error: message });
  }
});

export default router;
