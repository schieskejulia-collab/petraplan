import { gunzipSync } from 'node:zlib';
import { createHash, timingSafeEqual } from 'node:crypto';
import { verifyPinnedSourceBytes } from './pinnedSourceIntegrity.js';
import { PINNED_NORTHWIND_ORDERS_GZIP } from './pinnedNorthwindOrdersGzip.js';
import { PINNED_NORTHWIND_ORDER_DETAILS_GZIP } from './pinnedNorthwindOrderDetailsGzip.js';
import { PINNED_NORTHWIND_CUSTOMERS_GZIP } from './pinnedNorthwindCustomersGzip.js';

const PINNED_NORTHWIND_GZIP_BASE64 = {
  'orders.csv': PINNED_NORTHWIND_ORDERS_GZIP,
  'order-details.csv': PINNED_NORTHWIND_ORDER_DETAILS_GZIP,
  'customers.csv': PINNED_NORTHWIND_CUSTOMERS_GZIP,
} as const;

export type PinnedNorthwindFile = keyof typeof PINNED_NORTHWIND_GZIP_BASE64;

export function pinnedNorthwindBytes(name: PinnedNorthwindFile): Uint8Array {
  return gunzipSync(Buffer.from(PINNED_NORTHWIND_GZIP_BASE64[name], 'base64'));
}

/**
 * Immutable Git blob IDs obtained from the pinned upstream repository commit:
 * neo4j-contrib/northwind-neo4j@5db323116a2779434ba0c17eb2b733575bfc2a4a.
 * Git SHA-1 object identities verify byte identity against the pinned commit;
 * they do not establish source authority, semantic correctness, or release approval.
 */
const UPSTREAM_GIT_BLOBS: Record<PinnedNorthwindFile, string> = {
  'orders.csv': '9df2b1f97796a65c5bf2a04d7af12e4d6387c8e8',
  'order-details.csv': '53f832f28ea7155ccaec9a053b68d134edb21c20',
  'customers.csv': 'e8821db2325797cbc2f9f336b5ac1145d9fdc002',
};

export function verifyPinnedNorthwindBytes(name: PinnedNorthwindFile, bytes: Uint8Array) {
  const expected = Buffer.from(UPSTREAM_GIT_BLOBS[name], 'hex');
  const prefix = Buffer.from('blob ' + bytes.byteLength + '\0', 'utf8');
  const actual = createHash('sha1').update(prefix).update(bytes).digest();
  const matches = actual.length === expected.length && timingSafeEqual(actual, expected);
  return {
    sourceId: 'northwind/' + name,
    state: matches ? 'PINNED_BYTES_MATCH' as const : 'BLOCKED_DIGEST_MISMATCH' as const,
    gitBlobId: actual.toString('hex'),
    validationAllowed: false as const,
    releaseAllowed: false as const,
  };
}

export async function verifyPinnedNorthwindFile(name: PinnedNorthwindFile) {
  try {
    return verifyPinnedNorthwindBytes(name, pinnedNorthwindBytes(name));
  } catch {
    return {
      sourceId: 'northwind/' + name,
      state: 'BLOCKED_SOURCE_UNAVAILABLE' as const,
      gitBlobId: null,
      validationAllowed: false as const,
      releaseAllowed: false as const,
    };
  }
}

/** Caller-supplied hashes remain diagnostic only, never a trust grant. */
export function comparePinnedNorthwindBytes(name: PinnedNorthwindFile, candidateSha256: string) {
  return verifyPinnedSourceBytes({
    sourceId: 'northwind/' + name,
    expectedSourceId: 'northwind/' + name,
    expectedSha256: candidateSha256,
    readTrustedBytes: async () => pinnedNorthwindBytes(name),
  });
}

export function pinnedNorthwindText(name: PinnedNorthwindFile): string {
  const bytes = pinnedNorthwindBytes(name);
  const integrity = verifyPinnedNorthwindBytes(name, bytes);
  if (integrity.state !== 'PINNED_BYTES_MATCH') {
    throw new Error('Pinned Northwind source integrity blocked: ' + name);
  }
  return Buffer.from(bytes).toString('utf8');
}
