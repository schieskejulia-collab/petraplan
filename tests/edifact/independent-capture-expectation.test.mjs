import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { checkIndependentCaptureExpectation } from './independent-capture-expectation.mjs';

const raw = Buffer.from('OrderID,ProductID,Quantity\n10248,72,5\n');
const expectation = {
  systemId: 'northwind-test', environmentId: 'fixture',
  sourceId: 'order-10248', snapshotId: 'T0',
  sha256: createHash('sha256').update(raw).digest('hex'),
  byteLength: raw.length,
};

test('matching externally supplied expectation remains unauthenticated', () => {
  const result = checkIndependentCaptureExpectation({ observedBytes: Buffer.from(raw), expectation });
  assert.equal(result.state, 'MATCHES_SUPPLIED_EXPECTATION_ONLY');
  assert.equal(result.independentAcquisitionVerified, false);
  assert.equal(result.expectationAuthority, 'unverified_caller_supplied');
  assert.equal(result.releaseAllowed, false);
});

test('changed raw bytes fail supplied expectation', () => {
  const changed = Buffer.from('OrderID,ProductID,Quantity\n10248,72,9\n');
  assert.equal(checkIndependentCaptureExpectation({
    observedBytes: changed, expectation,
  }).state, 'BLOCKED_INDEPENDENT_EXPECTATION_MISMATCH');
});

test('wrong expected hash and byte length fail', () => {
  assert.equal(checkIndependentCaptureExpectation({
    observedBytes: raw, expectation: { ...expectation, sha256: '0'.repeat(64) },
  }).state, 'BLOCKED_INDEPENDENT_EXPECTATION_MISMATCH');
  assert.equal(checkIndependentCaptureExpectation({
    observedBytes: raw, expectation: { ...expectation, byteLength: raw.length + 1 },
  }).state, 'BLOCKED_INDEPENDENT_EXPECTATION_MISMATCH');
});

test('missing expectation or raw input fail closed', () => {
  assert.equal(checkIndependentCaptureExpectation({
    observedBytes: raw,
  }).state, 'BLOCKED_INVALID_EXPECTATION');
  assert.equal(checkIndependentCaptureExpectation({
    observedBytes: 'raw', expectation,
  }).state, 'BLOCKED_INVALID_EXPECTATION');
});

test('attacker replacing both bytes and expectation can match; authenticity stays unverified', () => {
  const forged = Buffer.from('fake');
  const supplied = { ...expectation,
    sha256: createHash('sha256').update(forged).digest('hex'),
    byteLength: forged.length };
  const result = checkIndependentCaptureExpectation({ observedBytes: forged, expectation: supplied });
  assert.equal(result.state, 'MATCHES_SUPPLIED_EXPECTATION_ONLY');
  assert.equal(result.independentAcquisitionVerified, false);
  assert.equal(result.releaseAllowed, false);
});
