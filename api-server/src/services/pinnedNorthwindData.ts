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

/** Expected digest must be independently reviewed and server-owned.
 * Byte identity does not prove source authenticity or semantic meaning.
 */
export function verifyPinnedNorthwindFile(name: PinnedNorthwindFile, expectedSha256: string) {
  return verifyPinnedSourceBytes({
    sourceId: 'northwind/' + name,
    expectedSourceId: 'northwind/' + name,
    expectedSha256,
    readTrustedBytes: async () => pinnedNorthwindBytes(name),
  });
}

export function pinnedNorthwindText(name: PinnedNorthwindFile): string {
  return Buffer.from(pinnedNorthwindBytes(name)).toString('utf8');
}
