import { gunzipSync } from 'node:zlib';
import { PINNED_NORTHWIND_ORDERS_GZIP } from './pinnedNorthwindOrdersGzip.js';
import { PINNED_NORTHWIND_ORDER_DETAILS_GZIP } from './pinnedNorthwindOrderDetailsGzip.js';
import { PINNED_NORTHWIND_CUSTOMERS_GZIP } from './pinnedNorthwindCustomersGzip.js';

const PINNED_NORTHWIND_GZIP_BASE64 = {
  'orders.csv': PINNED_NORTHWIND_ORDERS_GZIP,
  'order-details.csv': PINNED_NORTHWIND_ORDER_DETAILS_GZIP,
  'customers.csv': PINNED_NORTHWIND_CUSTOMERS_GZIP,
} as const;

export type PinnedNorthwindFile = keyof typeof PINNED_NORTHWIND_GZIP_BASE64;

export function pinnedNorthwindText(name: PinnedNorthwindFile): string {
  return gunzipSync(Buffer.from(PINNED_NORTHWIND_GZIP_BASE64[name], 'base64')).toString('utf8');
}
