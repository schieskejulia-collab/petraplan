import test from "node:test";
import assert from "node:assert/strict";
import {
  assessOperationAgainstProfile,
  buildCapabilityProfile,
} from "../.bridge-test-build/bridge-capability-profile.js";

function baseInput() {
  return {
    connectionId: "conn:demo:01",
    identity: {
      databaseType: "demo-rdbms",
      databaseVersion: "1.0",
      driverName: "demo-driver",
      driverVersion: "1.0",
    },
    structure: {
      tablesKnown: true,
      columnsKnown: true,
      keysKnown: true,
      dataTypesKnown: true,
      nullabilityKnown: true,
    },
    capabilities: [
      {
        capability: "joins.inner",
        support: "supported",
        evidence: { level: "authoritative_metadata", reference: "metadata:joins.inner=true" },
      },
      {
        capability: "transactions",
        support: "supported",
        evidence: { level: "driver_report", reference: "driver:transactions=true" },
      },
      {
        capability: "stored_procedures",
        support: "unsupported",
        evidence: { level: "documentation", reference: "driver-doc:stored-procedures=unsupported" },
      },
    ],
    limits: {
      identifierLength: "documented",
      typeLimits: "documented",
      dateTimeRepresentation: "documented",
      driverSpecificRestrictions: [],
    },
  };
}

test("complete strongly evidenced connection becomes usable for operation checks", () => {
  const profile = buildCapabilityProfile(baseInput());
  assert.equal(profile.usableForOperationChecks, true);
  assert.deepEqual(profile.unresolvedCapabilities, []);
  assert.equal(profile.releaseAuthority, "none");
  assert.equal(profile.sourcePolicy, "preserve");
});

test("database family name alone never creates a usable capability profile", () => {
  const input = baseInput();
  input.capabilities = [];
  const profile = buildCapabilityProfile(input);
  assert.equal(profile.usableForOperationChecks, false);
});

test("unknown capability prevents profile use", () => {
  const input = baseInput();
  input.capabilities.push({
    capability: "outer_join.full",
    support: "unknown",
    evidence: { level: "missing", reference: "" },
  });
  const profile = buildCapabilityProfile(input);
  assert.equal(profile.usableForOperationChecks, false);
  assert.ok(profile.unresolvedCapabilities.includes("outer_join.full"));
});

test("human-only capability statement is recorded but cannot authorize operation use", () => {
  const input = baseInput();
  input.capabilities.push({
    capability: "placeholders",
    support: "supported",
    evidence: { level: "human_only", reference: "operator says placeholders work" },
  });
  const profile = buildCapabilityProfile(input);
  assert.equal(profile.usableForOperationChecks, false);
  assert.ok(profile.weaklyEvidencedCapabilities.includes("placeholders"));
  assert.ok(profile.unresolvedCapabilities.includes("placeholders"));
});

test("observed one-off behavior does not become reusable capability truth", () => {
  const input = baseInput();
  input.capabilities.push({
    capability: "auto_numbering",
    support: "supported",
    evidence: { level: "observed", reference: "one insert returned an id" },
  });
  const profile = buildCapabilityProfile(input);
  assert.equal(profile.usableForOperationChecks, false);
  assert.ok(profile.weaklyEvidencedCapabilities.includes("auto_numbering"));
});

test("missing driver version prevents capability profile use", () => {
  const input = baseInput();
  input.identity.driverVersion = "";
  const profile = buildCapabilityProfile(input);
  assert.equal(profile.usableForOperationChecks, false);
});

test("missing structural knowledge prevents operation checks", () => {
  const input = baseInput();
  input.structure.keysKnown = false;
  const profile = buildCapabilityProfile(input);
  assert.equal(profile.usableForOperationChecks, false);
});

test("missing limits prevent operation checks", () => {
  const input = baseInput();
  input.limits.dateTimeRepresentation = "";
  const profile = buildCapabilityProfile(input);
  assert.equal(profile.usableForOperationChecks, false);
});

test("supported capability with strong evidence can satisfy an operation", () => {
  const profile = buildCapabilityProfile(baseInput());
  const result = assessOperationAgainstProfile(profile, "read_related_rows", [
    { capability: "joins.inner", requiredSupport: "supported" },
  ]);
  assert.equal(result.allowedByProfile, true);
  assert.deepEqual(result.failedRequirements, []);
  assert.equal(result.releaseAuthority, "none");
});

test("unsupported capability blocks the technical operation", () => {
  const profile = buildCapabilityProfile(baseInput());
  const result = assessOperationAgainstProfile(profile, "call_stored_procedure", [
    { capability: "stored_procedures", requiredSupport: "supported" },
  ]);
  assert.equal(result.allowedByProfile, false);
  assert.deepEqual(result.failedRequirements, ["stored_procedures"]);
});

test("unprofiled capability blocks rather than being guessed", () => {
  const profile = buildCapabilityProfile(baseInput());
  const result = assessOperationAgainstProfile(profile, "full_outer_join", [
    { capability: "joins.full_outer", requiredSupport: "supported" },
  ]);
  assert.equal(result.allowedByProfile, false);
  assert.deepEqual(result.failedRequirements, ["joins.full_outer"]);
  assert.ok(result.evidence.includes("joins.full_outer:not_profiled"));
});
