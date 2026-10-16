import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { verifyPinnedSourceBytes } from '../../api-server/src/services/pinnedSourceIntegrity.js';
import { verifyPinnedNorthwindFile } from '../../api-server/src/services/pinnedNorthwindData.js';

const sourceId = 'northwind/orders.csv';
const bytes = new TextEncoder().encode('orderID,customerID\n10266,WARTH\n');
const expectedSha256 = createHash('sha256').update(bytes).digest('hex');
const check = (overrides: Partial<Parameters<typeof verifyPinnedSourceBytes>[0]> = {}) =>
  verifyPinnedSourceBytes({
    sourceId, expectedSourceId: sourceId, expectedSha256,
    readTrustedBytes: async () => bytes, ...overrides,
  });

test('matching pinned bytes only advance to authenticity review', async () => {
  const result = await check();
  assert.equal(result.state, 'READY_FOR_SOURCE_AUTHENTICITY_REVIEW');
  assert.equal(result.computedSha256, expectedSha256);
  assert.equal(result.validationAllowed, false);
  assert.equal(result.releaseAllowed, false);
});

test('wrong source binding fails before reading bytes', async () => {
  let read = false;
  const result = await check({ sourceId: 'other', readTrustedBytes: async () => { read = true; return bytes; } });
  assert.equal(result.state, 'BLOCKED_SOURCE_BINDING');
  assert.equal(read, false);
});

test('invalid expected digest fails closed', async () => {
  assert.equal((await check({ expectedSha256: 'invalid' })).state, 'BLOCKED_SOURCE_BINDING');
});

test('changed bytes fail integrity', async () => {
  const result = await check({ readTrustedBytes: async () => new TextEncoder().encode('changed') });
  assert.equal(result.state, 'BLOCKED_DIGEST_MISMATCH');
  assert.equal(result.validationAllowed, false);
  assert.equal(result.releaseAllowed, false);
});

test('unavailable or throwing resolver fails closed', async () => {
  assert.equal((await check({ readTrustedBytes: async () => null })).state, 'BLOCKED_SOURCE_UNAVAILABLE');
  assert.equal((await check({ readTrustedBytes: async () => { throw new Error('offline'); } })).state, 'BLOCKED_SOURCE_UNAVAILABLE');
});

test('Northwind remains blocked without an independently established digest manifest', async () => {
  for (const name of ['orders.csv', 'order-details.csv', 'customers.csv'] as const) {
    const result = await verifyPinnedNorthwindFile(name);
    assert.equal(result.state, 'BLOCKED_REFERENCE_NOT_ESTABLISHED');
    assert.equal(result.validationAllowed, false);
    assert.equal(result.releaseAllowed, false);
  }
});
