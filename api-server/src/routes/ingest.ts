import express from 'express';
import { createClient } from '@supabase/supabase-js';
import { parseLegacyText } from '../services/aiParser.js';

const router = express.Router();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceRoleKey) {
  throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
}

const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

const typeMapping: Record<string, string> = {
  DECIMAL: 'numeric',
  NUMERIC: 'numeric',
  INTEGER: 'integer',
  INT: 'integer',
  TIMESTAMP: 'timestamp',
  TIMESTAMPTZ: 'timestamptz',
  DATE: 'date',
  BOOLEAN: 'boolean',
  CHAR: 'text',
  VARCHAR: 'text',
  STRING: 'text',
  NUMC: 'text',
};

function normalizeNumeric(value: unknown): number {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`Invalid numeric value: ${value}`);
    return value;
  }

  if (typeof value !== 'string') throw new Error(`Invalid numeric value: ${String(value)}`);

  const input = value.trim();
  if (!input) throw new Error('Invalid numeric value: empty string');

  const hasComma = input.includes(',');
  const hasDot = input.includes('.');

  if (hasComma && hasDot) {
    const normalized = input.replace(/\./g, '').replace(',', '.');
    const result = Number(normalized);
    if (!Number.isFinite(result)) throw new Error(`Invalid numeric value: ${value}`);
    return result;
  }

  if (hasComma) {
    const result = Number(input.replace(',', '.'));
    if (!Number.isFinite(result)) throw new Error(`Invalid numeric value: ${value}`);
    return result;
  }

  if (hasDot && /^[-+]?\d{1,3}(\.\d{3})+$/.test(input)) {
    throw new Error(`ambiguous_numeric_format: ${value}`);
  }

  const result = Number(input);
  if (!Number.isFinite(result)) throw new Error(`Invalid numeric value: ${value}`);
  return result;
}

function normalizeInteger(value: unknown): number {
  const result = normalizeNumeric(value);
  if (!Number.isInteger(result)) throw new Error(`Invalid integer value: ${String(value)}`);
  return result;
}

function normalizeBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  const normalized = String(value).trim().toLowerCase();
  if (['true', '1', 'x', 'yes'].includes(normalized)) return true;
  if (['false', '0', '', 'no'].includes(normalized)) return false;
  throw new Error(`ambiguous_boolean_value: ${String(value)}`);
}

function normalizeDate(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
    throw new Error(`Invalid date value: ${String(value)}`);
  }
  return value.trim();
}

function normalizeTimestamp(value: unknown, withTimezone: boolean): string {
  if (typeof value !== 'string') throw new Error(`Invalid timestamp value: ${String(value)}`);
  const input = value.trim();

  if (withTimezone) {
    if (!/(Z|[+-]\d{2}:?\d{2})$/i.test(input)) {
      throw new Error(`ambiguous_timestamp_timezone: ${value}`);
    }
    const date = new Date(input);
    if (Number.isNaN(date.getTime())) throw new Error(`Invalid timestamp value: ${value}`);
    return date.toISOString();
  }

  if (!/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d+)?$/.test(input)) {
    throw new Error(`Invalid timestamp value: ${value}`);
  }
  return input.replace(' ', 'T');
}

function transformValue(value: unknown, legacyType?: string): unknown {
  if (value === null || value === undefined) return null;

  const targetType = typeMapping[String(legacyType ?? '').toUpperCase()];

  switch (targetType) {
    case 'numeric': return normalizeNumeric(value);
    case 'integer': return normalizeInteger(value);
    case 'boolean': return normalizeBoolean(value);
    case 'date': return normalizeDate(value);
    case 'timestamp': return normalizeTimestamp(value, false);
    case 'timestamptz': return normalizeTimestamp(value, true);
    default: return value;
  }
}

function transformPayload(
  rawPayload: Record<string, unknown>,
  fieldMapping: Record<string, string>,
  fieldTypes: Record<string, string>,
): Record<string, unknown> {
  const mappedPayload: Record<string, unknown> = {};

  for (const [legacyField, value] of Object.entries(rawPayload)) {
    const modernField = fieldMapping[legacyField] ?? legacyField.toLowerCase();
    mappedPayload[modernField] = transformValue(value, fieldTypes[legacyField]);
  }

  return mappedPayload;
}

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
