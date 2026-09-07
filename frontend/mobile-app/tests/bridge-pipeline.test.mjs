import test from "node:test";
import assert from "node:assert/strict";
import {
  demoConflictRecord,
  demoValidRecord,
  evaluateRecord,
} from "../.bridge-test-build/bridge-pipeline.js";

const capturedAt = "2026-09-07T14:00:00.000Z";

function blockingIssues(evaluation) {
  return evaluation.issues.filter(({ severity }) => severity === "blocking");
}

test("valid case stays consistent from ingress through report", () => {
  const evaluation = evaluateRecord(demoValidRecord, capturedAt);

  assert.deepEqual(evaluation.ingress, {
    source: "system_a",
    transport: "demo",
    messageId: `msg:system_a:A-10027:${capturedAt}`,
    receivedAt: capturedAt,
    destination: "bridge",
  });
  assert.deepEqual(evaluation.snapshot.ingress, evaluation.ingress);
  assert.deepEqual(evaluation.snapshot.values, demoValidRecord);
  assert.deepEqual(evaluation.mapped, {
    customerId: "4711",
    orderId: "A-10027",
    status: "open",
    quantity: 12,
    orderDate: "2026-09-07",
  });

  assert.equal(blockingIssues(evaluation).length, 0);
  assert.equal(evaluation.release.blockingIssues, 0);
  assert.equal(evaluation.release.releaseAllowed, true);
  assert.equal(evaluation.report.errors.length, 0);
  assert.equal(evaluation.provenance.transport, "demo");
  assert.equal(evaluation.provenance.messageId, evaluation.ingress.messageId);

  const dateTrace = evaluation.trace.find(({ sourceField }) => sourceField === "DATUM");
  assert.equal(dateTrace?.sourceValue, "07.09.2026");
  assert.equal(dateTrace?.canonicalValue, "2026-09-07");
  assert.equal(dateTrace?.validation, "passed");
});

test("custom ingress context is preserved without changing source values", () => {
  const evaluation = evaluateRecord(demoValidRecord, capturedAt, {
    source: "legacy_orders",
    transport: "queue",
    messageId: "queue-msg-4711",
    destination: "petraplan-bridge",
  });

  assert.deepEqual(evaluation.snapshot.values, demoValidRecord);
  assert.equal(evaluation.ingress.source, "legacy_orders");
  assert.equal(evaluation.ingress.transport, "queue");
  assert.equal(evaluation.ingress.messageId, "queue-msg-4711");
  assert.equal(evaluation.ingress.receivedAt, capturedAt);
  assert.equal(evaluation.ingress.destination, "petraplan-bridge");
  assert.equal(evaluation.provenance.source, "legacy_orders");
  assert.equal(evaluation.provenance.transport, "queue");
  assert.equal(evaluation.release.releaseAllowed, true);
});

test("conflict case creates exactly two blocking issues and blocks release", () => {
  const evaluation = evaluateRecord(demoConflictRecord, capturedAt);
  const blocking = blockingIssues(evaluation);

  assert.deepEqual(evaluation.snapshot.values, demoConflictRecord);
  assert.equal(evaluation.mapped.status, null);
  assert.equal(evaluation.mapped.quantity, -4);
  assert.equal(evaluation.mapped.orderDate, "2026-09-07");

  assert.equal(blocking.length, 2);
  assert.deepEqual(blocking.map(({ issue }) => issue).sort(), ["NEGATIVE_VALUE", "UNKNOWN_STATUS"]);
  assert.equal(evaluation.release.blockingIssues, 2);
  assert.equal(evaluation.release.releaseAllowed, false);
  assert.equal(evaluation.report.errors.length, 2);

  const statusTrace = evaluation.trace.find(({ sourceField }) => sourceField === "STATUS");
  const quantityTrace = evaluation.trace.find(({ sourceField }) => sourceField === "MENGE");
  const dateTrace = evaluation.trace.find(({ sourceField }) => sourceField === "DATUM");

  assert.equal(statusTrace?.validation, "failed");
  assert.equal(quantityTrace?.validation, "failed");
  assert.equal(dateTrace?.validation, "passed");
});

test("release gate always matches failed blocking validation checks", () => {
  for (const record of [demoValidRecord, demoConflictRecord]) {
    const evaluation = evaluateRecord(record, capturedAt);
    const failedBlockingChecks = evaluation.checks.filter(
      ({ ok, severity }) => !ok && severity === "blocking",
    );

    assert.equal(evaluation.release.blockingIssues, failedBlockingChecks.length);
    assert.equal(evaluation.release.releaseAllowed, failedBlockingChecks.length === 0);
    assert.equal(evaluation.report.errors.length, failedBlockingChecks.length);
  }
});
