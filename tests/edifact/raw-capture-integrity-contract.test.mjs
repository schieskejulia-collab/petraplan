import test from 'node:test';
import assert from 'node:assert/strict';
import { captureUntrustedRawBinding, verifyUntrustedRawBinding } from './raw-capture-integrity-contract.mjs';

const scope = ['system-a', 'synthetic-test', 'fixture-10248', 'snapshot-T0', 'source'];
const capture = rawBytes => captureUntrustedRawBinding({
  systemId: scope[0], environmentId: scope[1], sourceId: scope[2],
  snapshotId: scope[3], stage: scope[4], rawBytes,
});

test('unchanged independently supplied bytes match integrity, not source authenticity', () => {
  const raw = Buffer.from('OrderID,ProductID,Quantity\n10248,72,5\n', 'utf8');
  const record = capture(raw);
  const result = verifyUntrustedRawBinding(record, Buffer.from(raw), scope);
  assert.equal(result.state, 'RAW_BYTES_INTEGRITY_MATCH_ONLY');
  assert.equal(result.sourceAuthenticity, 'NOT_VERIFIED');
  assert.equal(result.captureAuthority, 'NOT_VERIFIED');
  assert.equal(result.releaseAllowed, false);
});

test('mutated raw bytes are rejected', () => {
  const raw = Buffer.from('10248,72,5');
  const record = capture(raw);
  raw[raw.length - 1] = '9'.charCodeAt(0);
  assert.equal(verifyUntrustedRawBinding(record, raw, scope).state,
    'BLOCKED_RAW_BYTES_MISMATCH');
});

test('missing independently supplied raw bytes fail closed', () => {
  const record = capture(Buffer.from('raw'));
  assert.equal(verifyUntrustedRawBinding(record, undefined, scope).state,
    'BLOCKED_INVALID_VERIFICATION_INPUT');
});

test('different system or environment labels block matching even with identical bytes', () => {
  const raw = Buffer.from('same');
  const record = capture(raw);
  assert.equal(verifyUntrustedRawBinding(record, raw,
    ['system-b', ...scope.slice(1)]).state, 'BLOCKED_SCOPE_MISMATCH');
});

test('replacing both caller-supplied record and raw can still pass: authenticity stays unverified', () => {
  const forged = Buffer.from('forged');
  const record = capture(forged);
  const result = verifyUntrustedRawBinding(record, forged, scope);
  assert.equal(result.state, 'RAW_BYTES_INTEGRITY_MATCH_ONLY');
  assert.equal(result.sourceAuthenticity, 'NOT_VERIFIED');
  assert.equal(result.releaseAllowed, false);
});
