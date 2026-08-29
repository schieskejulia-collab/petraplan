import test from 'node:test';
import assert from 'node:assert/strict';
import { decideReleaseGate } from './releaseGate.js';

test('negative validation before release is blocked', () => {
  const result = decideReleaseGate({
    latestValidationStatus: 'failed',
    existingReleaseStatus: null,
    hasReleaseCertificate: false,
  });
  assert.equal(result.effectiveStatus, 'blocked');
  assert.equal(result.shouldTransition, true);
});

test('negative validation after trusted release is revoked', () => {
  const result = decideReleaseGate({
    latestValidationStatus: 'failed',
    existingReleaseStatus: 'trusted',
    hasReleaseCertificate: true,
  });
  assert.equal(result.effectiveStatus, 'revoked');
  assert.equal(result.shouldTransition, true);
});

test('historical failure does not matter when latest authoritative validation passes', () => {
  const result = decideReleaseGate({
    latestValidationStatus: 'passed',
    existingReleaseStatus: 'trusted',
    hasReleaseCertificate: true,
  });
  assert.equal(result.effectiveStatus, 'trusted');
  assert.equal(result.shouldTransition, false);
});

test('negative validation may use explicit complete exception approval', () => {
  const result = decideReleaseGate({
    latestValidationStatus: 'failed',
    existingReleaseStatus: 'trusted',
    hasReleaseCertificate: true,
    exceptionApproval: {
      approved: true,
      approvedBy: 'reviewer-42',
      reason: 'Documented business exception',
      evidence: { ticket: 'EX-42' },
      approvedAt: '2026-08-29T20:00:00Z',
      scope: 'record:08822f44',
    },
  });
  assert.equal(result.effectiveStatus, 'exception');
  assert.equal(result.exceptionIsDocumented, true);
});

test('incomplete exception approval cannot bypass the gate', () => {
  const result = decideReleaseGate({
    latestValidationStatus: 'failed',
    existingReleaseStatus: 'trusted',
    hasReleaseCertificate: true,
    exceptionApproval: {
      approved: true,
      reason: 'Missing approver and scope',
    },
  });
  assert.equal(result.effectiveStatus, 'revoked');
  assert.equal(result.exceptionIsDocumented, false);
});
