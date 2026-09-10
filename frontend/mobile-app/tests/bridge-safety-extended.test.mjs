import test from "node:test";
import assert from "node:assert/strict";
import {
  demoValidRecord,
  evaluateRecord,
} from "../.bridge-test-build/bridge-pipeline.js";

const capturedAt = "2026-09-10T12:45:00.000Z";

const cases = [
  {
    name: "NULL customer marker blocks release",
    raw: { ...demoValidRecord, KUNDEN_NR: "NULL" },
    state: "BLOCKED",
    constraint: "customer.required",
  },
  {
    name: "case-insensitive N/A customer marker blocks release",
    raw: { ...demoValidRecord, KUNDEN_NR: " n/a " },
    state: "BLOCKED",
    constraint: "customer.required",
  },
  {
    name: "whitespace-only customer blocks release",
    raw: { ...demoValidRecord, KUNDEN_NR: "   " },
    state: "BLOCKED",
    constraint: "customer.required",
  },
  {
    name: "lowercase status is not silently normalized",
    raw: { ...demoValidRecord, STATUS: "offen" },
    state: "NEEDS_CONFIRMATION",
    constraint: "status.value_map",
  },
  {
    name: "status with trailing whitespace is not silently normalized",
    raw: { ...demoValidRecord, STATUS: "OFFEN " },
    state: "NEEDS_CONFIRMATION",
    constraint: "status.value_map",
  },
  {
    name: "NULL quantity marker blocks release",
    raw: { ...demoValidRecord, MENGE: "NULL" },
    state: "BLOCKED",
    constraint: "quantity.positive",
  },
  {
    name: "whitespace-only quantity blocks release",
    raw: { ...demoValidRecord, MENGE: "   " },
    state: "BLOCKED",
    constraint: "quantity.positive",
  },
  {
    name: "plus-prefixed quantity requires contract confirmation instead of silent acceptance",
    raw: { ...demoValidRecord, MENGE: "+4" },
    state: "NEEDS_CONFIRMATION",
    constraint: "contract.schema",
  },
  {
    name: "exponential quantity requires contract confirmation instead of silent acceptance",
    raw: { ...demoValidRecord, MENGE: "1e3" },
    state: "NEEDS_CONFIRMATION",
    constraint: "contract.schema",
  },
  {
    name: "malformed order id requires contract confirmation",
    raw: { ...demoValidRecord, AUFTRAGS_NR: "10027" },
    state: "NEEDS_CONFIRMATION",
    constraint: "contract.schema",
  },
  {
    name: "impossible ISO month blocks release",
    raw: { ...demoValidRecord, DATUM: "2026-13-01" },
    state: "BLOCKED",
    constraint: "date.canonical",
  },
  {
    name: "impossible February day blocks release",
    raw: { ...demoValidRecord, DATUM: "31.02.2026" },
    state: "BLOCKED",
    constraint: "date.canonical",
  },
  {
    name: "non-leap-year February 29 blocks release",
    raw: { ...demoValidRecord, DATUM: "29.02.2026" },
    state: "BLOCKED",
    constraint: "date.canonical",
  },
  {
    name: "real leap-day date is accepted",
    raw: { ...demoValidRecord, DATUM: "29.02.2024" },
    state: "VALID",
    constraint: null,
  },
  {
    name: "confirmed GESCHLOSSEN mapping remains valid",
    raw: { ...demoValidRecord, STATUS: "GESCHLOSSEN" },
    state: "VALID",
    constraint: null,
  },
  {
    name: "confirmed in-progress status and positive decimal quantity remain valid",
    raw: {
      ...demoValidRecord,
      STATUS: "IN_BEARBEITUNG",
      MENGE: "0.5",
      DATUM: "2026-09-07",
    },
    state: "VALID",
    constraint: null,
  },
];

assert.equal(cases.length, 16);

for (const safetyCase of cases) {
  test(safetyCase.name, () => {
    const evaluation = evaluateRecord(safetyCase.raw, capturedAt);

    assert.equal(evaluation.state.state, safetyCase.state);
    assert.equal(evaluation.release.releaseAllowed, safetyCase.state === "VALID");
    assert.deepEqual(evaluation.snapshot.values, safetyCase.raw);

    if (safetyCase.constraint) {
      assert.ok(
        evaluation.state.triggeringConstraintIds.includes(safetyCase.constraint),
        `expected ${safetyCase.constraint} in ${evaluation.state.triggeringConstraintIds.join(", ")}`,
      );
    } else {
      assert.equal(evaluation.state.triggeringConstraintIds.length, 0);
    }
  });
}
