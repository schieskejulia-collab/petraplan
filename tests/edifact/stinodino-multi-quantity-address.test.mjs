import test from 'node:test';
import assert from 'node:assert/strict';
import { projectStinoDinoSourceAddresses } from './stinodino-bridge-handoff.mjs';

const base = "UNH+1+ORDERS:D:96A:UN'BGM+220+STINODINO-001+9'LIN+1++4000862141404:EN'QTY+21:48:PCE'LIN+2++4000862141411:EN'QTY+21:12:PCE'UNT+7+1'";

test('multiple quantity observations retain unique physical addresses', () => {
  const input = base.replace("QTY+21:48:PCE'", "QTY+21:48:PCE'QTY+59:7:PCE'")
    .replace('UNT+7+1', 'UNT+8+1');
  const result = projectStinoDinoSourceAddresses(input);
  assert.equal(result.releaseAllowed, false);
  assert.deepEqual(result.candidates, []);
  if (result.state === 'SOURCE_OBSERVATIONS_ONLY') {
    const keys = result.observations.map(x => x.address);
    assert.equal(keys.length, 3);
    assert.equal(new Set(keys).size, keys.length);
  } else {
    assert.match(result.state, /^BLOCKED/);
    assert.deepEqual(result.observations, []);
  }
});
