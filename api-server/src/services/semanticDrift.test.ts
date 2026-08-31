import test from 'node:test';
import assert from 'node:assert/strict';
import { detectSemanticDrift } from './semanticDrift.js';

test('accepts explicitly matching semantic meaning evidence', () => {
  const expected = {
    semantic_id: 'customer.status',
    meaning_version: '1.0.0',
    value_type: 'string',
    code_system: 'legacy-customer-status-v1',
    allowed_values: ['ACTIVE', 'BLOCKED'],
    invariant_hash: 'sha256:status-rules-v1',
  };

  const decision = detectSemanticDrift(expected, { ...expected });

  assert.equal(decision.status, 'compatible');
  assert.equal(decision.compatibleForAction, true);
  assert.deepEqual(decision.differences, []);
});

test('detects changed business meaning even when technical type stays identical', () => {
  const decision = detectSemanticDrift(
    {
      semantic_id: 'order.amount',
      meaning_version: '1.0.0',
      value_type: 'decimal',
      unit: 'EUR',
      invariant_hash: 'sha256:gross-amount',
    },
    {
      semantic_id: 'order.amount',
      meaning_version: '2.0.0',
      value_type: 'decimal',
      unit: 'EUR',
      invariant_hash: 'sha256:net-amount',
    },
  );

  assert.equal(decision.status, 'drift_detected');
  assert.equal(decision.compatibleForAction, false);
  assert.ok(decision.differences.includes('meaning_version'));
  assert.ok(decision.differences.includes('invariant_hash'));
  assert.ok(!decision.differences.includes('value_type'));
});

test('detects unit and code-system drift', () => {
  const decision = detectSemanticDrift(
    {
      semantic_id: 'material.weight',
      meaning_version: '1.0.0',
      value_type: 'decimal',
      unit: 'kg',
      code_system: 'sap-material-v1',
    },
    {
      semantic_id: 'material.weight',
      meaning_version: '1.0.0',
      value_type: 'decimal',
      unit: 'g',
      code_system: 'sap-material-v2',
    },
  );

  assert.equal(decision.status, 'drift_detected');
  assert.ok(decision.differences.includes('unit'));
  assert.ok(decision.differences.includes('code_system'));
});

test('detects domain drift when allowed values change', () => {
  const decision = detectSemanticDrift(
    {
      semantic_id: 'delivery.status',
      meaning_version: '1.0.0',
      allowed_values: ['OPEN', 'CLOSED'],
    },
    {
      semantic_id: 'delivery.status',
      meaning_version: '1.0.0',
      allowed_values: ['OPEN', 'PARTIAL', 'CLOSED'],
    },
  );

  assert.equal(decision.status, 'drift_detected');
  assert.ok(decision.differences.includes('allowed_values'));
});

test('returns unknown rather than guessing when semantic evidence is incomplete', () => {
  const decision = detectSemanticDrift(
    { semantic_id: 'customer.status', meaning_version: '1.0.0' },
    { semantic_id: 'customer.status', meaning_version: null },
  );

  assert.equal(decision.status, 'unknown');
  assert.equal(decision.compatibleForAction, false);
  assert.ok(decision.missing.includes('observed_meaning_version'));
});
