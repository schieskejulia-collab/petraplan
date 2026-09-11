import test from "node:test";
import assert from "node:assert/strict";

import { buildAddressableReadPlan } from "../.bridge-test-build/bridge-addressable-read-plan.js";

test("confirmed root and requested relation build a ready expand-on-demand plan", () => {
  const result = buildAddressableReadPlan({
    source: "legacy_orders",
    rootAddress: "order/A-10027",
    rootIdentity: "A-10027",
    requestedFields: ["STATUS", "MENGE", "STATUS"],
    requestedRelations: ["customer"],
    knownAddresses: { customer: "customer/4711" },
    scopeStatus: "confirmed",
    readOnlyConfirmed: true,
    maxRelationDepth: 1,
    evidence: ["order address and customer locator observed"],
  });

  assert.equal(result.status, "ready");
  assert.equal(result.mode, "expand_on_demand");
  assert.deepEqual(result.requestedFields, ["STATUS", "MENGE"]);
  assert.equal(result.targets.length, 2);
  assert.equal(result.targets[1].address, "customer/4711");
  assert.equal(result.writePolicy, "forbidden");
});

test("missing relation address stays unresolved instead of loading broadly", () => {
  const result = buildAddressableReadPlan({
    source: "legacy_orders",
    rootAddress: "order/A-10027",
    rootIdentity: "A-10027",
    requestedFields: ["STATUS"],
    requestedRelations: ["customer"],
    knownAddresses: {},
    scopeStatus: "confirmed",
    readOnlyConfirmed: true,
    evidence: ["root order observed"],
  });

  assert.equal(result.status, "needs_confirmation");
  assert.equal(result.targets[1].status, "unresolved");
  assert.equal(result.targets[1].address, null);
  assert.ok(result.blockers.some((item) => item.includes("keine bestätigte Adresse")));
});

test("unconfirmed read-only access blocks the plan", () => {
  const result = buildAddressableReadPlan({
    source: "legacy_orders",
    rootAddress: "order/A-10027",
    rootIdentity: "A-10027",
    requestedFields: ["STATUS"],
    requestedRelations: [],
    knownAddresses: {},
    scopeStatus: "confirmed",
    readOnlyConfirmed: false,
    evidence: ["address observed but adapter mode unconfirmed"],
  });

  assert.equal(result.status, "blocked");
  assert.equal(result.writePolicy, "forbidden");
  assert.ok(result.blockers.some((item) => item.includes("read-only")));
});

test("relation depth is conservatively capped", () => {
  const result = buildAddressableReadPlan({
    source: "legacy_orders",
    rootAddress: "order/A-10027",
    rootIdentity: "A-10027",
    requestedFields: [],
    requestedRelations: ["customer"],
    knownAddresses: { customer: "customer/4711" },
    scopeStatus: "confirmed",
    readOnlyConfirmed: true,
    maxRelationDepth: 99,
    evidence: ["demo"],
  });

  assert.equal(result.maxRelationDepth, 5);
});
