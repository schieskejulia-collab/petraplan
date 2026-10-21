import test from 'node:test';
import assert from 'node:assert/strict';
import { observeNorthwindDetailPositions } from '../../api-server/src/services/addressableNorthwind.ts';
import { inspectAddressRoles, compareAddressRoles } from './northwind-address-role-inspector.mjs';

const details = [
  { OrderID: 10248, ProductID: 11, Quantity: 12 },
  { OrderID: 10248, ProductID: 42, Quantity: 10 },
  { OrderID: 10248, ProductID: 72, Quantity: 5 },
];
function inspect(rows) {
  const observed = observeNorthwindDetailPositions({
    orderId: 10248, envelope: { orderDetails: rows },
  });
  assert.equal(observed.state, 'SOURCE_OBSERVATIONS_ONLY');
  return inspectAddressRoles(observed);
}

test('individual Northwind observations keep locator and candidate identity separate', () => {
  const result = inspect(structuredClone(details));
  assert.equal(result.state, 'SOURCE_OBSERVATIONS_ONLY');
  assert.deepEqual(result.entries.map(x => x.physicalLocator), [
    'orderDetails[0].Quantity', 'orderDetails[1].Quantity', 'orderDetails[2].Quantity',
  ]);
  assert.deepEqual(result.entries.map(x => x.logicalIdentityCandidate), [
    '[10248,11]', '[10248,42]', '[10248,72]',
  ]);
  assert.ok(result.entries.every(x => x.stableLogicalAddress === null &&
    x.registryWriteAllowed === false && x.identityAuthority === 'unique_in_snapshot_only'));
  assert.equal(result.persisted, false);
});

test('reordered positions report moved locators, not missing identities', () => {
  const compared = compareAddressRoles(inspect(structuredClone(details)),
    inspect(structuredClone(details).reverse()));
  assert.equal(compared.state, 'CANDIDATE_COMPARISON_ONLY');
  assert.deepEqual(compared.missingCandidates, []);
  assert.deepEqual(compared.addedCandidates, []);
  assert.equal(compared.movedLocators.length, 2);
  assert.deepEqual(compared.changedValues, []);
});

test('missing position and changed value are separate candidate-level observations', () => {
  const next = [{ ...details[0], Quantity: 13 }, details[1]];
  const compared = compareAddressRoles(inspect(structuredClone(details)), inspect(next));
  assert.deepEqual(compared.missingCandidates, ['[10248,72]']);
  assert.deepEqual(compared.changedValues, [{ candidate: '[10248,11]', before: 12, after: 13 }]);
  assert.equal(compared.releaseAllowed, false);
});

test('duplicate candidate identity is blocked before address-role comparison', () => {
  const observed = observeNorthwindDetailPositions({
    orderId: 10248, envelope: { orderDetails: [...details, details[2]] },
  });
  assert.equal(observed.state, 'BLOCKED_AMBIGUOUS_IDENTITY');
  assert.equal(inspectAddressRoles(observed).state, 'SOURCE_OBSERVATIONS_ONLY');
  assert.deepEqual(inspectAddressRoles(observed).entries, []);
});

test('mismatched roots cannot be compared as same order', () => {
  const a = inspect(structuredClone(details));
  const b = { ...a, rootAddress: 'NW:A-10249' };
  assert.equal(compareAddressRoles(a, b).state, 'BLOCKED_UNCOMPARABLE_SNAPSHOTS');
});
