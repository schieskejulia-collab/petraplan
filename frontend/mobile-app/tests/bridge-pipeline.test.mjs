import test from "node:test";
import assert from "node:assert/strict";
import {
  demoConflictRecord,
  demoValidRecord,
  evaluateRecord,
} from "../.bridge-test-build/bridge-pipeline.js";

const capturedAt = "2026-09-07T14:00:00.000Z";

function dataBlockingIssues(evaluation) {
  return evaluation.issues.filter(({ severity }) => severity === "blocking");
}

function totalBlockingIssues(evaluation) {
  return dataBlockingIssues(evaluation).length + evaluation.gatewayIssues.length;
}

test("valid case stays consistent from interface contract through report", () => {
  const evaluation = evaluateRecord(demoValidRecord, capturedAt);
  const messageId = `msg:system_a:A-10027:${capturedAt}`;

  assert.deepEqual(evaluation.ingress, {
    source: "system_a",
    transport: "demo",
    messageId,
    receivedAt: capturedAt,
    destination: "bridge",
    service: "orders-service",
    operation: "receiveOrder",
    interactionMode: "request_reply",
    correlationId: `corr:${messageId}`,
    contract: "order-v1",
    transportStatus: "received",
  });
  assert.equal(evaluation.contract.name, "order-v1");
  assert.equal(evaluation.schema.every(({ present, typeOk, formatOk }) => present && typeOk && formatOk), true);
  assert.equal(evaluation.gatewayIssues.length, 0);
  assert.deepEqual(evaluation.snapshot.ingress, evaluation.ingress);
  assert.deepEqual(evaluation.snapshot.values, demoValidRecord);
  assert.deepEqual(evaluation.mapped, {
    customerId: "4711",
    orderId: "A-10027",
    status: "open",
    quantity: 12,
    orderDate: "2026-09-07",
  });

  assert.equal(dataBlockingIssues(evaluation).length, 0);
  assert.equal(evaluation.release.blockingIssues, 0);
  assert.equal(evaluation.release.releaseAllowed, true);
  assert.equal(evaluation.report.errors.length, 0);
  assert.equal(evaluation.provenance.contract, "order-v1");
  assert.equal(evaluation.provenance.transportStatus, "received");

  const dateTrace = evaluation.trace.find(({ sourceField }) => sourceField === "DATUM");
  assert.equal(dateTrace?.sourceValue, "07.09.2026");
  assert.equal(dateTrace?.canonicalValue, "2026-09-07");
  assert.equal(dateTrace?.validation, "passed");
});

test("custom interface context is preserved without changing source values", () => {
  const evaluation = evaluateRecord(demoValidRecord, capturedAt, {
    source: "legacy_orders",
    transport: "queue",
    messageId: "queue-msg-4711",
    destination: "petraplan-bridge",
    service: "legacy-order-service",
    operation: "pushOrder",
    interactionMode: "async",
    correlationId: "corr-4711",
    contract: "order-v1",
    transportStatus: "received",
  });

  assert.deepEqual(evaluation.snapshot.values, demoValidRecord);
  assert.equal(evaluation.ingress.source, "legacy_orders");
  assert.equal(evaluation.ingress.transport, "queue");
  assert.equal(evaluation.ingress.service, "legacy-order-service");
  assert.equal(evaluation.ingress.operation, "pushOrder");
  assert.equal(evaluation.ingress.interactionMode, "async");
  assert.equal(evaluation.ingress.correlationId, "corr-4711");
  assert.equal(evaluation.provenance.source, "legacy_orders");
  assert.equal(evaluation.provenance.transport, "queue");
  assert.equal(evaluation.release.releaseAllowed, true);
});

test("transport timeout is a separate blocking issue and does not mutate valid data", () => {
  const evaluation = evaluateRecord(demoValidRecord, capturedAt, {
    transport: "webservice",
    transportStatus: "timeout",
  });

  assert.deepEqual(evaluation.snapshot.values, demoValidRecord);
  assert.equal(dataBlockingIssues(evaluation).length, 0);
  assert.equal(evaluation.gatewayIssues.length, 1);
  assert.equal(evaluation.gatewayIssues[0].scope, "transport");
  assert.equal(evaluation.gatewayIssues[0].issue, "TRANSPORT_TIMEOUT");
  assert.equal(evaluation.release.blockingIssues, 1);
  assert.equal(evaluation.release.releaseAllowed, false);
  assert.equal(evaluation.report.errors.length, 1);
});

test("unknown interface contract blocks release independently of data validation", () => {
  const evaluation = evaluateRecord(demoValidRecord, capturedAt, {
    contract: "order-v2-unconfirmed",
  });

  assert.equal(dataBlockingIssues(evaluation).length, 0);
  assert.equal(evaluation.gatewayIssues.length, 1);
  assert.equal(evaluation.gatewayIssues[0].scope, "contract");
  assert.equal(evaluation.gatewayIssues[0].issue, "UNKNOWN_CONTRACT");
  assert.equal(evaluation.release.blockingIssues, 1);
  assert.equal(evaluation.release.releaseAllowed, false);
});

test("conflict case creates exactly two data blockers and blocks release", () => {
  const evaluation = evaluateRecord(demoConflictRecord, capturedAt);
  const blocking = dataBlockingIssues(evaluation);

  assert.deepEqual(evaluation.snapshot.values, demoConflictRecord);
  assert.equal(evaluation.gatewayIssues.length, 0);
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

test("release gate always matches transport, contract and data blockers", () => {
  const cases = [
    evaluateRecord(demoValidRecord, capturedAt),
    evaluateRecord(demoConflictRecord, capturedAt),
    evaluateRecord(demoValidRecord, capturedAt, { transportStatus: "timeout" }),
    evaluateRecord(demoValidRecord, capturedAt, { contract: "unknown-contract" }),
  ];

  for (const evaluation of cases) {
    const blocking = totalBlockingIssues(evaluation);
    assert.equal(evaluation.release.blockingIssues, blocking);
    assert.equal(evaluation.release.releaseAllowed, blocking === 0);
    assert.equal(evaluation.report.errors.length, blocking);
  }
});
