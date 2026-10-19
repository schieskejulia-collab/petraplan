import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * Read-only source-byte integrity gate. Caller supplies a trusted server-owned
 * resolver; this function never fetches arbitrary URLs or trusts client digests.
 * Byte identity does NOT establish semantic meaning or source authenticity.
 */
export async function verifyPinnedSourceBytes(input: {
  sourceId: string;
  expectedSourceId: string;
  expectedSha256: string;
  readTrustedBytes: () => Promise<Uint8Array | null>;
}): Promise<{
  state: 'BLOCKED_SOURCE_BINDING' | 'BLOCKED_SOURCE_UNAVAILABLE' |
    'BLOCKED_DIGEST_MISMATCH' | 'READY_FOR_SOURCE_AUTHENTICITY_REVIEW';
  computedSha256: string | null;
  validationAllowed: false;
  releaseAllowed: false;
}> {
  const result = (state: 'BLOCKED_SOURCE_BINDING' | 'BLOCKED_SOURCE_UNAVAILABLE' |
    'BLOCKED_DIGEST_MISMATCH' | 'READY_FOR_SOURCE_AUTHENTICITY_REVIEW',
    computedSha256: string | null = null) => ({
    state, computedSha256, validationAllowed: false as const, releaseAllowed: false as const,
  });
  if (!input.sourceId || input.sourceId !== input.expectedSourceId
      || !/^[a-f0-9]{64}$/i.test(input.expectedSha256)) {
    return result('BLOCKED_SOURCE_BINDING');
  }
  let bytes: Uint8Array | null;
  try {
    bytes = await input.readTrustedBytes();
  } catch {
    return result('BLOCKED_SOURCE_UNAVAILABLE');
  }
  if (!(bytes instanceof Uint8Array)) return result('BLOCKED_SOURCE_UNAVAILABLE');
  const digest = createHash('sha256').update(bytes).digest('hex');
  if (!timingSafeEqual(Buffer.from(digest, 'hex'), Buffer.from(input.expectedSha256, 'hex'))) {
    return result('BLOCKED_DIGEST_MISMATCH', digest);
  }
  return result('READY_FOR_SOURCE_AUTHENTICITY_REVIEW', digest);
}
