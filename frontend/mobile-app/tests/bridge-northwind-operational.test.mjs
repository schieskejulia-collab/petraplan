import test from "node:test";
import assert from "node:assert/strict";

import { evaluateRecordWithConflictTruth } from "../.bridge-test-build/bridge-conflict-truth.js";
import { adaptNorthwindOrderOperational } from "../.bridge-test-build/bridge-northwind-adapter.js";

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

test("operational Northwind adapter translates a multi-position order", () => {
  const before = structuredClone(envelope);
  const adaptation = adaptNorthwindOrderOperational(envelope);

  assert.deepEqual(envelope, before);
  assert.equal(adaptation.raw.STATUS, "GESCHLOSSEN");
  assert.equal(adaptation.raw.MENGE, "27");
  assert.equal(adaptation.evidence.statusSource, "order.ShippedDate");
  assert.equal(adaptation.evidence.quantitySource, "orderDetails[].Quantity (sum)");
  assert.equal(adaptation.evidence.values.status.status, "CONFIRMED");
  assert.equal(adaptation.evidence.values.quantity.status, "CONFIRMED");
  assert.deepEqual(adaptation.issues, []);

  const evaluation = evaluateRecordWithConflictTruth(
    adaptation.raw,
    "2026-09-21T12:00:00.000Z",
    { source: "northwind", transport: "file", interactionMode: "one_way", contract: "order-v1" },
    {},
    [],
  );

  assert.equal(evaluation.mapped.status, "closed");
  assert.equal(evaluation.mapped.quantity, 27);
  assert.equal(evaluation.release.releaseAllowed, true);
  assert.equal(evaluation.state.state, "VALID");
});

test("operational Northwind adapter maps an unshipped order to OFFEN", () => {
  const unshipped = structuredClone(envelope);
  unshipped.order.ShippedDate = null;
  const adaptation = adaptNorthwindOrderOperational(unshipped);
  assert.equal(adaptation.raw.STATUS, "OFFEN");
  assert.equal(adaptation.evidence.values.status.status, "CONFIRMED");
});
