import test from "node:test";
import assert from "node:assert/strict";
import { adaptNorthwindOrderSafely } from "../.bridge-test-build/bridge-northwind-adapter.js";

function validEnvelope() {
  return {
    source: "northwind",
    customer: {
      CustomerID: "VINET",
      CompanyName: "Vins et alcools Chevalier",
    },
    order: {
      OrderID: 10248,
      CustomerID: "VINET",
      OrderDate: "1996-07-04T00:00:00.000Z",
    },
    orderDetails: [
      { OrderID: 10248, ProductID: 11, UnitPrice: 14, Quantity: 12, Discount: 0 },
      { OrderID: 10248, ProductID: 42, UnitPrice: 9.8, Quantity: 10, Discount: 0 },
    ],
  };
}

test("matching Northwind runtime schema is accepted before adaptation", () => {
  const source = validEnvelope();
  const result = adaptNorthwindOrderSafely(source);

  assert.equal(result.accepted, true);
  assert.equal(result.drift.compatible, true);
  assert.deepEqual(result.drift.issues, []);
  assert.equal(result.adaptation.raw.AUFTRAGS_NR, "A-10248");
  assert.deepEqual(result.sourceSnapshot, source);
});

test("renamed source field is schema drift and is never guessed", () => {
  const source = validEnvelope();
  source.order.OrderNumber = source.order.OrderID;
  delete source.order.OrderID;
  const before = structuredClone(source);

  const result = adaptNorthwindOrderSafely(source);

  assert.equal(result.accepted, false);
  assert.equal(result.adaptation, null);
  assert.equal(result.drift.compatible, false);
  assert.ok(result.drift.issues.some(({ path, code }) => path === "order.OrderID" && code === "MISSING_PATH"));
  assert.deepEqual(result.sourceSnapshot, before);
  assert.deepEqual(source, before);
});

test("changed source type blocks adaptation instead of coercing it", () => {
  const source = validEnvelope();
  source.orderDetails[0].Quantity = "12";

  const result = adaptNorthwindOrderSafely(source);

  assert.equal(result.accepted, false);
  assert.equal(result.adaptation, null);
  assert.ok(result.drift.issues.some(({ path, code, observed }) =>
    path === "orderDetails[].Quantity" && code === "TYPE_CHANGED" && observed === "string"
  ));
});

test("missing required field in only one array item is still detected", () => {
  const source = validEnvelope();
  delete source.orderDetails[1].Quantity;

  const result = adaptNorthwindOrderSafely(source);

  assert.equal(result.accepted, false);
  assert.ok(result.drift.issues.some(({ path, code }) =>
    path === "orderDetails[].Quantity" && code === "MISSING_PATH"
  ));
});
