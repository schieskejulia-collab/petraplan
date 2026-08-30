import test from 'node:test';
import assert from 'node:assert/strict';
import { validateSemanticContract } from './semanticContract.js';

test('accepts a complete active semantic contract', () => {
  const decision = validateSemanticContract(
    {
      id: 'contract-1',
      contract_key: 'customer-master',
      version: '2.1.0',
      source_system: 'legacy-sap',
      source_schema_version: 'r3-kna1-v1',
      semantic_schema_version: 'customer-v3',
      mapping_hash: 'sha256:abc',
      status: 'active',
      valid_from: '2026-01-01T00:00:00Z',
      valid_until: '2027-01-01T00:00:00Z',
    },
    {
      expectedSourceSystem: 'legacy-sap',
      expectedSourceSchemaVersion: 'r3-kna1-v1',
      at: '2026-08-30T18:00:00Z',
    },
  );

  assert.equal(decision.valid, true);
  assert.deepEqual(decision.missing, []);
  assert.equal(decision.version, '2.1.0');
});

test('blocks silent mapping drift when version evidence is incomplete', () => {
  const decision = validateSemanticContract({
    id: 'contract-1',
    contract_key: 'customer-master',
    version: null,
    source_schema_version: 'r3-kna1-v1',
    semantic_schema_version: 'customer-v3',
    mapping_hash: null,
    status: 'active',
  });

  assert.equal(decision.valid, false);
  assert.ok(decision.missing.includes('contract_version'));
  assert.ok(decision.missing.includes('mapping_hash'));
});

test('blocks a source schema mismatch even when the contract is otherwise complete', () => {
  const decision = validateSemanticContract(
    {
      id: 'contract-1',
      contract_key: 'customer-master',
      version: '2.1.0',
      source_system: 'legacy-sap',
      source_schema_version: 'r3-kna1-v1',
      semantic_schema_version: 'customer-v3',
      mapping_hash: 'sha256:abc',
      status: 'approved',
    },
    { expectedSourceSchemaVersion: 'r3-kna1-v2' },
  );

  assert.equal(decision.valid, false);
  assert.ok(decision.missing.includes('source_schema_version_match'));
});

test('blocks an expired contract', () => {
  const decision = validateSemanticContract(
    {
      id: 'contract-1',
      contract_key: 'customer-master',
      version: '1.0.0',
      source_system: 'legacy-sap',
      source_schema_version: 'r3-kna1-v1',
      semantic_schema_version: 'customer-v2',
      mapping_hash: 'sha256:def',
      status: 'active',
      valid_until: '2026-07-01T00:00:00Z',
    },
    { at: '2026-08-30T18:00:00Z' },
  );

  assert.equal(decision.valid, false);
  assert.ok(decision.missing.includes('contract_expired'));
});
