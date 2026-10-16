import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideReleaseGate } from '../../api-server/src/services/releaseGate.js';

const documentedException = {
  approved: true,
  approvedBy: 'domain-owner',
  reason: 'Explicit, scoped exception',
  approvedAt: '2026-10-13T10:00:00Z',
  scope: 'case:A-10266',
};

test('REGRESSION: revoked certificate cannot become an exception on negative validation', () => {
  const result = decideReleaseGate({
    latestValidationStatus: 'failed',
    existingReleaseStatus: 'revoked',
    hasReleaseCertificate: true,
    latestValidationId: 'validation-2',
    certificateValidationId: 'validation-1',
    exceptionApproval: documentedException,
  });
  assert.equal(result.effectiveStatus, 'revoked',
    'Terminal revocation must take precedence over a documented exception');
  assert.equal(result.shouldTransition, false);
});

test('REGRESSION: superseded certificate cannot become an exception on negative validation', () => {
  const result = decideReleaseGate({
    latestValidationStatus: 'failed',
    existingReleaseStatus: 'superseded',
    hasReleaseCertificate: true,
    latestValidationId: 'validation-2',
    certificateValidationId: 'validation-1',
    exceptionApproval: documentedException,
  });
  assert.equal(result.effectiveStatus, 'superseded',
    'Terminal supersession must take precedence over a documented exception');
  assert.equal(result.shouldTransition, false);
});
