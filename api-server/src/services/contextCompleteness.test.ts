import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveContextCompleteness } from './contextCompleteness.js';

test('all required sources available is complete', () => {
  const truth = deriveContextCompleteness([
    { source_key: 'sap-customer', available: true },
    { source_key: 'crm-contact', available: true },
  ]);

  assert.equal(truth.status, 'complete');
  assert.equal(truth.complete_for_action, true);
  assert.deepEqual(truth.missing_required_source_keys, []);
});

test('missing one required source is explicit partial context', () => {
  const truth = deriveContextCompleteness([
    { source_key: 'sap-customer', available: true },
    { source_key: 'crm-contact', available: false, error_code: 'timeout' },
    { source_key: 'billing-status', available: true },
  ]);

  assert.equal(truth.status, 'partial');
  assert.equal(truth.complete_for_action, false);
  assert.deepEqual(truth.available_source_keys, ['sap-customer', 'billing-status']);
  assert.deepEqual(truth.missing_required_source_keys, ['crm-contact']);
});

test('optional source failure stays visible without making required context partial', () => {
  const truth = deriveContextCompleteness([
    { source_key: 'sap-customer', available: true },
    { source_key: 'marketing-note', required: false, available: false },
  ]);

  assert.equal(truth.status, 'complete');
  assert.equal(truth.complete_for_action, true);
  assert.deepEqual(truth.unavailable_optional_source_keys, ['marketing-note']);
});

test('no available source is unavailable, not partial', () => {
  const truth = deriveContextCompleteness([
    { source_key: 'sap-customer', available: false },
    { source_key: 'crm-contact', available: false },
  ]);

  assert.equal(truth.status, 'unavailable');
  assert.equal(truth.complete_for_action, false);
});

test('no observations cannot be silently treated as complete', () => {
  const truth = deriveContextCompleteness([]);
  assert.equal(truth.status, 'unavailable');
  assert.equal(truth.complete_for_action, false);
});

test('duplicate source identity is rejected', () => {
  assert.throws(
    () => deriveContextCompleteness([
      { source_key: 'sap-customer', available: true },
      { source_key: 'sap-customer', available: false },
    ]),
    /duplicate source_key/,
  );
});
