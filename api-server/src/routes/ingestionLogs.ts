import express from 'express';
import { createClient } from '@supabase/supabase-js';

const router = express.Router();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const reviewToken = process.env.N64_REVIEW_TOKEN;

if (!supabaseUrl || !supabaseServiceRoleKey) {
  throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
}

const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

function requireReviewAccess(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (!reviewToken) {
    return res.status(503).json({
      error: 'Review API is disabled until N64_REVIEW_TOKEN is configured',
    });
  }

  const authorization = req.header('authorization');
  if (authorization !== `Bearer ${reviewToken}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  next();
}

function parseLimit(value: unknown): number {
  if (typeof value !== 'string') return 25;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return 25;
  return Math.min(Math.max(parsed, 1), 100);
}

router.get('/api/ingestion-logs', requireReviewAccess, async (req, res) => {
  const status = typeof req.query.status === 'string' ? req.query.status : undefined;
  const limit = parseLimit(req.query.limit);

  if (status && !['pending', 'processed', 'error'].includes(status)) {
    return res.status(400).json({ error: 'status must be pending, processed, or error' });
  }

  let query = supabase
    .from('ingestion_logs')
    .select('id, source_system, status, error_message, created_at, extracted_schema')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (status) query = query.eq('status', status);

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });

  const items = (data ?? []).map((row) => {
    const extracted = row.extracted_schema && typeof row.extracted_schema === 'object'
      ? row.extracted_schema as Record<string, unknown>
      : {};

    return {
      id: row.id,
      source_system: row.source_system,
      status: row.status,
      error_message: row.error_message,
      created_at: row.created_at,
      review_required: extracted.review_required === true,
      warnings: Array.isArray(extracted.warnings) ? extracted.warnings : [],
      field_mapping: extracted.fieldMapping ?? {},
      field_types: extracted.field_types ?? {},
      schema_sql: typeof extracted.schema_sql === 'string' ? extracted.schema_sql : '',
      core_queries: Array.isArray(extracted.core_queries) ? extracted.core_queries : [],
      business_rules: Array.isArray(extracted.business_rules) ? extracted.business_rules : [],
      evidence: Array.isArray(extracted.evidence) ? extracted.evidence : [],
    };
  });

  return res.json({ items, count: items.length });
});

router.get('/api/ingestion-logs/:id', requireReviewAccess, async (req, res) => {
  const { data, error } = await supabase
    .from('ingestion_logs')
    .select('id, source_system, raw_payload, extracted_schema, status, error_message, created_at')
    .eq('id', req.params.id)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return res.status(404).json({ error: 'Ingestion log not found' });
    return res.status(500).json({ error: error.message });
  }

  return res.json(data);
});

export default router;
