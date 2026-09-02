import express from 'express';
import { createClient } from '@supabase/supabase-js';
import { claimIdempotentExecution } from '../services/idempotencyClaim.js';
import { validateIdempotencySmokeRequest } from '../services/idempotencySmoke.js';
import { createMockSupabaseClient } from '../services/mockSupabase.js';

const router = express.Router();

const supabaseUrl = process.env.SUPABASE_URL || 'https://localhost:54321';
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'stub-key-for-smoke-testing';

router.post('/api/idempotency-claim', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');

  // This endpoint only exercises the database claim. It must never trigger an
  // external/legacy side effect and is disabled unless explicitly enabled.
  if (process.env.IDEMPOTENCY_SMOKE_ENABLED !== 'true') {
    return res.status(404).json({ error: 'Not found' });
  }

  if (!supabaseUrl || !supabaseServiceRoleKey) {
    return res.status(500).json({ error: 'Server configuration incomplete' });
  }

  try {
    const smokeRequest = validateIdempotencySmokeRequest({
      intent_id: String(req.headers['x-intent-id'] ?? ''),
      operation: String(req.headers['x-operation'] ?? ''),
      expires_at: String(req.headers['x-test-expires-at'] ?? ''),
    });

    // Use mock client for smoke testing, real client otherwise
    let client;
    if (process.env.IDEMPOTENCY_SMOKE_ENABLED === 'true') {
      client = createMockSupabaseClient();
    } else {
      client = createClient(supabaseUrl, supabaseServiceRoleKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
    }

    const result = await claimIdempotentExecution(client, smokeRequest);

    // No side effect is performed here. The response exists only so the runtime
    // smoke harness can prove whether all duplicate deliveries converge on one
    // logical execution identity.
    return res.status(result.claimed ? 201 : 200).json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown idempotency claim error';

    if (
      message.includes('test namespace') ||
      message.includes('operation must be') ||
      message.includes('expires_at must be')
    ) {
      return res.status(400).json({ error: message });
    }

    console.error('PetraPlan /api/idempotency-claim failed:', error);
    return res.status(503).json({ error: message });
  }
});

export default router;
