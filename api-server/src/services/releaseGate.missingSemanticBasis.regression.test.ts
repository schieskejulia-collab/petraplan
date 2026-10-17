import test from 'node:test';
import assert from 'node:assert/strict';
import { decideReleaseGate } from './releaseGate.js';

/**
 * RED regression contract: a passing technical validation must not silently
 * preserve semantic trust when no current T0/T1 basis was supplied.
 *
 * This test intentionally fails against the current optional semanticBasis
 * implementation. It does not simulate database reads; an integration test
 * of releaseReconciliation is still required.
 */
test('regression: trusted release without verified semantic T0/T1 basis is not trusted', () => {
  const result = decideReleaseGate({
    latestValidationStatus: 'passed',
    existingReleaseStatus: 'trusted',
    hasReleaseCertificate: true,
    latestValidationId: 'validation-1',
    certificateValidationId: 'validation-1',
  });

  assert.equal(
    result.effectiveStatus,
    'blocked',
    'Missing semantic basis must not preserve trusted status',
  );
  assert.equal(result.shouldTransition, false, 'This pre-review check must not authorize a write');
});
