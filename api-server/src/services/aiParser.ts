import OpenAI from 'openai';

export type LegacyAnalysis = {
  fieldMapping: Record<string, string>;
  field_types: Record<string, string>;
  schema_sql: string[];
  core_queries: string[];
  business_rules: string[];
  evidence: string[];
  warnings: string[];
};

const SYSTEM_PROMPT = `
Du bist die Kern-Analyse-Engine von Mila für Legacy-Systeme.

Ziel: Extrahiere nur nachweisbare Datenbank- und Geschäftslogik aus dem übergebenen Legacy-Text.
Ignoriere reine UI-/Layout-Details und Framework-Overhead, aber ignoriere niemals fachliche Regeln,
Berechtigungslogik, Statusübergänge, Constraints oder Datenabhängigkeiten, nur weil sie im Anwendungscode stehen.

Regeln:
- Erfinde keine Felder, Datentypen, Beziehungen oder Geschäftsregeln.
- Wenn etwas nicht eindeutig ableitbar ist, trage es in warnings ein.
- schema_sql ist ausschließlich ein nicht-ausführbarer Vorschlag zur späteren menschlichen Prüfung.
- evidence enthält kurze Hinweise darauf, aus welcher expliziten Information die Analyse abgeleitet wurde.
- Gib ausschließlich valides JSON im vorgegebenen Schema zurück.
`;

const responseSchema = {
  name: 'legacy_schema_analysis',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: [
      'fieldMapping',
      'field_types',
      'schema_sql',
      'core_queries',
      'business_rules',
      'evidence',
      'warnings',
    ],
    properties: {
      fieldMapping: {
        type: 'object',
        additionalProperties: { type: 'string' },
      },
      field_types: {
        type: 'object',
        additionalProperties: { type: 'string' },
      },
      schema_sql: { type: 'array', items: { type: 'string' } },
      core_queries: { type: 'array', items: { type: 'string' } },
      business_rules: { type: 'array', items: { type: 'string' } },
      evidence: { type: 'array', items: { type: 'string' } },
      warnings: { type: 'array', items: { type: 'string' } },
    },
  },
};

let client: OpenAI | null = null;

function getOpenAI(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY is required');
  client ??= new OpenAI({ apiKey });
  return client;
}

export async function parseLegacyText(legacyText: string): Promise<LegacyAnalysis> {
  if (typeof legacyText !== 'string' || legacyText.trim().length === 0) {
    throw new Error('legacy_text must be a non-empty string');
  }

  const completion = await getOpenAI().chat.completions.create({
    model: process.env.OPENAI_MODEL ?? 'gpt-4.1-mini',
    response_format: {
      type: 'json_schema',
      json_schema: responseSchema,
    },
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: legacyText },
    ],
  });

  const content = completion.choices[0]?.message?.content;
  if (!content) throw new Error('AI parser returned no content');

  return JSON.parse(content) as LegacyAnalysis;
}
