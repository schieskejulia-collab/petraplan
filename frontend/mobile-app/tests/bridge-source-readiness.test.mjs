import test from "node:test";
import assert from "node:assert/strict";

import { assessSourceReadiness } from "../.bridge-test-build/bridge-source-readiness.js";

function readyInput() {
  return {
    ingress: {
      contextTrusted: true,
      failedCheckIds: [],
      checks: [],
      sourcePolicy: "preserve",
      interpretationPolicy: "do_not_interpret_until_context_trusted",
    },
    addressing: {
      addressingReady: true,
      failedCheckIds: [],
      checks: [],
      sourcePolicy: "preserve",
      releaseAuthority: "none",
      principle: "representation_compare_sequence_address_identity",
    },
    adapter: {
      readyForReadIntrospection: true,
      failedCheckIds: [],
      checks: [],
      sourceSelfDescription: {
        tablesOrCollections: "supported",
        fields: "supported",
        dataTypes: "supported",
        nullability: "supported",
        precisionAndScale: "supported",
      },
      portability: "driver_specific",
      sourcePolicy: "preserve",
      writePolicy: "forbidden",
      releaseAuthority: "none",
      semanticPolicy: "metadata_describes_structure_not_business_meaning",
      principle: "identify_access_path_verify_read_only_introspect_then_compare",
    },
    capabilityProfile: {
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
      capabilities: [],
      limits: {
        identifierLength: "known",
        typeLimits: "known",
        dateTimeRepresentation: "known",
        driverSpecificRestrictions: [],
      },
      checks: [],
      usableForOperationChecks: true,
      unresolvedCapabilities: [],
      weaklyEvidencedCapabilities: [],
      sourcePolicy: "preserve",
      releaseAuthority: "none",
      principle: "identify_read_capabilities_read_limits_build_profile",
    },
    runtimeDecision: {
      operation: "read-order",
      allowedByCapabilities: true,
      failedRequirements: [],
      evidence: ["read.orders:supported:authoritative_metadata:driver metadata"],
      sourcePolicy: "preserve",
      releaseAuthority: "none",
    },
  };
}

test("source is ready only when every technical precondition is satisfied", () => {
  const result = assessSourceReadiness(readyInput());
  assert.equal(result.sourceReady, true);
  assert.deepEqual(result.failedCheckIds, []);
  assert.equal(result.writePolicy, "forbidden");
  assert.equal(result.releaseAuthority, "none");
  assert.equal(result.interpretationPolicy, "do_not_interpret_until_source_ready");
});

test("untrusted ingress blocks source readiness", () => {
  const input = readyInput();
  input.ingress.contextTrusted = false;
  input.ingress.failedCheckIds = ["ingress.freshness"];
  const result = assessSourceReadiness(input);
  assert.equal(result.sourceReady, false);
  assert.ok(result.failedCheckIds.includes("readiness.ingress"));
});

test("ambiguous addressing blocks source readiness", () => {
  const input = readyInput();
  input.addressing.addressingReady = false;
  input.addressing.failedCheckIds = ["addressing.identity"];
  const result = assessSourceReadiness(input);
  assert.equal(result.sourceReady, false);
  assert.ok(result.failedCheckIds.includes("readiness.addressing"));
});

test("adapter that is not safe for read introspection blocks readiness", () => {
  const input = readyInput();
  input.adapter.readyForReadIntrospection = false;
  input.adapter.failedCheckIds = ["adapter.read_only"];
  const result = assessSourceReadiness(input);
  assert.equal(result.sourceReady, false);
  assert.ok(result.failedCheckIds.includes("readiness.adapter"));
});

test("weak or incomplete capability profile blocks readiness", () => {
  const input = readyInput();
  input.capabilityProfile.usableForOperationChecks = false;
  input.capabilityProfile.unresolvedCapabilities = ["read.orders"];
  const result = assessSourceReadiness(input);
  assert.equal(result.sourceReady, false);
  assert.ok(result.failedCheckIds.includes("readiness.capability_profile"));
});

test("runtime operation denied by capabilities blocks readiness", () => {
  const input = readyInput();
  input.runtimeDecision.allowedByCapabilities = false;
  input.runtimeDecision.failedRequirements = ["read.orders"];
  const result = assessSourceReadiness(input);
  assert.equal(result.sourceReady, false);
  assert.ok(result.failedCheckIds.includes("readiness.runtime_operation"));
});

test("source readiness never grants business release authority", () => {
  const result = assessSourceReadiness(readyInput());
  assert.equal(result.sourceReady, true);
  assert.equal(result.releaseAuthority, "none");
  assert.equal(result.sourcePolicy, "preserve");
});
