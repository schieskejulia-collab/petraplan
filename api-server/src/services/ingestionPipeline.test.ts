import test from 'node:test';
import assert from 'node:assert/strict';
import type { LegacyAnalysis } from './aiParser.js';
import { runIngestionPipeline } from './ingestionPipeline.js';

const analysis: LegacyAnalysis = {
  fieldMapping: {
    KDNR: 'customer_id',
    BETRAG: 'amount',
  },
  field_types: {
    KDNR: 'NUMC',
    BETRAG: 'DECIMAL',
  },
  schema_sql: ['CREATE TABLE customer (...)'],
  core_queries: ['SELECT * FROM customer'],
  business_rules: ['KDNR is preserved as text.'],
  evidence: ['Source contains KDNR and BETRAG.'],
  warnings: [],
};

test('runs the full pre-OpenAI ingestion core with an injected analyzer', async () => {
  let receivedText = '';

  const result = await runIngestionPipeline({
    legacyText: 'legacy export definition',
    rawPayload: {
      KDNR: '001024',
      BETRAG: '1.250,50',
    },
    analyze: async (legacyText) => {
      receivedText = legacyText;
      return analysis;
    },
  });

  assert.equal(receivedText, 'legacy export definition');
  assert.deepEqual(result.analysis, analysis);
  assert.equal(result.extractedSchema.review_required, true);
  assert.deepEqual(result.extractedSchema.mapped_payload, {
    customer_id: '001024',
    amount: 1250.5,
  });
});

test('does not swallow analyzer failures', async () => {
  await assert.rejects(
    runIngestionPipeline({
      legacyText: 'legacy export definition',
      rawPayload: { KDNR: '001024' },
      analyze: async () => {
        throw new Error('AI adapter unavailable');
      },
    }),
    /AI adapter unavailable/,
  );
});

test('rejects empty legacy text before calling the analyzer', async () => {
  let called = false;

  await assert.rejects(
    runIngestionPipeline({
      legacyText: '   ',
      rawPayload: { KDNR: '001024' },
      analyze: async () => {
        called = true;
        return analysis;
      },
    }),
    /legacy_text must be a non-empty string/,
  );

  assert.equal(called, false);
});
