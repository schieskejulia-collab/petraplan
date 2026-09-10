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
  assert.deepEqual(
    evaluation.state.resolutionPlan.map(({ reactionType }) => reactionType),
    ["release"],
  );
  assert.equal(evaluation.state.resolutionPlan[0].mutatesSource, false);
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
  assert.equal(evaluation.state.resolutionPlan[0].reactionType, "confirm_semantics");
  assert.equal(evaluation.state.resolutionPlan[0].field, "STATUS");
  assert.equal(evaluation.state.resolutionPlan[0].requiresConfirmation, true);
  assert.equal(evaluation.state.resolutionPlan[0].mutatesSource, false);
});

test("unconfirmed contract alone becomes NEEDS_CONFIRMATION", () => {
  const evaluation = evaluateRecord(demoValidRecord, capturedAt, {
    contract: "order-v2-unconfirmed",
  });

  assert.equal(evaluation.state.state, "NEEDS_CONFIRMATION");
  assert.equal(evaluation.state.releaseAllowed, false);
  assert.deepEqual(evaluation.state.triggeringConstraintIds, ["contract.version"]);
  assert.equal(evaluation.state.resolutionPlan[0].reactionType, "confirm_contract");
  assert.equal(evaluation.state.resolutionPlan[0].requiresConfirmation, true);
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
  assert.equal(evaluation.state.resolutionPlan[0].reactionType, "correct_source_data");
  assert.equal(evaluation.state.resolutionPlan[0].field, "MENGE");
  assert.equal(evaluation.state.resolutionPlan[0].mutatesSource, false);
  assert.ok(evaluation.state.resolutionPlan[0].evidence.includes("source=-4"));
});

test("transport failure becomes BLOCKED", () => {
  const evaluation = evaluateRecord(demoValidRecord, capturedAt, {
    transportStatus: "timeout",
  });

  assert.equal(evaluation.state.state, "BLOCKED");
  assert.deepEqual(evaluation.state.triggeringConstraintIds, ["transport.received"]);
  assert.equal(evaluation.state.resolutionPlan[0].reactionType, "retry_transport");
  assert.equal(evaluation.state.resolutionPlan[0].requiresConfirmation, false);
});

test("hard failure takes priority over semantic confirmation in mixed case", () => {
  const evaluation = evaluateRecord(demoConflictRecord, capturedAt);

  assert.equal(evaluation.state.state, "BLOCKED");
  assert.deepEqual(
    evaluation.state.triggeringConstraintIds,
    ["status.value_map", "quantity.positive"],
  );
  assert.deepEqual(
    evaluation.state.resolutionPlan.map(({ reactionType }) => reactionType),
    ["confirm_semantics", "correct_source_data"],
  );
  assert.equal(evaluation.release.releaseAllowed, false);
  assert.ok(evaluation.report.nextStep.startsWith("BLOCKED:"));
});

test("every blocked or confirmation reaction is traceable to a failed constraint", () => {
  const evaluation = evaluateRecord(demoConflictRecord, capturedAt, {
    contract: "order-v2-field-drift",
  });
  const failedIds = evaluation.constraints
    .filter(({ passed, severity }) => !passed && severity === "blocking")
    .map(({ id }) => id);

  assert.deepEqual(
    evaluation.state.resolutionPlan.map(({ constraintId }) => constraintId),
    failedIds,
  );

  for (const step of evaluation.state.resolutionPlan) {
    assert.ok(step.evidence.length > 0);
    assert.ok(step.safeAction.length > 0);
    assert.ok(step.resolutionProposal.length > 0);
    assert.equal(step.mutatesSource, false);
  }
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
