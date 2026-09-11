import test from "node:test";
import assert from "node:assert/strict";

import { buildQueryTranslationPlan } from "../.bridge-test-build/bridge-query-abstraction.js";

const canonicalQuery = {
  subject: "order",
  fields: ["orderId", "customerId"],
  predicates: [{ field: "customerId", operator: "eq", parameter: "customerId" }],
  semanticStatus: "confirmed",
  evidence: ["confirmed canonical read intent"],
};

const confirmedBinding = {
  dialect: "postgresql",
  dialectStatus: "confirmed",
  subjectAddress: "orders",
  subjectAddressStatus: "confirmed",
  fieldMap: {
    orderId: "AUFTRAGS_NR",
    customerId: "KUNDEN_NR",
  },
  fieldMapStatus: "confirmed",
  parameterStyle: "named",
  evidence: ["confirmed database/driver profile and field map"],
};

test("confirmed canonical intent translates to a read-only PostgreSQL representation", () => {
  const result = buildQueryTranslationPlan(canonicalQuery, confirmedBinding);

  assert.equal(result.status, "ready");
  assert.equal(result.writePolicy, "forbidden");
  assert.equal(result.semanticPolicy, "canonical_intent_is_not_derived_from_native_syntax");
  assert.equal(result.queryText, 'SELECT "AUFTRAGS_NR", "KUNDEN_NR" FROM "orders" WHERE "KUNDEN_NR" = :customerId');
});

test("same canonical intent can use another confirmed dialect without changing semantics", () => {
  const result = buildQueryTranslationPlan(canonicalQuery, {
    ...confirmedBinding,
    dialect: "mysql",
  });

  assert.equal(result.status, "ready");
  assert.equal(result.canonicalSubject, "order");
  assert.equal(result.queryText, "SELECT `AUFTRAGS_NR`, `KUNDEN_NR` FROM `orders` WHERE `KUNDEN_NR` = :customerId");
});

test("missing field mapping prevents guessed query translation", () => {
  const result = buildQueryTranslationPlan(canonicalQuery, {
    ...confirmedBinding,
    fieldMap: { orderId: "AUFTRAGS_NR" },
  });

  assert.equal(result.status, "needs_confirmation");
  assert.equal(result.queryText, null);
  assert.ok(result.blockers.some((item) => item.includes("customerId")));
});

test("unconfirmed semantic intent is not upgraded by a known dialect", () => {
  const result = buildQueryTranslationPlan(
    { ...canonicalQuery, semanticStatus: "candidate" },
    confirmedBinding,
  );

  assert.equal(result.status, "needs_confirmation");
  assert.equal(result.queryText, null);
  assert.ok(result.blockers.some((item) => item.includes("fachliche Query-Absicht")));
});

test("native syntax requires an explicitly confirmed template", () => {
  const withoutTemplate = buildQueryTranslationPlan(canonicalQuery, {
    ...confirmedBinding,
    dialect: "native",
  });

  assert.equal(withoutTemplate.status, "needs_confirmation");
  assert.equal(withoutTemplate.queryText, null);

  const withTemplate = buildQueryTranslationPlan(canonicalQuery, {
    ...confirmedBinding,
    dialect: "native",
    nativeTemplate: "READ ORDER_FIELDS FOR CUSTOMER :customerId",
    nativeTemplateStatus: "confirmed",
  });

  assert.equal(withTemplate.status, "ready");
  assert.equal(withTemplate.queryText, "READ ORDER_FIELDS FOR CUSTOMER :customerId");
});
