import test from "node:test";
import assert from "node:assert/strict";

import { evaluateRecordWithConflictTruth } from "../.bridge-test-build/bridge-conflict-truth.js";
import { adaptNorthwindOrder } from "../.bridge-test-build/bridge-northwind-adapter.js";

const envelope = {
  source: "Northwind sample dataset",
  customer: { CustomerID: "VINET", CompanyName: "Vins et alcools Chevalier" },
  order: {
    OrderID: 10248,
    CustomerID: "VINET",
    OrderDate: "1996-07-04T00:00:00Z",
    RequiredDate: "1996-08-01T00:00:00Z",
    ShippedDate: "1996-07-16T00:00:00Z",
  },
  orderDetails: [
    { OrderID: 10248, ProductID: 11, UnitPrice: 14, Quantity: 12, Discount: 0 },
    { OrderID: 10248, ProductID: 42, UnitPrice: 9.8, Quantity: 10, Discount: 0 },
    { OrderID: 10248, ProductID: 72, UnitPrice: 34.8, Quantity: 5, Discount: 0 },
  ],
};

test("multi-position Northwind order preserves unconfirmed semantics as blockers", () => {
  const before = structuredClone(envelope);
  const adaptation = adaptNorthwindOrder(envelope);

  assert.deepEqual(envelope, before);
  assert.equal(adaptation.raw.STATUS, "");
  assert.equal(adaptation.raw.MENGE, "");
  assert.equal(adaptation.evidence.statusSource, "unmapped");
  assert.equal(adaptation.evidence.quantitySource, "unmapped");
  assert.equal(adaptation.evidence.values.status.status, "UNPROVEN");
  assert.equal(adaptation.evidence.values.quantity.status, "UNPROVEN");
  assert.deepEqual(adaptation.issues.map(({ code, field }) => ({ code, field })), [
    { code: "NO_CONFIRMED_SEMANTIC_MAPPING", field: "MENGE" },
    { code: "NO_CONFIRMED_SEMANTIC_MAPPING", field: "STATUS" },
  ]);

  const evaluation = evaluateRecordWithConflictTruth(
    adaptation.raw,
    "2026-09-21T12:00:00.000Z",
    { source: "northwind", transport: "file", interactionMode: "one_way", contract: "order-v1" },
    {},
    adaptation.issues,
  );

  assert.equal(evaluation.mapped.status, null);
  assert.equal(evaluation.mapped.quantity, null);
  assert.equal(evaluation.release.releaseAllowed, false);
  // The target contract requires these fields, so the unresolved semantics
  // also keep the record fail-closed and ineligible for release.
  assert.equal(evaluation.state.state, "BLOCKED");
});

test("ShippedDate remains a source fact, not an assumed status", () => {
  const unshipped = structuredClone(envelope);
  unshipped.order.ShippedDate = null;
  const adaptation = adaptNorthwindOrder(unshipped);
  assert.equal(adaptation.raw.STATUS, "");
  assert.equal(adaptation.evidence.values.status.status, "UNPROVEN");
});
