import test from "node:test";
import assert from "node:assert/strict";
import {
  demoConflictRecord,
  demoValidRecord,
  evaluateRecord,
} from "../.bridge-test-build/bridge-pipeline.js";

const capturedAt = "2026-09-07T14:00:00.000Z";

test("valid record becomes VALID and can be released", () => {
  const evaluation = evaluateRecord(demoValidRecord, capturedAt);

  assert.equal(evaluation.state.state, "VALID");
  assert.equal(evaluation.state.releaseAllowed, true);
  assert.equal(evaluation.release.releaseAllowed, true);
  assert.deepEqual(evaluation.state.triggeringConstraintIds, []);
  assert.equal(evaluation.state.canReevaluate, false);
});

test("unknown status alone becomes NEEDS_CONFIRMATION without inventing meaning", () => {
  const raw = { ...demoValidRecord, STATUS: "UNBEKANNT" };
  const evaluation = evaluateRecord(raw, capturedAt);

  assert.equal(evaluation.mapped.status, null);
  assert.equal(evaluation.state.state, "NEEDS_CONFIRMATION");
  assert.equal(evaluation.state.releaseAllowed, false);
  assert.equal(evaluation.release.releaseAllowed, false);
  assert.deepEqual(evaluation.state.triggeringConstraintIds, ["status.value_map"]);
  assert.ok(evaluation.state.reaction.includes("nichts erfinden"));
  assert.deepEqual(evaluation.snapshot.values, raw);
});

test("unconfirmed contract alone becomes NEEDS_CONFIRMATION", () => {
  const evaluation = evaluateRecord(demoValidRecord, capturedAt, {
    contract: "order-v2-unconfirmed",
  });

  assert.equal(evaluation.state.state, "NEEDS_CONFIRMATION");
  assert.equal(evaluation.state.releaseAllowed, false);
  assert.deepEqual(evaluation.state.triggeringConstraintIds, ["contract.version"]);
});

test("negative quantity becomes BLOCKED and source value is preserved", () => {
  const raw = { ...demoValidRecord, MENGE: "-4" };
  const evaluation = evaluateRecord(raw, capturedAt);

  assert.equal(evaluation.mapped.quantity, -4);
  assert.equal(evaluation.state.state, "BLOCKED");
  assert.equal(evaluation.state.releaseAllowed, false);
  assert.deepEqual(evaluation.state.triggeringConstraintIds, ["quantity.positive"]);
  assert.equal(evaluation.snapshot.values.MENGE, "-4");
  assert.ok(evaluation.state.reaction.includes("Quelle unverändert"));
});

test("transport failure becomes BLOCKED", () => {
  const evaluation = evaluateRecord(demoValidRecord, capturedAt, {
    transportStatus: "timeout",
  });

  assert.equal(evaluation.state.state, "BLOCKED");
  assert.deepEqual(evaluation.state.triggeringConstraintIds, ["transport.received"]);
});

test("hard failure takes priority over semantic confirmation in mixed case", () => {
  const evaluation = evaluateRecord(demoConflictRecord, capturedAt);

  assert.equal(evaluation.state.state, "BLOCKED");
  assert.deepEqual(
    evaluation.state.triggeringConstraintIds,
    ["status.value_map", "quantity.positive"],
  );
  assert.equal(evaluation.release.releaseAllowed, false);
  assert.ok(evaluation.report.nextStep.startsWith("BLOCKED:"));
});

test("state decision and release decision can never disagree", () => {
  const cases = [
    evaluateRecord(demoValidRecord, capturedAt),
    evaluateRecord({ ...demoValidRecord, STATUS: "UNBEKANNT" }, capturedAt),
    evaluateRecord({ ...demoValidRecord, MENGE: "-4" }, capturedAt),
    evaluateRecord(demoConflictRecord, capturedAt),
    evaluateRecord(demoValidRecord, capturedAt, { contract: "unknown-contract" }),
    evaluateRecord(demoValidRecord, capturedAt, { transportStatus: "failed" }),
  ];

  for (const evaluation of cases) {
    assert.equal(evaluation.state.releaseAllowed, evaluation.release.releaseAllowed);
    assert.equal(evaluation.state.state === "VALID", evaluation.release.releaseAllowed);
  }
});
