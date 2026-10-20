import test from 'node:test';
import assert from 'node:assert/strict';
import { proposeStinoDinoBridgeHandoff } from './stinodino-bridge-handoff.mjs';

const fixture = "UNH+1+ORDERS:D:96A:UN'BGM+220+STINODINO-001+9'LIN+1++4000862141404:EN'QTY+21:48:PCE'LIN+2++4000862141411:EN'QTY+21:12:CT'UNT+7+1'";

test('read-only handoff preserves raw source and segment-level evidence', () => {
  const result = proposeStinoDinoBridgeHandoff(fixture);
  assert.equal(result.source.raw, fixture);
  assert.deepEqual(result.candidates.map(c => c.parsedNumber), [48, 12]);
  assert.deepEqual(result.candidates.map(c => c.rawUnit), ['PCE', 'CT']);
  assert.deepEqual(result.candidates.map(c => c.evidence[0].segmentIndex), [3, 5]);
  assert.equal(result.candidates.every(c => c.meaning === 'unconfirmed'), true);
  assert.equal(result.candidates.every(c => c.claimStatus === 'candidate_only'), true);
});

test('candidate observations never become verified claims or an authorized total', () => {
  const result = proposeStinoDinoBridgeHandoff(fixture);
  assert.equal(result.orderTotal, null);
  assert.equal(result.releaseAllowed, false);
  assert.equal(result.releaseAuthority, 'none');
  assert.equal(result.persisted, false);
  assert.equal(result.connectedToClaimLifecycle, false);
  assert.deepEqual(result.allowedActions, ['inspect_read_only']);
  assert.equal(result.nextStep, 'NEEDS_SEMANTIC_REVIEW');
});

test('invalid source quantity remains blocked at the handoff boundary', () => {
  const result = proposeStinoDinoBridgeHandoff(fixture.replace('48:PCE', 'ABC:PCE'));
  assert.equal(result.ingestionState, 'BLOCKED');
  assert.equal(result.nextStep, 'BLOCKED');
  assert.equal(result.releaseAllowed, false);
  assert.ok(result.findings.some(f => f.code === 'INVALID_QUANTITY'));
});
