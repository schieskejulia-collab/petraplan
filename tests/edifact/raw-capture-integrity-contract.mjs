import { createHash } from 'node:crypto';

// Synthetic, read-only integrity binding; never a source-authenticity certificate.
// Caller labels are untrusted. A verifier MUST receive raw bytes independently
// from the supplied record to detect replacement of the original observation.
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const valid = s => typeof s === 'string' && s.trim().length > 0;
const labels = record => [record.systemId, record.environmentId, record.sourceId,
  record.snapshotId, record.stage];

export function captureUntrustedRawBinding({ systemId, environmentId, sourceId,
  snapshotId, stage, rawBytes }) {
  if (![systemId, environmentId, sourceId, snapshotId, stage].every(valid) ||
      !Buffer.isBuffer(rawBytes)) {
    return { state: 'BLOCKED_INVALID_CAPTURE_INPUT' };
  }
  const captured = Buffer.from(rawBytes);
  return {
    state: 'RAW_BYTES_BOUND',
    systemId, environmentId, sourceId, snapshotId, stage,
    bytes: captured.length,
    rawSha256: sha(captured),
    authority: 'caller_supplied_unverified',
    persisted: false,
    releaseAllowed: false,
  };
}

export function verifyUntrustedRawBinding(record, independentlySuppliedBytes, expectedScope) {
  if (record?.state !== 'RAW_BYTES_BOUND' || !Buffer.isBuffer(independentlySuppliedBytes) ||
      !Array.isArray(expectedScope) || expectedScope.length !== 5 ||
      !expectedScope.every(valid) || !labels(record).every(valid)) {
    return { state: 'BLOCKED_INVALID_VERIFICATION_INPUT' };
  }
  if (JSON.stringify(labels(record)) !== JSON.stringify(expectedScope)) {
    return { state: 'BLOCKED_SCOPE_MISMATCH' };
  }
  if (independentlySuppliedBytes.length !== record.bytes ||
      sha(independentlySuppliedBytes) !== record.rawSha256) {
    return { state: 'BLOCKED_RAW_BYTES_MISMATCH' };
  }
  return {
    state: 'RAW_BYTES_INTEGRITY_MATCH_ONLY',
    rawSha256: record.rawSha256,
    scope: [...expectedScope],
    sourceAuthenticity: 'NOT_VERIFIED',
    captureAuthority: 'NOT_VERIFIED',
    persisted: false,
    releaseAllowed: false,
  };
}
