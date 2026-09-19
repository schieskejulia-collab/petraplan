import test from "node:test";
import assert from "node:assert/strict";

import {
  demoValidRecord,
  evaluateRecord,
} from "../.bridge-test-build/bridge-pipeline.js";

const capturedAt = "2026-09-19T02:15:00.000Z";

test("schema-valid status A is preserved but never assigned an unconfirmed meaning", () => {
  const raw = { ...demoValidRecord, STATUS: "A" };
  const evaluation = evaluateRecord(raw, capturedAt);

  const schemaConstraint = evaluation.constraints.find(({ id }) => id === "contract.schema");
  const statusConstraint = evaluation.constraints.find(({ id }) => id === "status.value_map");
  const failedBlocking = evaluation.constraints.filter(
    ({ passed, severity }) => !passed && severity === "blocking",
  );
  const statusTrace = evaluation.trace.find(({ sourceField }) => sourceField === "STATUS");
  const statusSemantics = evaluation.semantics.find(({ field }) => field === "STATUS");

  // Syntax is valid: a single uppercase letter satisfies the confirmed schema.
  assert.equal(schemaConstraint?.passed, true);

  // Meaning is not confirmed. The bridge must not guess whether A means
  // active, open, accepted, or anything else.
  assert.equal(statusConstraint?.passed, false);
  assert.equal(statusConstraint?.category, "semantics");
  assert.equal(statusConstraint?.comparison.observed, "A");
  assert.equal(evaluation.mapped.status, null);
  assert.equal(statusTrace?.canonicalValue, null);
  assert.equal(statusTrace?.valueMap, "keine bestätigte Value-Map");
  assert.equal(statusTrace?.validation, "failed");
  assert.equal(statusSemantics?.valueMeaning, "Bedeutung nicht bestätigt");

  // The semantic uncertainty is the only blocking cause in this otherwise
  // valid record; release therefore needs human/domain confirmation.
  assert.deepEqual(failedBlocking.map(({ id }) => id), ["status.value_map"]);
  assert.equal(evaluation.release.blockingIssues, 1);
  assert.equal(evaluation.release.releaseAllowed, false);
  assert.equal(evaluation.state.state, "NEEDS_CONFIRMATION");
  assert.deepEqual(evaluation.state.triggeringConstraintIds, ["status.value_map"]);

  // Source Truth is preserved byte-for-byte at the field/value level.
  assert.equal(evaluation.raw.STATUS, "A");
  assert.equal(evaluation.snapshot.values.STATUS, "A");
  assert.deepEqual(evaluation.snapshot.values, raw);
});
