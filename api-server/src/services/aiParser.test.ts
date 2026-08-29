import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLegacyAnalysisContent, validateLegacyAnalysis } from './aiParser.js';

const validAnalysis = {
  fieldMapping: { KDNR: 'customer_id' },
  field_types: { KDNR: 'NUMC' },
  schema_sql: ['CREATE TABLE customer (...)'],
  core_queries: ['SELECT * FROM customer'],
  business_rules: ['KDNR identifies the customer in the supplied source.'],
  state_transitions: ['DRAFT -> RELEASED only after explicit approval.'],
  operations: ['cancel() changes an approved record to cancelled.'],
  communication_contracts: ['Client sends request and waits for a server response.'],
  evidence: ['Source contains field KDNR.'],
  warnings: [],
};

test('accepts a complete legacy analysis with only expected fields', () => {
  assert.deepEqual(validateLegacyAnalysis(validAnalysis), validAnalysis);
});

test('rejects malformed JSON from the AI parser', () => {
  assert.throws(
    () => parseLegacyAnalysisContent('{not-json'),
    /AI parser returned invalid JSON/,
  );
});

test('rejects missing required fields', () => {
  const { warnings: _warnings, ...incomplete } = validAnalysis;

  assert.throws(
    () => validateLegacyAnalysis(incomplete),
    /missing required fields: warnings/,
  );
});

test('requires behavior fields even when they are empty', () => {
  const { operations: _operations, ...incomplete } = validAnalysis;

  assert.throws(
    () => validateLegacyAnalysis(incomplete),
    /missing required fields: operations/,
  );

  assert.deepEqual(
    validateLegacyAnalysis({
      ...validAnalysis,
      state_transitions: [],
      operations: [],
      communication_contracts: [],
    }),
    {
      ...validAnalysis,
      state_transitions: [],
      operations: [],
      communication_contracts: [],
    },
  );
});

test('rejects unexpected model fields', () => {
  assert.throws(
    () => validateLegacyAnalysis({ ...validAnalysis, invented_field: 'nope' }),
    /unexpected fields: invented_field/,
  );
});

test('rejects non-string values in field mappings', () => {
  assert.throws(
    () => validateLegacyAnalysis({ ...validAnalysis, fieldMapping: { KDNR: 1024 } }),
    /fieldMapping must be an object with string values/,
  );
});

test('rejects non-string items in analysis arrays', () => {
  assert.throws(
    () => validateLegacyAnalysis({ ...validAnalysis, warnings: ['ok', 42] }),
    /warnings must be an array of strings/,
  );
});
