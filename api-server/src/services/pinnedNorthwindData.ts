import { gunzipSync } from 'node:zlib';
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
 * An externally reviewed, server-owned digest manifest is not yet available.
 * Do not accept caller-supplied hashes as evidence of trusted source identity.
 */
export async function verifyPinnedNorthwindFile(name: PinnedNorthwindFile) {
  const sourceId = 'northwind/' + name;
  return {
    sourceId,
    state: 'BLOCKED_REFERENCE_NOT_ESTABLISHED' as const,
    computedSha256: null,
    validationAllowed: false as const,
    releaseAllowed: false as const,
  };
}

/** Internal byte comparison helper only. A matching caller-provided digest
 * is not trusted source verification and cannot grant validation or release.
 */
export function comparePinnedNorthwindBytes(name: PinnedNorthwindFile, candidateSha256: string) {
  return verifyPinnedSourceBytes({
    sourceId: 'northwind/' + name,
    expectedSourceId: 'northwind/' + name,
    expectedSha256: candidateSha256,
    readTrustedBytes: async () => pinnedNorthwindBytes(name),
  });
}

export function pinnedNorthwindText(name: PinnedNorthwindFile): string {
  return Buffer.from(pinnedNorthwindBytes(name)).toString('utf8');
}
