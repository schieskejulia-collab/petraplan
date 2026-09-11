import test from "node:test";
import assert from "node:assert/strict";
import {
  buildProvenanceMetadata,
  buildSourceSnapshotId,
} from "../.bridge-test-build/bridge-provenance.js";
import {
  demoValidRecord,
  evaluateRecord,
} from "../.bridge-test-build/bridge-pipeline.js";

const capturedAt = "2026-09-11T08:30:00.000Z";
const baseIdentity = {
  source: "legacy_orders",
  sourceRecord: "A-10027",
  capturedAt,
  messageId: "msg:legacy_orders:A-10027:2026-09-11T08:30:00.000Z",
};

const versions = {
  bridgeVersion: "petraplan-bridge-v1",
  contractVersion: "order-v1",
  mappingVersion: "order-mapping-v1",
  validationVersion: "order-validation-v1",
};

test("snapshot id is stable for identical source content regardless of object key order", () => {
  const first = buildSourceSnapshotId({
    ...baseIdentity,
    values: { B: "2", A: "1" },
  });
  const second = buildSourceSnapshotId({
    ...baseIdentity,
    values: { A: "1", B: "2" },
  });

  assert.equal(first, second);
  assert.match(first, /^snap:[0-9a-f]{8}$/);
});

test("snapshot id changes when a source value changes", () => {
  const first = buildSourceSnapshotId({
    ...baseIdentity,
    values: { MENGE: "12" },
  });
  const second = buildSourceSnapshotId({
    ...baseIdentity,
    values: { MENGE: "13" },
  });

  assert.notEqual(first, second);
});

test("provenance metadata records versions without gaining write or release authority", () => {
  const metadata = buildProvenanceMetadata({
    ...baseIdentity,
    values: demoValidRecord,
    versions,
    evidenceRefs: ["evidence:contract", "evidence:contract", "", "evidence:mapping"],
  });

  assert.deepEqual(
    {
      bridgeVersion: metadata.bridgeVersion,
      contractVersion: metadata.contractVersion,
      mappingVersion: metadata.mappingVersion,
      validationVersion: metadata.validationVersion,
    },
    versions,
  );
  assert.equal(metadata.appliedAt, capturedAt);
  assert.deepEqual(metadata.evidenceRefs, ["evidence:contract", "evidence:mapping"]);
  assert.equal(metadata.sourcePolicy, "preserve");
  assert.equal(metadata.writePolicy, "forbidden");
  assert.equal(metadata.releaseAuthority, "none");
  assert.equal(metadata.integrityClaim, "trace_identifier_not_cryptographic_proof");
});

test("pipeline links the preserved snapshot to the exact versions used for the result", () => {
  const evaluation = evaluateRecord(demoValidRecord, capturedAt, {
    source: "legacy_orders",
  });

  assert.equal(evaluation.snapshot.id, evaluation.provenance.metadata.sourceSnapshotId);
  assert.deepEqual(evaluation.snapshot.values, demoValidRecord);
  assert.equal(evaluation.provenance.metadata.bridgeVersion, "petraplan-bridge-v1");
  assert.equal(evaluation.provenance.metadata.contractVersion, "order-v1");
  assert.equal(evaluation.provenance.metadata.mappingVersion, "order-mapping-v1");
  assert.equal(evaluation.provenance.metadata.validationVersion, "order-validation-v1");
  assert.equal(evaluation.provenance.metadata.sourcePolicy, "preserve");
  assert.equal(evaluation.provenance.metadata.writePolicy, "forbidden");
  assert.equal(evaluation.provenance.metadata.releaseAuthority, "none");
  assert.equal(evaluation.provenance.mode, "read_only");
});
