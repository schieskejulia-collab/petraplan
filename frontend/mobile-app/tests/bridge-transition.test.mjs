import test from "node:test";
import assert from "node:assert/strict";
import {
  demoValidRecord,
  evaluateRecord,
} from "../.bridge-test-build/bridge-pipeline.js";
import {
  recordBridgeTransition,
} from "../.bridge-test-build/bridge-transition.js";

const capturedAt = "2026-09-07T14:00:00.000Z";

test("confirmed contract moves NEEDS_CONFIRMATION to VALID without changing source", () => {
  const before = evaluateRecord(demoValidRecord, capturedAt, {
    contract: "order-v2-unconfirmed",
  });
  const after = evaluateRecord(demoValidRecord, capturedAt, {
    contract: "order-v1",
  });

  const transition = recordBridgeTransition(before, after);

  assert.equal(before.state.state, "NEEDS_CONFIRMATION");
  assert.equal(after.state.state, "VALID");
  assert.equal(transition.outcome, "RESOLVED");
  assert.equal(transition.sourceChanged, false);
  assert.deepEqual(transition.sourceChangeFields, []);
  assert.deepEqual(transition.resolvedConstraintIds, ["contract.version"]);
  assert.deepEqual(transition.appliedReactionTypes, ["confirm_contract"]);
  assert.equal(transition.releaseAllowed, true);
});

test("confirmed source correction moves BLOCKED to VALID and records changed field", () => {
  const before = evaluateRecord({ ...demoValidRecord, MENGE: "-4" }, capturedAt);
  const after = evaluateRecord({ ...demoValidRecord, MENGE: "4" }, capturedAt);

  const transition = recordBridgeTransition(before, after);

  assert.equal(before.state.state, "BLOCKED");
  assert.equal(after.state.state, "VALID");
  assert.equal(transition.outcome, "RESOLVED");
  assert.equal(transition.sourceChanged, true);
  assert.deepEqual(transition.sourceChangeFields, ["MENGE"]);
  assert.deepEqual(transition.resolvedConstraintIds, ["quantity.positive"]);
  assert.deepEqual(transition.appliedReactionTypes, ["correct_source_data"]);
  assert.equal(transition.releaseAllowed, true);
});

test("partial correction records progress but does not claim the knot is resolved", () => {
  const before = evaluateRecord({ ...demoValidRecord, STATUS: "UNBEKANNT", MENGE: "-4" }, capturedAt);
  const after = evaluateRecord({ ...demoValidRecord, STATUS: "UNBEKANNT", MENGE: "4" }, capturedAt);

  const transition = recordBridgeTransition(before, after);

  assert.equal(transition.fromState, "BLOCKED");
  assert.equal(transition.toState, "NEEDS_CONFIRMATION");
  assert.equal(transition.outcome, "PROGRESSED");
  assert.deepEqual(transition.resolvedConstraintIds, ["quantity.positive"]);
  assert.deepEqual(transition.remainingConstraintIds, ["status.value_map"]);
  assert.equal(transition.releaseAllowed, false);
});

test("new blocker after reevaluation is recorded as regression", () => {
  const before = evaluateRecord({ ...demoValidRecord, STATUS: "UNBEKANNT" }, capturedAt);
  const after = evaluateRecord({ ...demoValidRecord, STATUS: "UNBEKANNT", MENGE: "-4" }, capturedAt);

  const transition = recordBridgeTransition(before, after);

  assert.equal(transition.outcome, "REGRESSED");
  assert.deepEqual(transition.remainingConstraintIds, ["status.value_map"]);
  assert.deepEqual(transition.newConstraintIds, ["quantity.positive"]);
  assert.equal(transition.releaseAllowed, false);
});

test("unchanged reevaluation cannot become VALID by assumption", () => {
  const before = evaluateRecord({ ...demoValidRecord, STATUS: "UNBEKANNT" }, capturedAt);
  const after = evaluateRecord({ ...demoValidRecord, STATUS: "UNBEKANNT" }, capturedAt);

  const transition = recordBridgeTransition(before, after);

  assert.equal(transition.outcome, "UNCHANGED");
  assert.equal(transition.toState, "NEEDS_CONFIRMATION");
  assert.equal(transition.releaseAllowed, false);
  assert.deepEqual(transition.resolvedConstraintIds, []);
});
