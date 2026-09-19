import test from "node:test";
import assert from "node:assert/strict";

import { adaptNorthwindOrder } from "../.bridge-test-build/bridge-northwind-adapter.js";
import { assessTypeConversion } from "../.bridge-test-build/bridge-type-conversion.js";

function baseEnvelope() {
  return {
    source: "Northwind sample dataset",
    customer: {
      CustomerID: "VINET",
      CompanyName: "Vins et alcools Chevalier",
      ContactName: "Paul Henriot",
      ContactTitle: "Accounting Manager",
      Address: "59 rue de l'Abbaye",
      City: "Reims",
      Region: null,
      PostalCode: "51100",
      Country: "France",
    },
    order: {
      OrderID: 10248,
      CustomerID: "VINET",
      EmployeeID: 5,
      OrderDate: "1996-07-04T00:00:00Z",
      RequiredDate: "1996-08-01T00:00:00Z",
      ShippedDate: "1996-07-16T00:00:00Z",
      ShipVia: 3,
      Freight: 32.38,
      ShipName: "Vins et alcools Chevalier",
      ShipAddress: "59 rue de l'Abbaye",
      ShipCity: "Reims",
      ShipRegion: null,
      ShipPostalCode: "51100",
      ShipCountry: "France",
    },
    orderDetails: [
      { OrderID: 10248, ProductID: 11, UnitPrice: 14.0, Quantity: 12, Discount: 0 },
      { OrderID: 10248, ProductID: 42, UnitPrice: 9.8, Quantity: 10, Discount: 0 },
      { OrderID: 10248, ProductID: 72, UnitPrice: 34.8, Quantity: 5, Discount: 0 },
    ],
  };
}

test("Northwind date role is explicit: adapter uses OrderDate, not RequiredDate or ShippedDate", () => {
  const envelope = baseEnvelope();
  const adaptation = adaptNorthwindOrder(envelope);

  assert.equal(adaptation.raw.DATUM, "1996-07-04");
  assert.equal(adaptation.evidence.dateSource, "order.OrderDate");
  assert.equal(adaptation.sourceSnapshot.order.RequiredDate, "1996-08-01T00:00:00Z");
  assert.equal(adaptation.sourceSnapshot.order.ShippedDate, "1996-07-16T00:00:00Z");

  // Regression guard: changing the other dates must not silently change the mapped order date.
  const changedOtherDates = structuredClone(envelope);
  changedOtherDates.order.RequiredDate = "1999-01-01T00:00:00Z";
  changedOtherDates.order.ShippedDate = null;
  const changed = adaptNorthwindOrder(changedOtherDates);
  assert.equal(changed.raw.DATUM, "1996-07-04");
  assert.equal(changed.evidence.dateSource, "order.OrderDate");
});

test("decimal text with trailing zeros converts safely without changing the preserved source text", () => {
  const assessment = assessTypeConversion("32.3800", {
    sourceField: "Freight",
    targetField: "freight",
    sourceType: "string",
    targetType: "decimal",
  });

  assert.equal(assessment.sourceValue, "32.3800");
  assert.equal(assessment.safety, "safe");
  assert.equal(assessment.convertedValue, 32.38);
  assert.equal(assessment.sourcePolicy, "preserve");
  assert.equal(assessment.mutationPolicy, "no_auto_fix");
});

test("ALFKI Region null stays source truth and is not reinterpreted as bridge order status", () => {
  const envelope = baseEnvelope();
  envelope.customer = {
    CustomerID: "ALFKI",
    CompanyName: "Alfreds Futterkiste",
    ContactName: "Maria Anders",
    ContactTitle: "Sales Representative",
    Address: "Obere Str. 57",
    City: "Berlin",
    Region: null,
    PostalCode: "12209",
    Country: "Germany",
  };
  envelope.order.CustomerID = "ALFKI";

  const adaptation = adaptNorthwindOrder(envelope);

  assert.equal(adaptation.sourceSnapshot.customer.Region, null);
  assert.equal(adaptation.raw.KUNDEN_NR, "ALFKI");
  assert.equal(adaptation.raw.STATUS, "");
  assert.ok(adaptation.issues.some(({ code }) => code === "NO_CONFIRMED_SEMANTIC_MAPPING"));
});

test("ShippedDate null is observed but must not be silently mapped to OFFEN", () => {
  const envelope = baseEnvelope();
  envelope.order.ShippedDate = null;

  const adaptation = adaptNorthwindOrder(envelope);

  assert.equal(adaptation.sourceSnapshot.order.ShippedDate, null);
  assert.equal(adaptation.raw.STATUS, "");
  assert.ok(adaptation.issues.some(({ code, field }) => code === "NO_CONFIRMED_SEMANTIC_MAPPING" && field === "STATUS"));

  // Core rule under test: a business signal is not yet a confirmed semantic mapping.
  assert.notEqual(adaptation.raw.STATUS, "OFFEN");
});
