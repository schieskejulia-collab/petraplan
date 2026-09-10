import test from "node:test";
import assert from "node:assert/strict";

import { decideCapabilityAtRuntime } from "../.bridge-test-build/bridge-runtime-decision.js";

const profile = {
  id: "adapter:test:v1",
  capabilities: [
    { id: "read.orders", supported: true, prerequisites: ["auth"] },
    { id: "write.orders", supported: false, prerequisites: [] },
  ],
};

test("runtime allows only supported capability with satisfied prerequisites", () => {
  assert.deepEqual(decideCapabilityAtRuntime(profile, "read.orders", ["auth"]), {
    capabilityId: "read.orders",
    allowed: true,
    reason: "supported",
    missingPrerequisites: [],
  });
});

test("runtime blocks supported capability when prerequisite is missing", () => {
  assert.deepEqual(decideCapabilityAtRuntime(profile, "read.orders", []), {
    capabilityId: "read.orders",
    allowed: false,
    reason: "missing_prerequisite",
    missingPrerequisites: ["auth"],
  });
});

test("runtime blocks explicitly unsupported capability", () => {
  assert.equal(decideCapabilityAtRuntime(profile, "write.orders", ["auth"]).allowed, false);
});

test("runtime blocks unknown capability instead of guessing", () => {
  assert.equal(decideCapabilityAtRuntime(profile, "delete.orders", ["auth"]).allowed, false);
});
