import assert from 'node:assert/strict';

import { adaptNorthwindOrder } from '../.bridge-test-build/bridge-northwind-adapter.js';

function envelope(orderDetails) {
  return {
    source: 'pinned-northwind-test',
    customer: { CustomerID: 'VINET', CompanyName: 'Vins et alcools Chevalier' },
    order: { OrderID: 10248, CustomerID: 'VINET', OrderDate: '1996-07-04' },
    orderDetails,
  };
}

const single = adaptNorthwindOrder(envelope([
  { OrderID: 10248, ProductID: 11, UnitPrice: 14, Quantity: 12, Discount: 0 },
]));

assert.equal(single.evidence.structure.customerRelation.status, 'CONFIRMED');
assert.equal(single.evidence.values.status.status, 'UNPROVEN');
assert.equal(single.evidence.values.quantity.status, 'CONFIRMED');
assert.equal(single.evidence.values.quantity.canonicalValue, 12);

const multiple = adaptNorthwindOrder(envelope([
  { OrderID: 10248, ProductID: 11, UnitPrice: 14, Quantity: 12, Discount: 0 },
  { OrderID: 10248, ProductID: 42, UnitPrice: 9.8, Quantity: 10, Discount: 0 },
]));
assert.equal(multiple.evidence.structure.customerRelation.status, 'CONFIRMED');
assert.equal(multiple.evidence.values.quantity.status, 'UNPROVEN');
assert.equal(multiple.raw.MENGE, '');

const mismatch = adaptNorthwindOrder({
  ...envelope([]),
  customer: { CustomerID: 'ALFKI', CompanyName: 'Alfreds Futterkiste' },
});
assert.equal(mismatch.evidence.structure.customerRelation.status, 'CONTRADICTED');
assert.ok(mismatch.issues.some(({ code, field }) => code === 'CUSTOMER_MISMATCH' && field === 'KUNDEN_NR'));

console.log('Northwind structure/value evidence separation verified.');
