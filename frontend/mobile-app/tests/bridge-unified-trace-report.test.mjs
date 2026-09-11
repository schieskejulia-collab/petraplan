import test from "node:test";
import assert from "node:assert/strict";

import { demoValidRecord, demoConflictRecord } from "../.bridge-test-build/bridge-pipeline.js";
import { evaluateRecordWithInstanceProfile } from "../.bridge-test-build/bridge-profiled-evaluation.js";
import { demoOrderToCustomerEvidence } from "../.bridge-test-build/bridge-relation-demo.js";
import { buildUnifiedBridgeTraceReport } from "../.bridge-test-build/bridge-unified-trace-report.js";

function readyQueryReport(overrides = {}) {
  return {
    canonicalIntent: {
      subject: "order",
      fields: ["orderId", "customerId"],
      predicates: ["customerId eq :customerId"],
      semanticStatus: "confirmed",
    },
    translation: {
      status: "ready",
      dialect: "postgresql",
      mappedSubject: "orders",
      fieldMappings: ["orderId -> AUFTRAGS_NR", "customerId -> KUNDEN_NR"],
      translatedRepresentation: 'SELECT "AUFTRAGS_NR", "KUNDEN_NR" FROM "orders" WHERE "KUNDEN_NR" = :customerId',
      parameterNames: ["customerId"],
    },
    access: {
      status: "ready",
      readAllowed: true,
      refreshRequired: false,
    },
    execution: {
      status: "ready",
      executable: true,
      releasedQueryText: 'SELECT "AUFTRAGS_NR", "KUNDEN_NR" FROM "orders" WHERE "KUNDEN_NR" = :customerId',
    },
    trace: [
      { step: "canonical_intent", status: "confirmed", summary: "intent confirmed", evidence: ["intent:evidence"] },
      { step: "mapping", status: "confirmed", summary: "mapping confirmed", evidence: ["mapping:evidence"] },
      { step: "dialect", status: "confirmed", summary: "dialect confirmed", evidence: ["dialect:evidence"] },
      { step: "read_access", status: "confirmed", summary: "read access ready", evidence: ["access:evidence"] },
      { step: "execution_gate", status: "confirmed", summary: "query released", evidence: ["gate:evidence"] },
    ],
    blockers: [],
    evidence: ["intent:evidence", "mapping:evidence", "dialect:evidence", "access:evidence", "gate:evidence"],
    sourcePolicy: "preserve",
    writePolicy: "forbidden",
    reportPolicy: "explain_query_without_inventing_semantics",
    conclusion: "ready",
    ...overrides,
  };
}

function validBridge() {
  return evaluateRecordWithInstanceProfile(
    demoValidRecord,
    "2026-09-11T20:00:00.000Z",
    {},
    {},
    [demoOrderToCustomerEvidence],
  );
}

test("merges provenance, bridge findings and query trace into one evidence path", () => {
  const bridge = validBridge();
  const report = buildUnifiedBridgeTraceReport({ bridge, query: readyQueryReport() });

  assert.equal(report.decision.status, "ready");
  assert.equal(report.decision.bridgeReleaseAllowed, true);
  assert.equal(report.decision.queryExecutable, true);
  assert.equal(report.identity.snapshotId, bridge.provenance.metadata.sourceSnapshotId);
  assert.equal(report.writePolicy, "forbidden");
  assert.equal(report.methodPolicy, "report_aggregation_only_no_new_public_phase");
  assert.ok(report.evidencePath.some(({ domain }) => domain === "source_provenance"));
  assert.ok(report.evidencePath.some(({ domain }) => domain === "bridge_analysis"));
  assert.ok(report.evidencePath.some(({ domain }) => domain === "instance_relations"));
  assert.ok(report.evidencePath.some(({ domain }) => domain === "query_read"));
});

test("refresh requirement stays visible and is not upgraded by a valid bridge release", () => {
  const query = readyQueryReport({
    access: { status: "refresh_required", readAllowed: false, refreshRequired: true },
    execution: { status: "refresh_required", executable: false, releasedQueryText: null },
    blockers: ["snapshot stale"],
  });

  const report = buildUnifiedBridgeTraceReport({ bridge: validBridge(), query });

  assert.equal(report.decision.status, "refresh_required");
  assert.equal(report.decision.queryExecutable, false);
  assert.ok(report.openPoints.includes("snapshot stale"));
});

test("a blocking bridge decision cannot be overwritten by a ready query", () => {
  const bridge = evaluateRecordWithInstanceProfile(
    demoConflictRecord,
    "2026-09-11T20:00:00.000Z",
    {},
    {},
    [demoOrderToCustomerEvidence],
  );

  const report = buildUnifiedBridgeTraceReport({ bridge, query: readyQueryReport() });

  assert.equal(bridge.release.releaseAllowed, false);
  assert.equal(report.decision.status, "blocked");
  assert.equal(report.decision.queryExecutable, true);
  assert.match(report.conclusion, /überschreibt keine blockierende Bridge-/);
});

test("query trace carries parameter names only", () => {
  const report = buildUnifiedBridgeTraceReport({ bridge: validBridge(), query: readyQueryReport() });

  assert.deepEqual(report.queryReport.translation.parameterNames, ["customerId"]);
  assert.equal("parameterValues" in report.queryReport.translation, false);
});
