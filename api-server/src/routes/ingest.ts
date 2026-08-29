import express from 'express';
import { createClient } from '@supabase/supabase-js';
import { parseLegacyText } from '../services/aiParser.js';
import { transformPayload } from '../services/transform.js';

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

  let analysis: Awaited<ReturnType<typeof parseLegacyText>> | null = null;

  try {
    analysis = await parseLegacyText(legacyText);
    const mappedPayload = transformPayload(rawPayload, analysis.fieldMapping, analysis.field_types);

    const extractedSchema = {
      ...analysis,
      mapped_payload: mappedPayload,
      review_required: true,
    };

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
      extractedSchema: analysis ? { ...analysis } : {},
      errorMessage,
    });

    return res.status(500).json({ error: errorMessage });
  }
});

export default router;
