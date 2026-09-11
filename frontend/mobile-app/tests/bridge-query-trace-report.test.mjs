import test from "node:test";
import assert from "node:assert/strict";

import { buildQueryTraceReport } from "../.bridge-test-build/bridge-query-trace-report.js";

const canonicalQuery = {
  subject: "order",
  fields: ["orderId", "customerId"],
  predicates: [{ field: "customerId", operator: "eq", parameter: "customerId" }],
  semanticStatus: "confirmed",
  evidence: ["canonical intent confirmed"],
};

const binding = {
  dialect: "postgresql",
  dialectStatus: "confirmed",
  subjectAddress: "orders",
  subjectAddressStatus: "confirmed",
  fieldMap: { orderId: "AUFTRAGS_NR", customerId: "KUNDEN_NR" },
  fieldMapStatus: "confirmed",
  parameterStyle: "named",
  evidence: ["mapping and dialect confirmed"],
};

const queryPlan = {
  status: "ready",
  dialect: "postgresql",
  canonicalSubject: "order",
  mappedSubject: "orders",
  canonicalFields: ["orderId", "customerId"],
  mappedFields: ["AUFTRAGS_NR", "KUNDEN_NR"],
  queryText: 'SELECT "AUFTRAGS_NR", "KUNDEN_NR" FROM "orders" WHERE "KUNDEN_NR" = :customerId',
  parameters: ["customerId"],
  blockers: [],
  evidence: ["query translation ready"],
  sourcePolicy: "preserve",
  writePolicy: "forbidden",
  semanticPolicy: "canonical_intent_is_not_derived_from_native_syntax",
  note: "ready",
};

const readyAccess = {
  status: "ready",
  readAllowed: true,
  refreshRequired: false,
  blockers: [],
  evidence: ["read access ready"],
  sourcePolicy: "preserve",
  writePolicy: "forbidden",
  cachePolicy: "cache_never_source_truth",
  loadingPolicy: "addressable_read_only",
  note: "ready",
};

const readyGate = {
  status: "ready",
  executable: true,
  executableQueryText: queryPlan.queryText,
  parameters: ["customerId"],
  blockers: [],
  evidence: ["query gate ready"],
  sourcePolicy: "preserve",
  writePolicy: "forbidden",
  semanticPolicy: "canonical_intent_before_dialect",
  executionPolicy: "query_only_after_read_and_translation_ready",
  note: "ready",
};

test("report shows canonical intent, mapping, dialect and final release decision", () => {
  const report = buildQueryTraceReport({ canonicalQuery, binding, queryPlan, readAccess: readyAccess, queryGate: readyGate });

  assert.equal(report.execution.executable, true);
  assert.equal(report.translation.dialect, "postgresql");
  assert.deepEqual(report.translation.fieldMappings, [
    "orderId -> AUFTRAGS_NR",
    "customerId -> KUNDEN_NR",
  ]);
  assert.equal(report.trace.length, 5);
  assert.equal(report.trace[0].step, "canonical_intent");
  assert.equal(report.trace[4].step, "execution_gate");
  assert.match(report.conclusion, /Freigegeben/);
  assert.equal(report.writePolicy, "forbidden");
});

test("refresh-required report keeps translated representation visible but does not release it", () => {
  const readAccess = {
    ...readyAccess,
    status: "refresh_required",
    readAllowed: false,
    refreshRequired: true,
    blockers: ["snapshot stale"],
  };
  const queryGate = {
    ...readyGate,
    status: "refresh_required",
    executable: false,
    executableQueryText: null,
    parameters: [],
    blockers: ["refresh first"],
  };

  const report = buildQueryTraceReport({ canonicalQuery, binding, queryPlan, readAccess, queryGate });

  assert.equal(report.translation.translatedRepresentation, queryPlan.queryText);
  assert.equal(report.execution.releasedQueryText, null);
  assert.equal(report.execution.executable, false);
  assert.match(report.conclusion, /Nicht freigegeben/);
  assert.ok(report.blockers.includes("snapshot stale"));
});

test("parameter names are traceable without carrying parameter values", () => {
  const report = buildQueryTraceReport({ canonicalQuery, binding, queryPlan, readAccess: readyAccess, queryGate: readyGate });

  assert.deepEqual(report.translation.parameterNames, ["customerId"]);
  assert.equal(JSON.stringify(report).includes("4711"), false);
});
