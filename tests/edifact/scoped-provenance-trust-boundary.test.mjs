import test from 'node:test';
import assert from 'node:assert/strict';
import { compareScopedPositionSnapshots } from './scoped-position-snapshot-comparison.mjs';

// Adversarial contract test: matching labels do NOT authenticate source origin.
// This is an explicit negative evidence case, not a demonstration of authenticity.
const observation = (snapshotId, value) => ({
  state: 'SOURCE_OBSERVATIONS_ONLY',
  systemId: 'northwind-a',
  environmentId: 'synthetic-test',
  sourceId: 'fixture-order-10248',
  rootAddress: 'NW:A-10248',
  snapshotId,
  entries: [{
    logicalIdentityCandidate: '[10248,72]',
    physicalLocator: 'orderDetails[0].Quantity',
    identityAuthority: 'unique_in_snapshot_only',
    stableLogicalAddress: null,
    registryWriteAllowed: false,
    observedValue: value,
  }],
});

test('matching caller-provided labels do not turn comparison into trusted provenance', () => {
  const result = compareScopedPositionSnapshots(observation('T0', 5), observation('T1', 7));
  assert.equal(result.state, 'SCOPED_CANDIDATE_COMPARISON_ONLY');
  assert.deepEqual(result.changedCandidates, ['[10248,72]']);
  assert.equal(result.authority, 'unverified_synthetic_fixture');
  assert.equal(result.persisted, false);
  assert.equal(result.releaseAllowed, false);
  assert.ok(!Object.hasOwn(result, 'authenticatedSource'));
  assert.ok(!Object.hasOwn(result, 'verifiedCapture'));
});

test('relabeling a foreign observation with same scope is not detectable by this prototype', () => {
  const genuine = observation('T0', 5);
  const untrustedForeignData = observation('T1', 999);
  const result = compareScopedPositionSnapshots(genuine, untrustedForeignData);
  assert.equal(result.state, 'SCOPED_CANDIDATE_COMPARISON_ONLY');
  assert.equal(result.authority, 'unverified_synthetic_fixture');
  assert.equal(result.releaseAllowed, false);
  // Gap remains OPEN: labels are supplied by caller, not cryptographically attested.
});
