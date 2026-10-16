import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { pinnedNorthwindBytes } from '../../api-server/src/services/pinnedNorthwindData.js';

/**
 * Git blob object IDs independently retrieved from neo4j-contrib/northwind-neo4j
 * commit 5db323116a2779434ba0c17eb2b733575bfc2a4a, paths data/*.csv.
 * These are Git SHA-1 object identities, NOT SHA-256 content digests.
 */
const upstreamGitBlobs = {
  'orders.csv': '9df2b1f97796a65c5bf2a04d7af12e4d6387c8e8',
  'order-details.csv': '53f832f28ea7155ccaec9a053b68d134edb21c20',
  'customers.csv': 'e8821db2325797cbc2f9f336b5ac1145d9fdc002',
} as const;

test('pinned Northwind source bytes match Git upstream blob IDs', () => {
  for (const [name, expectedBlob] of Object.entries(upstreamGitBlobs)) {
    const bytes = pinnedNorthwindBytes(name as keyof typeof upstreamGitBlobs);
    const prefix = Buffer.from('blob ' + bytes.byteLength + '\\0', 'utf8');
    const actualBlob = createHash('sha1').update(prefix).update(bytes).digest('hex');
    assert.equal(actualBlob, expectedBlob, name + ' differs from pinned upstream Git blob');
  }
});
