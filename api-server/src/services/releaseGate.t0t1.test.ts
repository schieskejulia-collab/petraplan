import test from 'node:test';
import assert from 'node:assert/strict';
import { decideReleaseGate } from './releaseGate.js';
import type { DecisionBasis } from './decisionBasisCheck.js';

const baseline: DecisionBasis = {
  source: 'snapshot-1:Orders.CustomerID',
  mapping: 'candidate-1',
  scope: 'record-1:snapshot-1',
  semanticRevision: 'rule-1:version-1',
  evidenceRevision: 'evidence-hash-1',
  status: 'CONFIRMED',
  conflict: false,
};

function assess(current: DecisionBasis | null) {
  return decideReleaseGate({
    latestValidationStatus: 'passed',
    existingReleaseStatus: 'trusted',
    hasReleaseCertificate: true,
    latestValidationId: 'validation-1',
    certificateValidationId: 'validation-1',
    requireSemanticBasis: true,
    semanticBasis: current === null ? null : { bound: baseline, current },
  });
}

test('T0/T1: unchanged confirmed basis retains status without a new write', () => {
  const decision = assess({ ...baseline });
  assert.equal(decision.effectiveStatus, 'trusted');
  assert.equal(decision.shouldTransition, false);
});

test('T0/T1: contradictory newer evidence blocks old trust', () => {
  const decision = assess({ ...baseline, evidenceRevision: 'evidence-hash-2', conflict: true });
  assert.equal(decision.effectiveStatus, 'blocked');
  assert.equal(decision.shouldTransition, false);
});

test('T0/T1: missing evidence blocks old trust', () => {
  const decision = assess(null);
  assert.equal(decision.effectiveStatus, 'blocked');
  assert.equal(decision.shouldTransition, false);
});

test('T0/T1: different source snapshot blocks old binding', () => {
  const decision = assess({ ...baseline, source: 'snapshot-2:Orders.CustomerID' });
  assert.equal(decision.effectiveStatus, 'blocked');
  assert.equal(decision.shouldTransition, false);
});
