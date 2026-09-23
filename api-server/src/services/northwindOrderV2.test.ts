import assert from 'node:assert/strict';
import { test } from 'node:test';
import { previewNorthwindOrderV2 } from './northwindOrderV2.js';

const source = {
  source: 'pinned-northwind-test',
  customer: { CustomerID: 'VINET' },
  order: { OrderID: 10248, CustomerID: 'VINET', OrderDate: '1996-07-04', ShippedDate: '1996-07-16' },
  orderDetails: [
    { OrderID: 10248, ProductID: 11, Quantity: 12, UnitPrice: 14, Discount: 0 },
    { OrderID: 10248, ProductID: 42, Quantity: 10, UnitPrice: 9.8, Discount: 0 },
    { OrderID: 10248, ProductID: 72, Quantity: 5, UnitPrice: 34.8, Discount: 0 },
  ],
};

test('three product quantities stay separate without inventing a header quantity or status', () => {
  const before = structuredClone(source);
  const preview = previewNorthwindOrderV2(source);
  assert.equal(preview.contract.name, 'order-v2');
  assert.equal(preview.compatible, true);
  assert.deepEqual(preview.positions.map(({ productId, quantity }) => [productId, quantity]), [[11, 12], [42, 10], [72, 5]]);
  assert.equal(preview.positions[2].sourcePath, 'orderDetails[2]');
  assert.equal(Object.hasOwn(preview.header, 'quantity'), false);
  assert.equal(preview.header.status, null);
  assert.equal(preview.decision, 'NOT_EVALUATED');
  assert.deepEqual(source, before);
});

test('wrong parent and duplicate product identity are visible instead of being merged', () => {
  const changed = structuredClone(source);
  changed.orderDetails[1].OrderID = 99999;
  changed.orderDetails[2].ProductID = 11;
  const preview = previewNorthwindOrderV2(changed);
  assert.equal(preview.compatible, false);
  assert.equal(preview.positions.length, 3);
  assert.ok(preview.issues.some((issue) => issue.includes('OrderID differs')));
  assert.ok(preview.issues.some((issue) => issue.includes('duplicate OrderID/ProductID')));
});
