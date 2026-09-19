import test from "node:test";
import assert from "node:assert/strict";

import {
  demoValidRecord,
} from "../.bridge-test-build/bridge-pipeline.js";
import {
  evaluateRecordWithConflictTruth,
} from "../.bridge-test-build/bridge-conflict-truth.js";

const capturedAt = "2026-09-19T01:35:00.000Z";

test("adapter-only customer conflict reaches state and release decision", () => {
  const raw = { ...demoValidRecord };
  const conflictTruth = [
    {
      field: "KUNDEN_NR",
      code: "CUSTOMER_MISMATCH",
      message: "Customer.CustomerID=VINET widerspricht Order.CustomerID=ALFKI.",
      blocking: true,
    },
  ];

  const evaluation = evaluateRecordWithConflictTruth(
    raw,
    capturedAt,
    {},
    {},
    conflictTruth,
  );

  // Without Conflict Truth this record is fully valid. The adapter-only
  // contradiction must therefore be the sole cause that closes release.
  assert.equal(evaluation.release.releaseAllowed, false);
  assert.equal(evaluation.release.blockingIssues, 1);
  assert.deepEqual(evaluation.state.triggeringConstraintIds, [
    "adapter.CUSTOMER_MISMATCH:KUNDEN_NR",
  ]);
  assert.equal(evaluation.state.state, "BLOCKED");

  const adapterConstraint = evaluation.constraints.find(
    ({ id }) => id === "adapter.CUSTOMER_MISMATCH:KUNDEN_NR",
  );
  assert.equal(adapterConstraint?.passed, false);
  assert.equal(adapterConstraint?.severity, "blocking");
  assert.equal(adapterConstraint?.category, "data");

  assert.ok(
    evaluation.report.errors.some((error) =>
      error.startsWith("[adapter] Adapter-Konflikt (CUSTOMER_MISMATCH)"),
    ),
  );
  assert.ok(
    evaluation.provenance.conflicts.some((error) =>
      error.startsWith("[adapter] Adapter-Konflikt (CUSTOMER_MISMATCH)"),
    ),
  );

  // Conflict Truth is a separate channel. Source Truth stays untouched.
  assert.deepEqual(evaluation.raw, raw);
  assert.deepEqual(evaluation.snapshot.values, raw);
  assert.deepEqual(Object.keys(evaluation.raw).sort(), [
    "AUFTRAGS_NR",
    "DATUM",
    "KUNDEN_NR",
    "MENGE",
    "STATUS",
  ]);
});
