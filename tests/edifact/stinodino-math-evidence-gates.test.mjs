import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectEdifactOrders } from './stinodino-entry.mjs';

const order = (q1 = '48', q2 = '12') =>
  `UNH+1+ORDERS:D:96A:UN'BGM+220+STINODINO-001+9'LIN+1++4000862141404:EN'QTY+21:${q1}'LIN+2++4000862141411:EN'QTY+21:${q2}'UNT+7+1'`;

test('gate 1: numeric values are parsed per line, not inferred as an order total', () => {
  const result = inspectEdifactOrders(order());
  assert.deepEqual(result.lines.map(line => line.quantities[0].value), [48, 12]);
  assert.equal(result.state, 'NEEDS_CONFIRMATION');
  assert.equal(result.releaseAllowed, false);
  assert.ok(result.findings.some(f => f.code === 'ORDER_TOTAL_RULE_NOT_CONFIRMED'));
  assert.equal(Object.hasOwn(result, 'orderTotal'), false);
});

test('gate 1: nonnumeric and negative quantities are blocked, not coerced', () => {
  for (const value of ['ABC', '-12', '12,5', '']) {
    const result = inspectEdifactOrders(order('48', value));
    assert.equal(result.state, 'BLOCKED', `must block ${JSON.stringify(value)}`);
    assert.ok(result.findings.some(f => f.code === 'INVALID_QUANTITY'));
    assert.equal(result.releaseAllowed, false);
  }
});

test('gate 2: units remain source-specific and are not silently converted', () => {
  const result = inspectEdifactOrders(order('48:PCE', '12:CT'));
  assert.deepEqual(result.lines.map(line => line.quantities[0].unit), ['PCE', 'CT']);
  assert.equal(result.releaseAllowed, false);
  assert.equal(result.state, 'NEEDS_CONFIRMATION');
  assert.equal(Object.hasOwn(result, 'orderTotal'), false);
});

test('gate 2: even identical unit tokens do not establish verified business semantics', () => {
  const result = inspectEdifactOrders(order('48:PCE', '12:PCE'));
  assert.deepEqual(result.lines.map(line => line.quantities[0].unit), ['PCE', 'PCE']);
  assert.ok(result.findings.some(f => f.code === 'ORDER_TOTAL_RULE_NOT_CONFIRMED'));
  assert.equal(result.releaseAllowed, false);
});

test('gate 3: arithmetic 48 + 12 = 60 is not a release-authorized business total', () => {
  const result = inspectEdifactOrders(order());
  const values = result.lines.map(line => line.quantities[0].value);
  assert.equal(values.reduce((a, b) => a + b, 0), 60); // test-side arithmetic only
  assert.equal(Object.hasOwn(result, 'orderTotal'), false);
  assert.equal(result.releaseAllowed, false);
  assert.equal(result.state, 'NEEDS_CONFIRMATION');
});
