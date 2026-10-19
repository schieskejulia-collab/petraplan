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

test('pinned Northwind source bytes match Git upstream blob IDs', async () => {
  for (const [name, expectedBlob] of Object.entries(upstreamGitBlobs)) {
    const bytes = pinnedNorthwindBytes(name as keyof typeof upstreamGitBlobs);
    const prefix = Buffer.from('blob ' + bytes.byteLength + '\0', 'utf8');
    const actualBlob = createHash('sha1').update(prefix).update(bytes).digest('hex');
    if (actualBlob !== expectedBlob) {
      const url = 'https://raw.githubusercontent.com/neo4j-contrib/northwind-neo4j/5db323116a2779434ba0c17eb2b733575bfc2a4a/data/' + name;
      let detail = 'upstream content comparison unavailable';
      try {
        const response = await fetch(url, { signal: AbortSignal.timeout(12000) });
        if (response.ok) {
          const upstream = Buffer.from(await response.arrayBuffer());
          const local = Buffer.from(bytes);
          let index = 0;
          while (index < Math.min(local.length, upstream.length) && local[index] === upstream[index]) index++;
          const localText = local.toString('utf8').replace(/\\r\\n/g, '\\n');
          const upstreamText = upstream.toString('utf8').replace(/\\r\\n/g, '\\n');
          const localLines = localText.split('\\n');
          const upstreamLines = upstreamText.split('\\n');
          const firstLine = localLines.findIndex((line, i) => line !== upstreamLines[i]);
          detail = JSON.stringify({
            localBytes: local.length, upstreamBytes: upstream.length,
            firstDifferentByte: index, firstDifferentLine: firstLine + 1,
            localLine: localLines[firstLine]?.slice(0, 180),
            upstreamLine: upstreamLines[firstLine]?.slice(0, 180),
            equalAfterCRLFNormalization: localText === upstreamText,
            equalAfterTrimEnd: localText.trimEnd() === upstreamText.trimEnd(),
          });
        } else detail = 'upstream HTTP ' + response.status;
      } catch (error) { detail = 'upstream fetch failed: ' + String(error); }
      assert.fail(name + ' differs from upstream Git blob: ' + detail);
    }
  }
});
