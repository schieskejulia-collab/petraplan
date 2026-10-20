import test from 'node:test';
import assert from 'node:assert/strict';
import { buildStinoDinoProofBundle } from './stinodino-proof-bundle.mjs';

const valid = "UNH+1+ORDERS:D:96A:UN'BGM+220+STINODINO-001+9'LIN+1++4000862141404:EN'QTY+21:48:PCE'LIN+2++4000862141411:EN'QTY+21:12:CT'UNT+7+1'";
test('same raw bytes produce the same content-addressed observation bundle', () => {
  const a = buildStinoDinoProofBundle(valid), b = buildStinoDinoProofBundle(valid);
  assert.deepEqual(a, b);
  assert.match(a.snapshot.ref, /^sha256:[a-f0-9]{64}$/);
  assert.equal(a.snapshot.bytes, Buffer.byteLength(valid, 'utf8'));
  assert.deepEqual(a.handoff.candidates.map(c => c.evidence[0].snapshotRef), [a.snapshot.ref, a.snapshot.ref]);
  assert.equal(a.gate.releaseAllowed, false);
  assert.equal(a.gate.claimDraft, 'not_created');
});
test('changed quantity changes fingerprint but cannot authorize a release', () => {
  const before = buildStinoDinoProofBundle(valid);
  const after = buildStinoDinoProofBundle(valid.replace('48:PCE', '49:PCE'));
  assert.notEqual(before.snapshot.ref, after.snapshot.ref);
  assert.equal(after.handoff.candidates[0].parsedNumber, 49);
  assert.equal(after.gate.candidateConfirmation, 'not_confirmed');
  assert.equal(after.handoff.releaseAllowed, false);
});
test('blocked source stays blocked even with a content hash', () => {
  const bad = buildStinoDinoProofBundle(valid.replace('48:PCE', 'ABC:PCE'));
  assert.equal(bad.handoff.ingestionState, 'BLOCKED');
  assert.equal(bad.handoff.nextStep, 'BLOCKED');
  assert.equal(bad.gate.releaseAllowed, false);
  assert.equal(bad.snapshot.identityVerified, false);
});
