import express from 'express';
import { createClient } from '@supabase/supabase-js';
import { parseLegacyText } from '../services/aiParser.js';
import { runIngestionPipeline } from '../services/ingestionPipeline.js';

const router = express.Router();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceRoleKey) {
  throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
}

const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

async function writeErrorLog(params: {
  sourceSystem: string;
  rawPayload: Record<string, unknown>;
  extractedSchema: Record<string, unknown>;
  errorMessage: string;
}) {
  const { error } = await supabase.from('ingestion_logs').insert({
    source_system: params.sourceSystem,
    raw_payload: params.rawPayload,
    extracted_schema: params.extractedSchema,
    status: 'error',
    error_message: params.errorMessage,
  });

  if (error) console.error('Failed to write ingestion error log:', error.message);
}

router.get('/api/ingestions', async (req, res) => {
  const rawLimit = Number(req.query.limit ?? 25);
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(Math.trunc(rawLimit), 1), 100) : 25;

  const { data, error } = await supabase
    .from('ingestion_logs')
    .select('id, source_system, status, error_message, created_at, extracted_schema')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) return res.status(500).json({ error: error.message });

  return res.json({ items: data ?? [] });
});

router.get('/api/ingestions/:id', async (req, res) => {
  const id = req.params.id;

  const { data, error } = await supabase
    .from('ingestion_logs')
    .select('id, source_system, status, error_message, created_at, raw_payload, extracted_schema')
    .eq('id', id)
    .maybeSingle();

  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Ingestion log not found' });

  return res.json(data);
});

router.post('/api/ingest', async (req, res) => {
  const {
    source_system: sourceSystem,
    raw_payload: rawPayload,
    legacy_text: legacyText,
  } = req.body ?? {};

  if (typeof sourceSystem !== 'string' || !sourceSystem.trim()) {
    return res.status(400).json({ error: 'source_system is required' });
  }

  if (!rawPayload || typeof rawPayload !== 'object' || Array.isArray(rawPayload)) {
    return res.status(400).json({ error: 'raw_payload must be a JSON object' });
  }

  if (typeof legacyText !== 'string' || !legacyText.trim()) {
    return res.status(400).json({ error: 'legacy_text is required for AI-driven field mapping' });
  }

  let extractedSchema: Record<string, unknown> = {};

  try {
    const pipeline = await runIngestionPipeline({
      legacyText,
      rawPayload,
      analyze: parseLegacyText,
    });

    extractedSchema = pipeline.extractedSchema;

    const { data, error } = await supabase
      .from('ingestion_logs')
      .insert({
        source_system: sourceSystem.trim(),
        raw_payload: rawPayload,
        extracted_schema: extractedSchema,
        status: 'processed',
      })
      .select('id, status, created_at')
      .single();

    if (error) throw error;

    return res.status(201).json({ ...data, review_required: true });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown ingestion error';

    await writeErrorLog({
      sourceSystem: sourceSystem.trim(),
      rawPayload,
      extractedSchema,
      errorMessage,
    });

    return res.status(500).json({ error: errorMessage });
  }
});

export default router;
