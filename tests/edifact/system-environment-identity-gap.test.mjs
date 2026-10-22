import test from 'node:test';
import assert from 'node:assert/strict';
import { projectStinoDinoSourceAddresses } from './stinodino-bridge-handoff.mjs';

// Synthetic fixtures only. No network, database, productive system or writes.
// A system, its environment, and a data source are three different identities.
const raw = "UNH+1+ORDERS:D:96A:UN'BGM+220+STINODINO-001+9'LIN+1++4000862141404:EN'QTY+21:48:PCE'UNT+5+1'";
const sourceId = 'synthetic:shared-export';

function testContext(systemId, environmentId) {
  return Object.freeze({ systemId, environmentId, sourceId });
}

function contextualAddress(context, sourceAddress) {
  // Test-only proposal, not an existing PetraPlan address format or migration.
  return JSON.stringify([context.systemId, context.environmentId, sourceAddress]);
}

test('same raw source and sourceId in two environments collide under current source-only projection', () => {
  const productive = projectStinoDinoSourceAddresses(raw, { sourceId });
  const replica = projectStinoDinoSourceAddresses(raw, { sourceId });
  assert.equal(productive.state, 'SOURCE_OBSERVATIONS_ONLY');
  assert.equal(replica.state, 'SOURCE_OBSERVATIONS_ONLY');
  assert.deepEqual(productive.addresses, replica.addresses);
  assert.equal(productive.rootAddress, replica.rootAddress);
  assert.equal(productive.releaseAllowed, false);
  assert.equal(replica.persisted, false);
});

test('explicit system and environment identity disambiguate otherwise identical source locators', () => {
  const production = testContext('system:warehouse-a', 'environment:production');
  const isolated = testContext('system:warehouse-a', 'environment:isolated-test');
  const otherSystem = testContext('system:warehouse-b', 'environment:isolated-test');
  const projection = projectStinoDinoSourceAddresses(raw, { sourceId });
  const locator = projection.addresses[1].address;

  assert.notEqual(contextualAddress(production, locator), contextualAddress(isolated, locator));
  assert.notEqual(contextualAddress(isolated, locator), contextualAddress(otherSystem, locator));
  assert.equal(contextualAddress(isolated, locator), contextualAddress(isolated, locator));
  assert.equal(projection.observations[0].meaning, 'unconfirmed');
});

test('a source address alone does not prove isolation or grant write authority', () => {
  const projection = projectStinoDinoSourceAddresses(raw, { sourceId });
  assert.equal(projection.persisted, false);
  assert.equal(projection.releaseAllowed, false);
  assert.equal(Object.hasOwn(projection, 'systemId'), false);
  assert.equal(Object.hasOwn(projection, 'environmentId'), false);
  // Network isolation and permissions require separate infrastructure checks.
});
