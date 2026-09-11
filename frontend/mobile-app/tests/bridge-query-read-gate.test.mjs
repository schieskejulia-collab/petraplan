import test from "node:test";
import assert from "node:assert/strict";

import { decideQueryReadExecution } from "../.bridge-test-build/bridge-query-read-gate.js";

const readyReadAccess = {
  status: "ready",
  readAllowed: true,
  refreshRequired: false,
  blockers: [],
  evidence: ["source/read-plan/freshness confirmed"],
  sourcePolicy: "preserve",
  writePolicy: "forbidden",
  cachePolicy: "cache_never_source_truth",
  loadingPolicy: "addressable_read_only",
  note: "ready",
};

const readyQueryPlan = {
  status: "ready",
  dialect: "postgresql",
  canonicalSubject: "order",
  mappedSubject: "orders",
  canonicalFields: ["orderId", "customerId"],
  mappedFields: ["AUFTRAGS_NR", "KUNDEN_NR"],
  queryText: 'SELECT "AUFTRAGS_NR", "KUNDEN_NR" FROM "orders" WHERE "KUNDEN_NR" = :customerId',
  parameters: ["customerId"],
  blockers: [],
  evidence: ["canonical intent/mapping/dialect confirmed"],
  sourcePolicy: "preserve",
  writePolicy: "forbidden",
  semanticPolicy: "canonical_intent_is_not_derived_from_native_syntax",
  note: "ready",
};

test("releases query text only when read access and translation are both ready", () => {
  const result = decideQueryReadExecution({
    readAccess: readyReadAccess,
    queryPlan: readyQueryPlan,
  });

  assert.equal(result.status, "ready");
  assert.equal(result.executable, true);
  assert.equal(result.executableQueryText, readyQueryPlan.queryText);
  assert.deepEqual(result.parameters, ["customerId"]);
  assert.equal(result.writePolicy, "forbidden");
});

test("stale read access withholds executable query until refresh", () => {
  const result = decideQueryReadExecution({
    readAccess: {
      ...readyReadAccess,
      status: "refresh_required",
      readAllowed: false,
      refreshRequired: true,
    },
    queryPlan: readyQueryPlan,
  });

  assert.equal(result.status, "refresh_required");
  assert.equal(result.executable, false);
  assert.equal(result.executableQueryText, null);
  assert.deepEqual(result.parameters, []);
});

test("unconfirmed query mapping cannot be rescued by ready read access", () => {
  const result = decideQueryReadExecution({
    readAccess: readyReadAccess,
    queryPlan: {
      ...readyQueryPlan,
      status: "needs_confirmation",
      queryText: null,
      blockers: ["field mapping unconfirmed"],
    },
  });

  assert.equal(result.status, "needs_confirmation");
  assert.equal(result.executable, false);
  assert.equal(result.executableQueryText, null);
});

test("blocked source/read path blocks query use even when translation is ready", () => {
  const result = decideQueryReadExecution({
    readAccess: {
      ...readyReadAccess,
      status: "blocked",
      readAllowed: false,
      blockers: ["source not ready"],
    },
    queryPlan: readyQueryPlan,
  });

  assert.equal(result.status, "blocked");
  assert.equal(result.executable, false);
  assert.equal(result.executableQueryText, null);
});

test("inconsistent ready query plan without text is held for confirmation", () => {
  const result = decideQueryReadExecution({
    readAccess: readyReadAccess,
    queryPlan: {
      ...readyQueryPlan,
      queryText: null,
    },
  });

  assert.equal(result.status, "needs_confirmation");
  assert.equal(result.executable, false);
  assert.ok(result.blockers.some((item) => item.includes("keinen technischen Query-Text")));
});
