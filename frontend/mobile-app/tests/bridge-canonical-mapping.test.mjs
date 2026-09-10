import test from "node:test";
import assert from "node:assert/strict";

import { assessCanonicalMapping } from "../.bridge-test-build/bridge-canonical-mapping.js";

const baseSource = {
  KUNDEN_NR: "4711",
  AUFTRAGS_NR: "A-10027",
  STATUS: "OFFEN",
  MENGE: "12",
  DATUM: "07.09.2026",
};

function baseRules() {
  return [
    {
      sourceField: "KUNDEN_NR",
      targetField: "customerId",
      conversion: {
        sourceField: "KUNDEN_NR",
        targetField: "customerId",
        sourceType: "string",
        targetType: "string",
      },
    },
    {
      sourceField: "AUFTRAGS_NR",
      targetField: "orderId",
      conversion: {
        sourceField: "AUFTRAGS_NR",
        targetField: "orderId",
        sourceType: "string",
        targetType: "string",
      },
    },
    {
      sourceField: "STATUS",
      targetField: "status",
      conversion: {
        sourceField: "STATUS",
        targetField: "status",
        sourceType: "string",
        targetType: "string",
      },
      valueMap: {
        OFFEN: "open",
        GESCHLOSSEN: "closed",
        IN_BEARBEITUNG: "in_progress",
      },
    },
    {
      sourceField: "MENGE",
      targetField: "quantity",
      conversion: {
        sourceField: "MENGE",
        targetField: "quantity",
        sourceType: "string",
        targetType: "decimal",
      },
    },
    {
      sourceField: "DATUM",
      targetField: "orderDate",
      conversion: {
        sourceField: "DATUM",
        targetField: "orderDate",
        sourceType: "string",
        targetType: "date",
        sourceFormat: "DD.MM.YYYY",
        targetFormat: "YYYY-MM-DD",
      },
    },
  ];
}

test("canonical model is built only after all field conversions are safe", () => {
  const result = assessCanonicalMapping(baseSource, baseRules());

  assert.equal(result.readyForCanonical, true);
  assert.deepEqual(result.canonical, {
    customerId: "4711",
    orderId: "A-10027",
    status: "open",
    quantity: 12,
    orderDate: "2026-09-07",
  });
  assert.deepEqual(result.unresolvedFields, []);
  assert.deepEqual(result.blockedFields, []);
  assert.equal(result.mutationPolicy, "no_auto_fix");
  assert.equal(result.releaseAuthority, "none");
});

test("unknown status never creates a canonical status by guessing", () => {
  const result = assessCanonicalMapping(
    { ...baseSource, STATUS: "UNBEKANNT" },
    baseRules(),
  );

  assert.equal(result.readyForCanonical, false);
  assert.equal(result.canonical.status, null);
  assert.ok(result.unresolvedFields.includes("status"));
});

test("unsafe date conversion leaves canonical date empty and blocked", () => {
  const result = assessCanonicalMapping(
    { ...baseSource, DATUM: "29.02.2025" },
    baseRules(),
  );

  assert.equal(result.readyForCanonical, false);
  assert.equal(result.canonical.orderDate, null);
  assert.ok(result.blockedFields.includes("orderDate"));
});

test("missing quantity is not converted to zero", () => {
  const result = assessCanonicalMapping(
    { ...baseSource, MENGE: "NULL" },
    baseRules(),
  );

  assert.equal(result.readyForCanonical, false);
  assert.equal(result.canonical.quantity, null);
  assert.ok(result.unresolvedFields.includes("quantity"));
});

test("source object is preserved exactly", () => {
  const source = { ...baseSource };
  const before = JSON.stringify(source);
  assessCanonicalMapping(source, baseRules());
  assert.equal(JSON.stringify(source), before);
});

test("mapping layer never grants release authority", () => {
  const result = assessCanonicalMapping(baseSource, baseRules());
  assert.equal(result.releaseAuthority, "none");
  assert.equal(result.sourcePolicy, "preserve");
});
