import OpenAI from 'openai';
import type { LegacyAnalysis } from './aiParser.js';
import { validateLegacyAnalysis } from './aiParser.js';

const SYSTEM_PROMPT = `
You are the evidence-first meta-analysis layer for a legacy-system ingestion pipeline.
Extract only statements explicitly supported by the supplied legacy text.
Do not invent fields, mappings, types, rules, state transitions, operations, communication behavior, or evidence.
Return exactly one JSON object with these keys and no others:
fieldMapping, field_types, schema_sql, core_queries, business_rules, state_transitions, operations,
communication_contracts, evidence, warnings.
fieldMapping and field_types must be JSON objects with string values. Every other key must be an array of strings.
If evidence is insufficient, leave the relevant collection empty and explain uncertainty in warnings.
`;

let client: OpenAI | null = null;

function getOpenAI(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY is required');
  client ??= new OpenAI({ apiKey });
  return client;
}

export async function parseLegacyTextLive(legacyText: string): Promise<LegacyAnalysis> {
  if (typeof legacyText !== 'string' || legacyText.trim().length === 0) {
    throw new Error('legacy_text must be a non-empty string');
  }

  const completion = await getOpenAI().chat.completions.create({
    model: process.env.OPENAI_MODEL ?? 'gpt-5.6',
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: legacyText },
    ],
  });

  const content = completion.choices[0]?.message?.content;
  if (!content) throw new Error('AI parser returned no content');

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error('AI parser returned invalid JSON');
  }

  return validateLegacyAnalysis(parsed);
}
