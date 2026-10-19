import test from 'node:test';
import assert from 'node:assert/strict';
import { decideReleaseGate } from './releaseGate.js';
import type { DecisionBasis } from './decisionBasisCheck.js';

const basis: DecisionBasis = {
  source: 'SRC-r1:TEST-C01', mapping: 'MAP-r1:CustomerReference',
  scope: 'SYN-ORDER-001:Orders.CustomerID',
  semanticRevision: 'SEM-r1', evidenceRevision: 'EVID-r1',
  status: 'CONFIRMED', conflict: false,
};
const release = (current: DecisionBasis, bound: DecisionBasis = basis) => decideReleaseGate({
  latestValidationStatus: 'passed', existingReleaseStatus: 'trusted',
  hasReleaseCertificate: true, latestValidationId: 'v1', certificateValidationId: 'v1',
  semanticBasis: { bound, current },
});

test('release gate: RE EX A unchanged semantic basis preserves eligibility, no new authorization', () => {
  const result = release({ ...basis });
  assert.equal(result.effectiveStatus, 'trusted');
  assert.equal(result.shouldTransition, false);
});
test('release gate: RE EX B revised contradictory evidence blocks even with passing validation', () => {
  const result = release({ ...basis, semanticRevision: 'SEM-r2', evidenceRevision: 'EVID-r2',
    status: 'UNRESOLVED', conflict: true });
  assert.equal(result.effectiveStatus, 'blocked');
  assert.match(result.reason, /BLOCKED_STALE_BASIS/);
});
test('release gate: missing evidence fails closed', () => {
  const result = release({ ...basis, evidenceRevision: null });
  assert.equal(result.effectiveStatus, 'blocked');
  assert.match(result.reason, /BLOCKED_INCOMPLETE_EVIDENCE/);
});
test('release gate: changed scope fails closed', () => {
  const result = release({ ...basis, scope: 'SYN-ORDER-002:Orders.CustomerID' });
  assert.equal(result.effectiveStatus, 'blocked');
  assert.match(result.reason, /BLOCKED_BINDING_MISMATCH/);
});
test('release gate: already revoked release stays revoked when semantic basis fails', () => {
  const result = decideReleaseGate({
    latestValidationStatus: 'passed', existingReleaseStatus: 'revoked',
    hasReleaseCertificate: true, latestValidationId: 'v1', certificateValidationId: 'v1',
    semanticBasis: { bound: basis, current: { ...basis, conflict: true } },
  });
  assert.equal(result.effectiveStatus, 'revoked');
});
test('release gate: missing optional basis does not pretend it was independently verified', () => {
  const result = decideReleaseGate({
    latestValidationStatus: 'passed', existingReleaseStatus: 'trusted',
    hasReleaseCertificate: true, latestValidationId: 'v1', certificateValidationId: 'v1',
  });
  assert.equal(result.effectiveStatus, 'trusted');
  assert.doesNotMatch(result.reason, /Semantic decision basis/);
});
