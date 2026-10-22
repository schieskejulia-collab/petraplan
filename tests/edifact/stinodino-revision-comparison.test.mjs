import test from 'node:test';
import assert from 'node:assert/strict';
import { compareStinoDinoRevisions } from './stinodino-revision-comparison.mjs';

const t0 = "UNH+1+ORDERS:D:96A:UN'BGM+220+STINODINO-001+9'LIN+1++4000862141404:EN'QTY+21:48'LIN+2++4000862141411:EN'QTY+21:12'UNT+7+1'";
test('T0 to T1 quantity change preserves T0 and invalidates old source basis', () => {
  const t1 = t0.replace('QTY+21:48', 'QTY+21:49');
  const result = compareStinoDinoRevisions(t0, t1);
  assert.notEqual(result.t0.snapshotRef, result.t1.snapshotRef);
  assert.equal(result.t0.observations[0].value, '48');
  assert.equal(result.t1.observations[0].value, '49');
  assert.equal(result.t0.raw, t0);
  assert.equal(result.t1.raw, t1);
  assert.equal(result.assessment, 'BLOCKED_REVALIDATION_REQUIRED');
  assert.equal(result.oldEvidenceUsableForCurrentSource, false);
  assert.equal(result.releaseAllowed, false);
  assert.equal(result.actualReleaseRevoked, false);
});
test('unchanged T0/T1 is still unconfirmed and cannot be released', () => {
  const result = compareStinoDinoRevisions(t0, t0);
  assert.equal(result.sourceChanged, false);
  assert.equal(result.assessment, 'UNCHANGED_UNCONFIRMED');
  assert.equal(result.releaseAllowed, false);
});
test('malformed T1 is blocked without changing historical T0', () => {
  const result = compareStinoDinoRevisions(t0, t0.replace('QTY+21:48', 'QTY+21:ABC'));
  assert.equal(result.assessment, 'BLOCKED_INVALID_INPUT');
  assert.equal(result.t0.observations[0].value, '48');
  assert.equal(result.releaseAllowed, false);
});
test('whitespace changes are detected as byte-level source changes', () => {
  const result = compareStinoDinoRevisions(t0, t0 + '\n');
  assert.equal(result.sourceChanged, true);
  assert.equal(result.assessment, 'BLOCKED_REVALIDATION_REQUIRED');
});
