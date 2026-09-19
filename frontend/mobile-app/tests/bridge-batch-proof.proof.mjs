import test from "node:test";
import assert from "node:assert/strict";
import { evaluateBatch } from "../.bridge-batch-build/bridge-batch-evaluation.js";

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
  { raw: { KUNDEN_NR: "4711", AUFTRAGS_NR: "A-10027", STATUS: "OFFEN", MENGE: "12", DATUM: "2026-09-19" }, capturedAt, ingress: ingress("valid-1") },
  { raw: { KUNDEN_NR: "8150", AUFTRAGS_NR: "A-10027", STATUS: "GESCHLOSSEN", MENGE: "3", DATUM: "19.09.2026" }, capturedAt, ingress: ingress("valid-2") },
  { raw: { KUNDEN_NR: "9001", AUFTRAGS_NR: "A-10027", STATUS: "A", MENGE: "5", DATUM: "2026-09-19" }, capturedAt, ingress: ingress("ambiguous-status") },
  {
    raw: { KUNDEN_NR: "ALFKI", AUFTRAGS_NR: "A-10027", STATUS: "OFFEN", MENGE: "9", DATUM: "2026-09-19" }, capturedAt, ingress: ingress("customer-conflict"),
    conflicts: [{ field: "KUNDEN_NR", code: "CUSTOMER_MISMATCH", message: "Customer.CustomerID=VINET widerspricht Order.CustomerID=ALFKI.", blocking: true }],
  },
  { raw: { KUNDEN_NR: "7777", AUFTRAGS_NR: "A-10027", STATUS: "IN_BEARBEITUNG", MENGE: "-4", DATUM: "2026-09-19" }, capturedAt, ingress: ingress("negative-quantity") },
];

test("compiled batch orchestrator isolates five mixed release decisions", () => {
  const before = structuredClone(records);
  const batch = evaluateBatch(records);
  assert.equal(batch.total, 5);
  assert.equal(batch.released, 2);
  assert.equal(batch.blocked, 3);
  assert.deepEqual(records, before);

  const [valid1, valid2, ambiguous, mismatch, negative] = batch.records;
  assert.equal(valid1.releaseAllowed, true);
  assert.equal(valid2.releaseAllowed, true);
  assert.equal(ambiguous.evaluation.raw.STATUS, "A");
  assert.equal(ambiguous.evaluation.schema.find(({ field }) => field === "STATUS").formatOk, true);
  assert.equal(ambiguous.evaluation.mapped.status, null);
  assert.equal(ambiguous.releaseAllowed, false);
  assert.ok(ambiguous.evaluation.constraints.some(({ id, passed }) => id === "status.value_map" && !passed));
  assert.equal(mismatch.releaseAllowed, false);
  assert.ok(mismatch.evaluation.constraints.some(({ id }) => id === "adapter.CUSTOMER_MISMATCH:KUNDEN_NR"));
  assert.equal(mismatch.evaluation.trace.find(({ sourceField }) => sourceField === "KUNDEN_NR").validation, "failed");
  assert.ok(mismatch.evaluation.report.errorsDetailed.some(({ origin }) => origin === "adapter"));
  assert.equal(negative.evaluation.mapped.quantity, -4);
  assert.equal(negative.releaseAllowed, false);
  assert.ok(negative.evaluation.constraints.some(({ id, passed }) => id === "quantity.positive" && !passed));
  assert.equal(valid1.evaluation.report.errors.length, 0);
  assert.equal(valid2.evaluation.report.errors.length, 0);
});
