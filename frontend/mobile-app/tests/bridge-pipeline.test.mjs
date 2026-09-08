import test from "node:test";
import assert from "node:assert/strict";
import {
  demoConflictRecord,
  demoValidRecord,
  evaluateRecord,
} from "../.bridge-test-build/bridge-pipeline.js";
import {
  blockingConstraintFailures,
  decideFromConstraints,
  evaluateBridgeConstraints,
} from "../.bridge-test-build/bridge-constraints.js";

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

  assert.equal(evaluation.ingress.messageId, messageId);
  assert.equal(evaluation.ingress.correlationId, `corr:${messageId}`);
  assert.equal(evaluation.contract.name, "order-v1");
  assert.equal(evaluation.schema.every(({ present, typeOk, formatOk }) => present && typeOk && formatOk), true);
  assert.equal(evaluation.gatewayIssues.length, 0);
  assert.deepEqual(evaluation.snapshot.values, demoValidRecord);
  assert.deepEqual(evaluation.mapped, {
    customerId: "4711",
    orderId: "A-10027",
    status: "open",
    quantity: 12,
    orderDate: "2026-09-07",
  });

  assert.equal(evaluation.interactionTrace.request.recordId, "A-10027");
  assert.equal(evaluation.interactionTrace.request.messageId, messageId);
  assert.equal(evaluation.interactionTrace.correlationId, `corr:${messageId}`);
  assert.equal(evaluation.interactionTrace.response.status, "pending");
  assert.equal(evaluation.interactionTrace.response.messageId, null);

  assert.equal(dataBlockingIssues(evaluation).length, 0);
  assert.equal(evaluation.release.blockingIssues, 0);
  assert.equal(evaluation.release.releaseAllowed, true);
  assert.equal(evaluation.report.errors.length, 0);
});

test("request and response stay linked by correlation id", () => {
  const evaluation = evaluateRecord(
    demoValidRecord,
    capturedAt,
    {
      transport: "webservice",
      interactionMode: "request_reply",
      messageId: "request-msg-10027",
      correlationId: "corr-A-10027",
    },
    {
      status: "received",
      messageId: "response-msg-10027",
      respondedAt: "2026-09-07T14:00:02.000Z",
      result: "order accepted",
    },
  );

  assert.equal(evaluation.interactionTrace.request.recordId, "A-10027");
  assert.equal(evaluation.interactionTrace.request.messageId, "request-msg-10027");
  assert.equal(evaluation.interactionTrace.correlationId, "corr-A-10027");
  assert.deepEqual(evaluation.interactionTrace.response, {
    status: "received",
    messageId: "response-msg-10027",
    respondedAt: "2026-09-07T14:00:02.000Z",
    result: "order accepted",
  });
  assert.equal(evaluation.snapshot.interactionTrace.correlationId, "corr-A-10027");
  assert.equal(evaluation.provenance.responseStatus, "received");
  assert.equal(evaluation.provenance.responseMessageId, "response-msg-10027");
  assert.equal(evaluation.release.releaseAllowed, true);
});

test("one way interaction explicitly expects no response", () => {
  const evaluation = evaluateRecord(demoValidRecord, capturedAt, {
    interactionMode: "one_way",
  });

  assert.equal(evaluation.interactionTrace.response.status, "not_expected");
  assert.equal(evaluation.interactionTrace.response.messageId, null);
  assert.equal(evaluation.release.releaseAllowed, true);
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
  assert.equal(evaluation.interactionTrace.correlationId, "corr-4711");
  assert.equal(evaluation.interactionTrace.response.status, "pending");
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
  assert.equal(evaluation.gatewayIssues[0].issue, "TRANSPORT_TIMEOUT");
  assert.equal(evaluation.release.blockingIssues, 1);
  assert.equal(evaluation.release.releaseAllowed, false);
});

test("unknown interface contract blocks release independently of data validation", () => {
  const evaluation = evaluateRecord(demoValidRecord, capturedAt, {
    contract: "order-v2-unconfirmed",
  });

  assert.equal(dataBlockingIssues(evaluation).length, 0);
  assert.equal(evaluation.gatewayIssues.length, 1);
  assert.equal(evaluation.gatewayIssues[0].issue, "UNKNOWN_CONTRACT");
  assert.equal(evaluation.release.releaseAllowed, false);
});

test("conflict case creates exactly two data blockers and blocks release", () => {
  const evaluation = evaluateRecord(demoConflictRecord, capturedAt);
  const blocking = dataBlockingIssues(evaluation);

  assert.deepEqual(evaluation.snapshot.values, demoConflictRecord);
  assert.equal(evaluation.gatewayIssues.length, 0);
  assert.equal(evaluation.mapped.status, null);
  assert.equal(evaluation.mapped.quantity, -4);
  assert.equal(blocking.length, 2);
  assert.equal(evaluation.release.blockingIssues, 2);
  assert.equal(evaluation.release.releaseAllowed, false);
});

test("full entanglement demo can never report blockers while allowing release", () => {
  const evaluation = evaluateRecord(
    demoConflictRecord,
    capturedAt,
    {
      source: "legacy_orders",
      transport: "webservice",
      service: "legacy-order-service",
      operation: "pushOrder",
      interactionMode: "request_reply",
      contract: "order-v2-field-drift",
      transportStatus: "received",
      messageId: `request:A-10027:${capturedAt}`,
      correlationId: "corr:A-10027:demo",
      destination: "petraplan-bridge",
    },
    { status: "pending", messageId: null, respondedAt: null, result: null },
  );

  const blocking = totalBlockingIssues(evaluation);
  assert.equal(blocking, 3);
  assert.equal(evaluation.report.errors.length, 3);
  assert.equal(evaluation.release.blockingIssues, 3);
  assert.equal(evaluation.release.releaseAllowed, false);
  assert.equal(evaluation.report.errors.length > 0 && evaluation.release.releaseAllowed, false);
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
    assert.equal(evaluation.report.errors.length > 0 && evaluation.release.releaseAllowed, false);
  }
});

test("constraint model gives every rule evidence, safe action and resolution proposal", () => {
  const results = evaluateBridgeConstraints(evaluateRecord(demoConflictRecord, capturedAt));
  const failures = blockingConstraintFailures(results);

  assert.equal(results.length, 8);
  assert.equal(failures.length, 2);
  assert.deepEqual(failures.map(({ id }) => id), ["status.value_map", "quantity.positive"]);

  for (const result of results) {
    assert.ok(result.rule.length > 0);
    assert.ok(result.evidence.length > 0);
    assert.ok(result.safeAction.length > 0);
    assert.ok(result.resolutionProposal.length > 0);
  }
});

test("constraint model separates contract, semantics and data conflicts", () => {
  const evaluation = evaluateRecord(demoConflictRecord, capturedAt, {
    contract: "order-v2-field-drift",
  });
  const failures = blockingConstraintFailures(evaluateBridgeConstraints(evaluation));

  assert.deepEqual(
    failures.map(({ id, category }) => [id, category]),
    [
      ["contract.version", "contract"],
      ["status.value_map", "semantics"],
      ["quantity.positive", "data"],
    ],
  );
  assert.equal(failures.length, evaluation.release.blockingIssues);
});

test("constraint decision independently matches the release gate for representative cases", () => {
  const cases = [
    evaluateRecord(demoValidRecord, capturedAt),
    evaluateRecord(demoConflictRecord, capturedAt),
    evaluateRecord(demoValidRecord, capturedAt, { transportStatus: "timeout" }),
    evaluateRecord(demoValidRecord, capturedAt, { contract: "unknown-contract" }),
    evaluateRecord({ ...demoValidRecord, KUNDEN_NR: "" }, capturedAt),
    evaluateRecord({ ...demoValidRecord, DATUM: "09/07/2026" }, capturedAt),
  ];

  for (const evaluation of cases) {
    const results = evaluateBridgeConstraints(evaluation);
    const decision = decideFromConstraints(results);

    assert.equal(decision.releaseAllowed, evaluation.release.releaseAllowed);
    assert.equal(decision.blockingIssues, evaluation.release.blockingIssues);
    assert.equal(decision.blockingIssues, evaluation.report.errors.length);
    assert.equal(decision.failedConstraintIds.length, decision.blockingIssues);
    if (!decision.releaseAllowed) assert.ok(decision.resolutionProposals.length > 0);
  }
});
