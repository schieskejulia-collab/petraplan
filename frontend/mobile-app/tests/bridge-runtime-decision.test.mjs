import test from "node:test";
import assert from "node:assert/strict";

import { buildCapabilityProfile } from "../.bridge-test-build/bridge-capability-profile.js";
import { decideRuntimeOperation } from "../.bridge-test-build/bridge-runtime-decision.js";

function profileWith(capabilities) {
  return buildCapabilityProfile({
    connectionId: "conn:test:v1",
    identity: {
      databaseType: "TestDB",
      databaseVersion: "1.0",
      driverName: "TestDriver",
      driverVersion: "1.0",
    },
    structure: {
      tablesKnown: true,
      columnsKnown: true,
      keysKnown: true,
      dataTypesKnown: true,
      nullabilityKnown: true,
    },
    capabilities,
    limits: {
      identifierLength: "known",
      typeLimits: "known",
      dateTimeRepresentation: "known",
      driverSpecificRestrictions: [],
    },
  });
}

const supportedRead = {
  capability: "read.orders",
  support: "supported",
  evidence: {
    level: "authoritative_metadata",
    reference: "driver metadata: read.orders",
  },
};

test("runtime allows an operation only when the profile strongly supports every requirement", () => {
  const profile = profileWith([supportedRead]);
  const result = decideRuntimeOperation(profile, "read-order", [
    { capability: "read.orders", requiredSupport: "supported" },
  ]);

  assert.equal(result.allowedByCapabilities, true);
  assert.deepEqual(result.failedRequirements, []);
  assert.equal(result.releaseAuthority, "none");
  assert.equal(result.sourcePolicy, "preserve");
});

test("runtime blocks an explicitly unsupported capability", () => {
  const profile = profileWith([
    {
      capability: "write.orders",
      support: "unsupported",
      evidence: {
        level: "driver_report",
        reference: "driver report: write.orders unsupported",
      },
    },
  ]);

  const result = decideRuntimeOperation(profile, "write-order", [
    { capability: "write.orders", requiredSupport: "supported" },
  ]);

  assert.equal(result.allowedByCapabilities, false);
  assert.deepEqual(result.failedRequirements, ["write.orders"]);
});

test("runtime blocks a capability that is not present in the profile instead of guessing", () => {
  const profile = profileWith([supportedRead]);
  const result = decideRuntimeOperation(profile, "delete-order", [
    { capability: "delete.orders", requiredSupport: "supported" },
  ]);

  assert.equal(result.allowedByCapabilities, false);
  assert.deepEqual(result.failedRequirements, ["delete.orders"]);
  assert.match(result.evidence[0], /not_profiled/);
});

test("human-only evidence cannot authorize a runtime operation", () => {
  const profile = profileWith([
    {
      capability: "read.orders",
      support: "supported",
      evidence: {
        level: "human_only",
        reference: "operator says read is supported",
      },
    },
  ]);

  const result = decideRuntimeOperation(profile, "read-order", [
    { capability: "read.orders", requiredSupport: "supported" },
  ]);

  assert.equal(result.allowedByCapabilities, false);
  assert.deepEqual(result.failedRequirements, ["read.orders"]);
});

test("runtime capability gate never becomes a business release authority", () => {
  const profile = profileWith([supportedRead]);
  const result = decideRuntimeOperation(profile, "read-order", [
    { capability: "read.orders", requiredSupport: "supported" },
  ]);

  assert.equal(result.allowedByCapabilities, true);
  assert.equal(result.releaseAuthority, "none");
});
