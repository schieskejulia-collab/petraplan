import OpenAI from 'openai';

export type LegacyAnalysis = {
  fieldMapping: Record<string, string>;
  field_types: Record<string, string>;
  schema_sql: string[];
  core_queries: string[];
  business_rules: string[];
  state_transitions: string[];
  operations: string[];
  communication_contracts: string[];
  evidence: string[];
  warnings: string[];
};

const SYSTEM_PROMPT = `
Du bist die Kern-Analyse-Engine von Mila für Legacy-Systeme.

Ziel: Extrahiere nur nachweisbare Datenbank-, Geschäfts- und Verhaltenslogik aus dem übergebenen Legacy-Text.
Ignoriere reine UI-/Layout-Details und Framework-Overhead, aber ignoriere niemals fachliche Regeln,
Berechtigungslogik, Statusübergänge, Constraints, Datenabhängigkeiten, Operationen oder Kommunikationsverhalten,
nur weil sie im Anwendungscode statt in der Datenbank stehen.

Achte insbesondere auf drei Arten von Verhalten:
- state_transitions: explizite Zustände und erlaubte Übergänge, inklusive Bedingungen, wenn sie belegt sind.
- operations: Methoden/Funktionen/Kommandos, die fachlich relevante Daten oder Zustände lesen oder verändern.
- communication_contracts: nachweisbare Request/Response-, Event-, Queue-, RPC-, IPC- oder Socket-Verträge sowie
  explizite Aussagen zu Reihenfolge, Timeout, Retry, Blocking/Nonblocking oder Fehlerverhalten.

Regeln:
- Erfinde keine Felder, Datentypen, Beziehungen, Zustände, Übergänge, Operationen oder Geschäftsregeln.
- Wenn etwas nicht eindeutig ableitbar ist, trage es in warnings ein.
- Leere Kategorien werden als leere Arrays zurückgegeben; fehlende Belege dürfen nicht ergänzt werden.
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
      'state_transitions',
      'operations',
      'communication_contracts',
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
      state_transitions: { type: 'array', items: { type: 'string' } },
      operations: { type: 'array', items: { type: 'string' } },
      communication_contracts: { type: 'array', items: { type: 'string' } },
      evidence: { type: 'array', items: { type: 'string' } },
      warnings: { type: 'array', items: { type: 'string' } },
    },
  },
};

const REQUIRED_KEYS = [
  'fieldMapping',
  'field_types',
  'schema_sql',
  'core_queries',
  'business_rules',
  'state_transitions',
  'operations',
  'communication_contracts',
  'evidence',
  'warnings',
] as const;

let client: OpenAI | null = null;

function getOpenAI(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY is required');
  client ??= new OpenAI({ apiKey });
  return client;
}

function isStringRecord(value: unknown): value is Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.values(value).every((item) => typeof item === 'string');
}

function requireStringArray(record: Record<string, unknown>, key: string): string[] {
  const value = record[key];
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    throw new Error(`AI parser ${key} must be an array of strings`);
  }
  return value;
}

export function validateLegacyAnalysis(value: unknown): LegacyAnalysis {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('AI parser response must be a JSON object');
  }

  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  const unexpectedKeys = keys.filter(
    (key) => !REQUIRED_KEYS.includes(key as (typeof REQUIRED_KEYS)[number]),
  );
  const missingKeys = REQUIRED_KEYS.filter((key) => !(key in record));

  if (missingKeys.length > 0) {
    throw new Error(`AI parser response is missing required fields: ${missingKeys.join(', ')}`);
  }

  if (unexpectedKeys.length > 0) {
    throw new Error(`AI parser response contains unexpected fields: ${unexpectedKeys.join(', ')}`);
  }

  const fieldMapping = record.fieldMapping;
  const fieldTypes = record.field_types;

  if (!isStringRecord(fieldMapping)) {
    throw new Error('AI parser fieldMapping must be an object with string values');
  }
  if (!isStringRecord(fieldTypes)) {
    throw new Error('AI parser field_types must be an object with string values');
  }

  const schemaSql = requireStringArray(record, 'schema_sql');
  const coreQueries = requireStringArray(record, 'core_queries');
  const businessRules = requireStringArray(record, 'business_rules');
  const stateTransitions = requireStringArray(record, 'state_transitions');
  const operations = requireStringArray(record, 'operations');
  const communicationContracts = requireStringArray(record, 'communication_contracts');
  const evidence = requireStringArray(record, 'evidence');
  const warnings = requireStringArray(record, 'warnings');

  return {
    fieldMapping,
    field_types: fieldTypes,
    schema_sql: schemaSql,
    core_queries: coreQueries,
    business_rules: businessRules,
    state_transitions: stateTransitions,
    operations,
    communication_contracts: communicationContracts,
    evidence,
    warnings,
  };
}

export function parseLegacyAnalysisContent(content: string): LegacyAnalysis {
  let parsed: unknown;

  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error('AI parser returned invalid JSON');
  }

  return validateLegacyAnalysis(parsed);
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

  return parseLegacyAnalysisContent(content);
}
