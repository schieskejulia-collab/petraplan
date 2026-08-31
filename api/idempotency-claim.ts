import { createClient } from '@supabase/supabase-js';
import { claimIdempotentExecution } from '../api-server/src/services/idempotencyClaim.js';

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // This endpoint only exercises the database claim. It must never trigger an
  // external/legacy side effect and is disabled unless explicitly enabled.
  if (process.env.IDEMPOTENCY_SMOKE_ENABLED !== 'true') {
    return res.status(404).json({ error: 'Not found' });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseSecretKey) {
    return res.status(500).json({ error: 'Server configuration incomplete' });
  }

  const intentId = String(req.headers['x-intent-id'] ?? '').trim();
  const operation = String(req.headers['x-operation'] ?? 'idempotency-smoke').trim();
  const expiresAt = String(req.headers['x-test-expires-at'] ?? '').trim();

  if (!intentId) return res.status(400).json({ error: 'x-intent-id is required' });
  if (!operation) return res.status(400).json({ error: 'x-operation is required' });
  if (!expiresAt) return res.status(400).json({ error: 'x-test-expires-at is required' });

  try {
    const supabase = createClient(supabaseUrl, supabaseSecretKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const result = await claimIdempotentExecution(supabase, {
      intent_id: intentId,
      operation,
      expires_at: expiresAt,
    });

    // No side effect is performed here. The response exists only so the runtime
    // smoke harness can prove whether all duplicate deliveries converge on one
    // logical execution identity.
    return res.status(result.claimed ? 201 : 200).json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown idempotency claim error';
    console.error('PetraPlan /api/idempotency-claim failed:', error);
    return res.status(503).json({ error: message });
  }
}
