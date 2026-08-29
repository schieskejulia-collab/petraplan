import test from 'node:test';
import assert from 'node:assert/strict';
import { decideReleaseGate, selectAuthoritativeValidation } from './releaseGate.js';

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

test('certificate-referenced validation wins when timestamps are equal', () => {
  const timestamp = '2026-08-29T10:30:13.958403+00:00';
  const validations = [
    { id: 'failed-old', status: 'failed', created_at: timestamp },
    { id: 'passed-certified', status: 'passed', created_at: timestamp },
  ];

  const authoritative = selectAuthoritativeValidation(validations, {
    validation_result_id: 'passed-certified',
    certified_at: timestamp,
  });

  assert.equal(authoritative?.id, 'passed-certified');
  assert.equal(authoritative?.status, 'passed');
});

test('provably later validation supersedes certificate baseline', () => {
  const validations = [
    { id: 'passed-certified', status: 'passed', created_at: '2026-08-29T10:30:13Z' },
    { id: 'failed-later', status: 'failed', created_at: '2026-08-29T10:31:13Z' },
  ];

  const authoritative = selectAuthoritativeValidation(validations, {
    validation_result_id: 'passed-certified',
    certified_at: '2026-08-29T10:30:30Z',
  });

  assert.equal(authoritative?.id, 'failed-later');
  assert.equal(authoritative?.status, 'failed');
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
