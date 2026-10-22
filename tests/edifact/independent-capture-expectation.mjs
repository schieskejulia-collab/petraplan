import { createHash } from 'node:crypto';

// A trusted capture boundary is NOT available in these synthetic fixtures.
// A separately supplied expectation can detect disagreement, but the caller
// is responsible for independently acquiring and protecting that expectation.
const hash = raw => createHash('sha256').update(raw).digest('hex');
const valid = value => typeof value === 'string' && value.trim().length > 0;

export function checkIndependentCaptureExpectation({ observedBytes, expectation }) {
  if (!Buffer.isBuffer(observedBytes) || !expectation ||
      !valid(expectation.systemId) || !valid(expectation.environmentId) ||
      !valid(expectation.sourceId) || !valid(expectation.snapshotId) ||
      !valid(expectation.sha256) || !Number.isSafeInteger(expectation.byteLength) ||
      expectation.byteLength < 0) {
    return { state: 'BLOCKED_INVALID_EXPECTATION' };
  }
  if (observedBytes.length !== expectation.byteLength ||
      hash(observedBytes) !== expectation.sha256) {
    return { state: 'BLOCKED_INDEPENDENT_EXPECTATION_MISMATCH' };
  }
  return {
    state: 'MATCHES_SUPPLIED_EXPECTATION_ONLY',
    systemId: expectation.systemId,
    environmentId: expectation.environmentId,
    sourceId: expectation.sourceId,
    snapshotId: expectation.snapshotId,
    rawSha256: expectation.sha256,
    independentAcquisitionVerified: false,
    expectationAuthority: 'unverified_caller_supplied',
    persisted: false,
    releaseAllowed: false,
  };
}
