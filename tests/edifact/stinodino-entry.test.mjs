import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectEdifactOrders } from './stinodino-entry.mjs';

const fixture = "UNH+1+ORDERS:D:96A:UN'BGM+220+STINODINO-001+9'LIN+1++4000862141404:EN'QTY+21:48'LIN+2++4000862141411:EN'QTY+21:12'UNT+7+1'";
test('preserves raw source and does not release an unconfirmed total', () => {
  const result = inspectEdifactOrders(fixture);
  assert.equal(result.rawSource, fixture);
  assert.equal(result.lines.length, 2);
  assert.equal(result.lines[0].quantities[0].rawValue, '48');
  assert.equal(result.lines[1].quantities[0].rawValue, '12');
  assert.equal(result.releaseAllowed, false);
  assert.equal(result.state, 'NEEDS_CONFIRMATION');
  assert.ok(result.findings.some(f => f.code === 'ORDER_TOTAL_RULE_NOT_CONFIRMED'));
});
test('blocks invalid quantity', () => {
  const result = inspectEdifactOrders(fixture.replace('QTY+21:48', 'QTY+21:ABC'));
  assert.equal(result.state, 'BLOCKED');
  assert.equal(result.releaseAllowed, false);
});
test('blocks orphan quantity', () => {
  const result = inspectEdifactOrders("UNH+1+ORDERS:D:96A:UN'QTY+21:48'UNT+3+1'");
  assert.equal(result.state, 'BLOCKED');
});
