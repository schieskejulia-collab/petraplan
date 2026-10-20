import test from 'node:test';
import assert from 'node:assert/strict';
import { projectStinoDinoSourceAddresses } from './stinodino-bridge-handoff.mjs';

const raw = "UNH+1+ORDERS:D:96A:UN'BGM+220+STINODINO-001+9'LIN+1++4000862141404:EN'QTY+21:48:PCE'LIN+2++4000862141411:EN'QTY+21:12:PCE'UNT+7+1'";

test('source locators are not semantic confirmations', () => {
  const result = projectStinoDinoSourceAddresses(raw);
  assert.deepEqual(result.addresses.slice(1).map(x => x.sourcePath), ['segment-3', 'segment-5']);
  assert.ok(result.observations.every(x => x.meaning === 'unconfirmed'));
  assert.deepEqual(result.candidates, []);
  assert.equal(result.releaseAllowed, false);
});

test('unit revision changes observation, not physical segment locator', () => {
  const before = projectStinoDinoSourceAddresses(raw);
  const after = projectStinoDinoSourceAddresses(raw.replace('48:PCE', '48:CT'));
  assert.deepEqual(before.addresses, after.addresses);
  assert.equal(before.observations[0].unit, 'PCE');
  assert.equal(after.observations[0].unit, 'CT');
  assert.equal(after.releaseAllowed, false);
});
