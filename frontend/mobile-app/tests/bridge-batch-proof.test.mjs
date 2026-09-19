import test from "node:test";
import assert from "node:assert/strict";
import { evaluateRecordWithConflictTruth } from "../.bridge-test-build/bridge-conflict-truth.js";

const capturedAt = "2026-09-19T14:05:00.000Z";
const ingress = (id) => ({
  source: "batch-proof",
  transport: "file",
  destination: "petraplan-bridge",
  service: "orders",
  operation: "validateBatch",
  interactionMode: "one_way",
  correlationId: `batch-proof:${id}`,
  contract: "order-v1",
  transportStatus: "received",
});

const records = [
  { raw: { KUNDEN_NR: "4711", AUFTRAGS_NR: "A-10027", STATUS: "OFFEN", MENGE: "12", DATUM: "2026-09-19" }, conflicts: [] },
  { raw: { KUNDEN_NR: "8150", AUFTRAGS_NR: "A-10027", STATUS: "GESCHLOSSEN", MENGE: "3", DATUM: "19.09.2026" }, conflicts: [] },
  { raw: { KUNDEN_NR: "9001", AUFTRAGS_NR: "A-10027", STATUS: "A", MENGE: "5", DATUM: "2026-09-19" }, conflicts: [] },
  {
    raw: { KUNDEN_NR: "ALFKI", AUFTRAGS_NR: "A-10027", STATUS: "OFFEN", MENGE: "9", DATUM: "2026-09-19" },
    conflicts: [{ field: "KUNDEN_NR", code: "CUSTOMER_MISMATCH", message: "Customer.CustomerID=VINET widerspricht Order.CustomerID=ALFKI.", blocking: true }],
  },
  { raw: { KUNDEN_NR: "7777", AUFTRAGS_NR: "A-10027", STATUS: "IN_BEARBEITUNG", MENGE: "-4", DATUM: "2026-09-19" }, conflicts: [] },
];

test("five mixed records keep independent release decisions in the normal Bridge suite", () => {
  const before = structuredClone(records);
  const evaluations = records.map(({ raw, conflicts }, index) =>
    evaluateRecordWithConflictTruth(raw, capturedAt, ingress(`record-${index + 1}`), {}, conflicts),
  );

  assert.deepEqual(records, before, "Evaluation must preserve caller-owned Source Truth.");
  assert.deepEqual(evaluations.map(({ release }) => release.releaseAllowed), [true, true, false, false, false]);

  const [valid1, valid2, ambiguous, mismatch, negative] = evaluations;
  assert.equal(valid1.state.state, "VALID");
  assert.equal(valid2.state.state, "VALID");
  assert.equal(valid1.report.errors.length, 0);
  assert.equal(valid2.report.errors.length, 0);

  assert.equal(ambiguous.raw.STATUS, "A");
  assert.equal(ambiguous.schema.find(({ field }) => field === "STATUS").formatOk, true);
  assert.equal(ambiguous.mapped.status, null);
  assert.ok(ambiguous.constraints.some(({ id, passed }) => id === "status.value_map" && !passed));

  assert.ok(mismatch.constraints.some(({ id }) => id === "adapter.CUSTOMER_MISMATCH:KUNDEN_NR"));
  assert.equal(mismatch.trace.find(({ sourceField }) => sourceField === "KUNDEN_NR").validation, "failed");
  assert.ok(mismatch.report.errorsDetailed.some(({ origin }) => origin === "adapter"));

  assert.equal(negative.mapped.quantity, -4);
  assert.ok(negative.constraints.some(({ id, passed }) => id === "quantity.positive" && !passed));
});
