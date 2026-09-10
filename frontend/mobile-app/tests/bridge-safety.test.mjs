import test from "node:test";
import assert from "node:assert/strict";
import {
  demoValidRecord,
  evaluateRecord,
} from "../.bridge-test-build/bridge-pipeline.js";

const capturedAt = "2026-09-10T07:00:00.000Z";

const safetyCases = [
  {
    name: "missing customer blocks release",
    raw: { ...demoValidRecord, KUNDEN_NR: "" },
    expectedState: "BLOCKED",
    expectedConstraint: "customer.required",
  },
  {
    name: "unknown status requires confirmation",
    raw: { ...demoValidRecord, STATUS: "UNBEKANNT" },
    expectedState: "NEEDS_CONFIRMATION",
    expectedConstraint: "status.value_map",
  },
  {
    name: "zero quantity blocks release",
    raw: { ...demoValidRecord, MENGE: "0" },
    expectedState: "BLOCKED",
    expectedConstraint: "quantity.positive",
  },
  {
    name: "negative quantity blocks release",
    raw: { ...demoValidRecord, MENGE: "-4" },
    expectedState: "BLOCKED",
    expectedConstraint: "quantity.positive",
  },
  {
    name: "non numeric quantity blocks through schema and data validation",
    raw: { ...demoValidRecord, MENGE: "abc" },
    expectedState: "BLOCKED",
    expectedConstraint: "quantity.positive",
  },
  {
    name: "unconfirmed date format blocks release",
    raw: { ...demoValidRecord, DATUM: "09/10/2026" },
    expectedState: "BLOCKED",
    expectedConstraint: "date.canonical",
  },
];

for (const safetyCase of safetyCases) {
  test(safetyCase.name, () => {
    const evaluation = evaluateRecord(safetyCase.raw, capturedAt);

    assert.equal(evaluation.release.releaseAllowed, false);
    assert.equal(evaluation.state.releaseAllowed, false);
    assert.equal(evaluation.state.state, safetyCase.expectedState);
    assert.ok(evaluation.state.triggeringConstraintIds.includes(safetyCase.expectedConstraint));
    assert.deepEqual(evaluation.snapshot.values, safetyCase.raw);
  });
}

test("transport timeout never releases otherwise valid data", () => {
  const evaluation = evaluateRecord(demoValidRecord, capturedAt, {
    transport: "webservice",
    transportStatus: "timeout",
  });

  assert.equal(evaluation.state.state, "BLOCKED");
  assert.equal(evaluation.release.releaseAllowed, false);
  assert.deepEqual(evaluation.snapshot.values, demoValidRecord);
  assert.ok(evaluation.state.triggeringConstraintIds.includes("transport.received"));
});

test("failed transport never releases otherwise valid data", () => {
  const evaluation = evaluateRecord(demoValidRecord, capturedAt, {
    transportStatus: "failed",
  });

  assert.equal(evaluation.state.state, "BLOCKED");
  assert.equal(evaluation.release.releaseAllowed, false);
  assert.ok(evaluation.state.triggeringConstraintIds.includes("transport.received"));
});

test("unknown contract never releases otherwise valid data", () => {
  const evaluation = evaluateRecord(demoValidRecord, capturedAt, {
    contract: "order-v2-unknown",
  });

  assert.equal(evaluation.state.state, "NEEDS_CONFIRMATION");
  assert.equal(evaluation.release.releaseAllowed, false);
  assert.ok(evaluation.state.triggeringConstraintIds.includes("contract.version"));
});

test("warning-only demo reference mismatch does not become a false blocker", () => {
  const raw = { ...demoValidRecord, AUFTRAGS_NR: "A-99999" };
  const evaluation = evaluateRecord(raw, capturedAt);

  assert.equal(evaluation.release.releaseAllowed, true);
  assert.equal(evaluation.state.state, "VALID");
  assert.equal(evaluation.report.errors.length, 0);
  assert.ok(evaluation.report.openPoints.length >= 1);
  assert.deepEqual(evaluation.snapshot.values, raw);
});

test("mixed semantic and hard-data problems fail safe as BLOCKED", () => {
  const raw = { ...demoValidRecord, STATUS: "UNBEKANNT", MENGE: "-4" };
  const evaluation = evaluateRecord(raw, capturedAt);

  assert.equal(evaluation.state.state, "BLOCKED");
  assert.equal(evaluation.release.releaseAllowed, false);
  assert.ok(evaluation.state.triggeringConstraintIds.includes("status.value_map"));
  assert.ok(evaluation.state.triggeringConstraintIds.includes("quantity.positive"));
  assert.deepEqual(evaluation.snapshot.values, raw);
});

test("multiple independent blockers can never collapse into VALID", () => {
  const raw = {
    ...demoValidRecord,
    KUNDEN_NR: "",
    STATUS: "UNBEKANNT",
    MENGE: "-4",
    DATUM: "bad-date",
  };
  const evaluation = evaluateRecord(raw, capturedAt, {
    transportStatus: "timeout",
    contract: "unknown-contract",
  });

  assert.equal(evaluation.state.state, "BLOCKED");
  assert.equal(evaluation.release.releaseAllowed, false);
  assert.ok(evaluation.release.blockingIssues >= 5);
  assert.equal(evaluation.report.errors.length, evaluation.release.blockingIssues);
  assert.deepEqual(evaluation.snapshot.values, raw);
});

test("every non-valid state produces only non-mutating resolution steps", () => {
  const cases = [
    evaluateRecord({ ...demoValidRecord, STATUS: "UNBEKANNT" }, capturedAt),
    evaluateRecord({ ...demoValidRecord, MENGE: "-4" }, capturedAt),
    evaluateRecord(demoValidRecord, capturedAt, { contract: "unknown-contract" }),
    evaluateRecord(demoValidRecord, capturedAt, { transportStatus: "timeout" }),
  ];

  for (const evaluation of cases) {
    assert.notEqual(evaluation.state.state, "VALID");
    assert.equal(evaluation.release.releaseAllowed, false);
    assert.ok(evaluation.state.resolutionPlan.length > 0);
    for (const step of evaluation.state.resolutionPlan) {
      assert.equal(step.mutatesSource, false);
      assert.ok(step.evidence.length > 0);
      assert.ok(step.safeAction.length > 0);
      assert.ok(step.resolutionProposal.length > 0);
    }
  }
});

test("VALID is only possible when all blocking constraints pass", () => {
  const evaluation = evaluateRecord(demoValidRecord, capturedAt);
  const failedBlocking = evaluation.constraints.filter(({ passed, severity }) => !passed && severity === "blocking");

  assert.equal(failedBlocking.length, 0);
  assert.equal(evaluation.state.state, "VALID");
  assert.equal(evaluation.release.releaseAllowed, true);
});
