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

type MappingEntry = { source: string; target: string };
type FieldTypeEntry = { field: string; legacy_type: string };

type LegacyAnalysisTransport = {
  field_mapping_entries: MappingEntry[];
  field_type_entries: FieldTypeEntry[];
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

Transportformat:
- field_mapping_entries enthält nur explizit belegte Struktur->Bedeutung-Zuordnungen als {source,target}.
- field_type_entries enthält nur explizit belegte Legacy-Typen als {field,legacy_type}.
- Die API-Transportform ist absichtlich eine Liste, damit jedes Mapping einzeln prüfbar bleibt.

Regeln:
- Erfinde keine Felder, Datentypen, Beziehungen, Zustände, Übergänge, Operationen oder Geschäftsregeln.
- Wenn Quellen sich widersprechen und keine belastbare Priorität ableitbar ist, trage den Konflikt in warnings ein und stelle ihn nicht als eindeutige Wahrheit dar.
- Beobachtete Runtime-Evidenz darf als Beobachtung dokumentiert werden, aber nicht automatisch als universelle Geschäftsregel verallgemeinert werden.
- Wenn etwas nicht eindeutig ableitbar ist, trage es in warnings ein.
- Leere Kategorien werden als leere Arrays zurückgegeben; fehlende Belege dürfen nicht ergänzt werden.
- schema_sql ist ausschließlich ein nicht-ausführbarer Vorschlag zur späteren menschlichen Prüfung.
- evidence enthält kurze Hinweise darauf, aus welcher expliziten Information die Analyse abgeleitet wurde.
- Gib ausschließlich valides JSON im vorgegebenen Schema zurück.
`;

const objectEntry = (properties: Record<string, unknown>, required: string[]) => ({
  type: 'object',
  additionalProperties: false,
  properties,
  required,
});

const responseSchema = {
  name: 'legacy_schema_analysis',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      field_mapping_entries: {
        type: 'array',
        items: objectEntry(
          {
            source: { type: 'string' },
            target: { type: 'string' },
          },
          ['source', 'target'],
        ),
      },
      field_type_entries: {
        type: 'array',
        items: objectEntry(
          {
            field: { type: 'string' },
            legacy_type: { type: 'string' },
          },
          ['field', 'legacy_type'],
        ),
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
    required: [
      'field_mapping_entries',
      'field_type_entries',
      'schema_sql',
      'core_queries',
      'business_rules',
      'state_transitions',
      'operations',
      'communication_contracts',
      'evidence',
      'warnings',
    ],
  },
};

const TRANSPORT_KEYS = [
  'field_mapping_entries',
  'field_type_entries',
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

function requireStringArray(record: Record<string, unknown>, key: string): string[] {
  const value = record[key];
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    throw new Error(`AI parser ${key} must be an array of strings`);
  }
  return value;
}

function requireMappingEntries(value: unknown): MappingEntry[] {
  if (!Array.isArray(value)) throw new Error('AI parser field_mapping_entries must be an array');
  return value.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error(`AI parser field_mapping_entries[${index}] must be an object`);
    }
    const record = entry as Record<string, unknown>;
    if (Object.keys(record).length !== 2 || typeof record.source !== 'string' || typeof record.target !== 'string') {
      throw new Error(`AI parser field_mapping_entries[${index}] is invalid`);
    }
    return { source: record.source, target: record.target };
  });
}

function requireFieldTypeEntries(value: unknown): FieldTypeEntry[] {
  if (!Array.isArray(value)) throw new Error('AI parser field_type_entries must be an array');
  return value.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error(`AI parser field_type_entries[${index}] must be an object`);
    }
    const record = entry as Record<string, unknown>;
    if (Object.keys(record).length !== 2 || typeof record.field !== 'string' || typeof record.legacy_type !== 'string') {
      throw new Error(`AI parser field_type_entries[${index}] is invalid`);
    }
    return { field: record.field, legacy_type: record.legacy_type };
  });
}

function entriesToRecord(entries: MappingEntry[], label: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const { source, target } of entries) {
    if (source in result && result[source] !== target) {
      throw new Error(`AI parser ${label} contains conflicting duplicate source: ${source}`);
    }
    result[source] = target;
  }
  return result;
}

function typeEntriesToRecord(entries: FieldTypeEntry[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const { field, legacy_type } of entries) {
    if (field in result && result[field] !== legacy_type) {
      throw new Error(`AI parser field_type_entries contains conflicting duplicate field: ${field}`);
    }
    result[field] = legacy_type;
  }
  return result;
}

export function validateLegacyAnalysisTransport(value: unknown): LegacyAnalysisTransport {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('AI parser response must be a JSON object');
  }

  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  const unexpectedKeys = keys.filter(
    (key) => !TRANSPORT_KEYS.includes(key as (typeof TRANSPORT_KEYS)[number]),
  );
  const missingKeys = TRANSPORT_KEYS.filter((key) => !(key in record));

  if (missingKeys.length > 0) {
    throw new Error(`AI parser response is missing required fields: ${missingKeys.join(', ')}`);
  }
  if (unexpectedKeys.length > 0) {
    throw new Error(`AI parser response contains unexpected fields: ${unexpectedKeys.join(', ')}`);
  }

  return {
    field_mapping_entries: requireMappingEntries(record.field_mapping_entries),
    field_type_entries: requireFieldTypeEntries(record.field_type_entries),
    schema_sql: requireStringArray(record, 'schema_sql'),
    core_queries: requireStringArray(record, 'core_queries'),
    business_rules: requireStringArray(record, 'business_rules'),
    state_transitions: requireStringArray(record, 'state_transitions'),
    operations: requireStringArray(record, 'operations'),
    communication_contracts: requireStringArray(record, 'communication_contracts'),
    evidence: requireStringArray(record, 'evidence'),
    warnings: requireStringArray(record, 'warnings'),
  };
}

export function normalizeLegacyAnalysis(transport: LegacyAnalysisTransport): LegacyAnalysis {
  return {
    fieldMapping: entriesToRecord(transport.field_mapping_entries, 'field_mapping_entries'),
    field_types: typeEntriesToRecord(transport.field_type_entries),
    schema_sql: transport.schema_sql,
    core_queries: transport.core_queries,
    business_rules: transport.business_rules,
    state_transitions: transport.state_transitions,
    operations: transport.operations,
    communication_contracts: transport.communication_contracts,
    evidence: transport.evidence,
    warnings: transport.warnings,
  };
}

export function parseLegacyAnalysisContent(content: string): LegacyAnalysis {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error('AI parser returned invalid JSON');
  }
  return normalizeLegacyAnalysis(validateLegacyAnalysisTransport(parsed));
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
