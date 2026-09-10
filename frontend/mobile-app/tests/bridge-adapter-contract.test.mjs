import test from "node:test";
import assert from "node:assert/strict";

import { assessAdapterContract } from "../.bridge-test-build/bridge-adapter-contract.js";

function baseInput() {
  return {
    sourceAddress: "source://demo/orders",
    sourceIdentity: "demo-orders-v1",
    sourceIdentityVerified: true,
    adapterKind: "sql_odbc",
    adapterName: "demo-driver",
    adapterVersion: "1.0",
    accessMode: "read_only",
    metadataDiscovery: "supported",
    capabilityDiscovery: "supported",
    errorSemantics: "explicit",
    emptyResultSemantics: "explicit",
    portability: "driver_specific",
    selfDescription: {
      tablesOrCollections: "supported",
      fields: "supported",
      dataTypes: "supported",
      nullability: "supported",
      precisionAndScale: "supported",
    },
    evidenceReferences: ["driver:metadata:v1"],
  };
}

test("verified read-only adapter with explicit result semantics is ready for introspection", () => {
  const result = assessAdapterContract(baseInput());
  assert.equal(result.readyForReadIntrospection, true);
  assert.deepEqual(result.failedCheckIds, []);
  assert.equal(result.writePolicy, "forbidden");
  assert.equal(result.releaseAuthority, "none");
});

test("write-capable adapter is blocked in the current read-only Bridge mode", () => {
  const input = baseInput();
  input.accessMode = "write_capable";
  const result = assessAdapterContract(input);
  assert.equal(result.readyForReadIntrospection, false);
  assert.ok(result.failedCheckIds.includes("adapter.read_only"));
});

test("unknown access mode is not treated as read-only", () => {
  const input = baseInput();
  input.accessMode = "unknown";
  const result = assessAdapterContract(input);
  assert.equal(result.readyForReadIntrospection, false);
  assert.ok(result.failedCheckIds.includes("adapter.read_only"));
});

test("missing metadata discovery blocks structural introspection", () => {
  const input = baseInput();
  input.metadataDiscovery = "unknown";
  const result = assessAdapterContract(input);
  assert.equal(result.readyForReadIntrospection, false);
  assert.ok(result.failedCheckIds.includes("adapter.introspection"));
});

test("unknown nullability remains unknown and blocks a complete source description", () => {
  const input = baseInput();
  input.selfDescription.nullability = "unknown";
  const result = assessAdapterContract(input);
  assert.equal(result.readyForReadIntrospection, false);
  assert.ok(result.failedCheckIds.includes("adapter.introspection"));
});

test("driver-specific behavior is allowed when the access path is explicit", () => {
  const input = baseInput();
  input.portability = "driver_specific";
  const result = assessAdapterContract(input);
  assert.equal(result.readyForReadIntrospection, true);
  assert.equal(result.portability, "driver_specific");
});

test("an error must be distinguishable from a legitimate empty result", () => {
  const input = baseInput();
  input.errorSemantics = "ambiguous";
  const result = assessAdapterContract(input);
  assert.equal(result.readyForReadIntrospection, false);
  assert.ok(result.failedCheckIds.includes("adapter.result_semantics"));
});

test("missing source identity blocks adapter use", () => {
  const input = baseInput();
  input.sourceIdentityVerified = false;
  const result = assessAdapterContract(input);
  assert.equal(result.readyForReadIntrospection, false);
  assert.ok(result.failedCheckIds.includes("adapter.identity"));
});

test("missing evidence blocks adapter contract", () => {
  const input = baseInput();
  input.evidenceReferences = [];
  const result = assessAdapterContract(input);
  assert.equal(result.readyForReadIntrospection, false);
  assert.ok(result.failedCheckIds.includes("adapter.evidence"));
});

test("metadata never grants business meaning or release authority", () => {
  const result = assessAdapterContract(baseInput());
  assert.equal(result.semanticPolicy, "metadata_describes_structure_not_business_meaning");
  assert.equal(result.releaseAuthority, "none");
});
