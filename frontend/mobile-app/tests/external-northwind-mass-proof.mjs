import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";

import { adaptNorthwindOrderSafely } from "../.bridge-external-build/bridge-northwind-adapter.js";
import { evaluateBatch } from "../.bridge-external-build/bridge-batch-evaluation.js";

const UPSTREAM_REPO = "neo4j-contrib/northwind-neo4j";
const UPSTREAM_COMMIT = "5db323116a2779434ba0c17eb2b733575bfc2a4a";
const RAW_BASE = `https://raw.githubusercontent.com/${UPSTREAM_REPO}/${UPSTREAM_COMMIT}/data`;

async function fetchText(name) {
  const url = `${RAW_BASE}/${name}`;
  const response = await fetch(url);
  assert.equal(response.ok, true, `Upstream download failed: ${url} (${response.status})`);
  return response.text();
}

function nonEmptyLines(text) {
  return text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.length > 0);
}

// We intentionally read only the stable leading columns we need. The upstream
// orders.csv contains legacy free-text columns later in each row, including
// unquoted commas in addresses/names. Those fields are not silently repaired or
// reinterpreted here because they are outside this proof's confirmed mapping.
function parseOrders(text) {
  const [header, ...lines] = nonEmptyLines(text);
  assert.ok(header.startsWith("orderID,customerID,employeeID,orderDate,requiredDate,shippedDate,shipVia,freight,"));
  return lines.map((line) => {
    const parts = line.split(",");
    assert.ok(parts.length >= 8, `Malformed upstream order row: ${line}`);
    const [orderID, customerID, employeeID, orderDate, requiredDate, shippedDate, shipVia, freight] = parts;
    return {
      OrderID: Number(orderID),
      CustomerID: customerID === "NULL" ? null : customerID,
      EmployeeID: employeeID === "NULL" ? null : Number(employeeID),
      OrderDate: orderDate === "NULL" ? null : orderDate,
      RequiredDate: requiredDate === "NULL" ? null : requiredDate,
      ShippedDate: shippedDate === "NULL" ? null : shippedDate,
      ShipVia: shipVia === "NULL" ? null : Number(shipVia),
      Freight: freight === "NULL" ? null : Number(freight),
    };
  });
}

function parseOrderDetails(text) {
  const [header, ...lines] = nonEmptyLines(text);
  assert.equal(header, "orderID,productID,unitPrice,quantity,discount");
  return lines.map((line) => {
    const [orderID, productID, unitPrice, quantity, discount] = line.split(",");
    return {
      OrderID: Number(orderID),
      ProductID: Number(productID),
      UnitPrice: Number(unitPrice),
      Quantity: Number(quantity),
      Discount: Number(discount),
    };
  });
}

function parseCustomers(text) {
  const [header, ...lines] = nonEmptyLines(text);
  assert.ok(header.startsWith("customerID,companyName,"));
  return lines.map((line) => {
    const firstComma = line.indexOf(",");
    const secondComma = line.indexOf(",", firstComma + 1);
    assert.ok(firstComma > 0 && secondComma > firstComma, `Malformed upstream customer row: ${line}`);
    return {
      CustomerID: line.slice(0, firstComma),
      CompanyName: line.slice(firstComma + 1, secondComma),
    };
  });
}

const [ordersText, detailsText, customersText] = await Promise.all([
  fetchText("orders.csv"),
  fetchText("order-details.csv"),
  fetchText("customers.csv"),
]);

const orders = parseOrders(ordersText);
const orderDetails = parseOrderDetails(detailsText);
const customers = parseCustomers(customersText);

assert.ok(orders.length > 500, `Expected a mass dataset, got only ${orders.length} orders`);
assert.ok(orderDetails.length > 1000, `Expected >1000 detail rows, got ${orderDetails.length}`);

const customersById = new Map(customers.map((customer) => [customer.CustomerID, customer]));
const detailsByOrder = new Map();
for (const detail of orderDetails) {
  const list = detailsByOrder.get(detail.OrderID) ?? [];
  list.push(detail);
  detailsByOrder.set(detail.OrderID, list);
}

const missingCustomerJoins = orders.filter(({ CustomerID }) => !CustomerID || !customersById.has(CustomerID));
assert.equal(
  missingCustomerJoins.length,
  0,
  `Upstream relationship mismatch: ${missingCustomerJoins.length} orders have no matching customer row`,
);

let schemaAccepted = 0;
let schemaBlocked = 0;
let sourceMutationCount = 0;
let singleDetailOrders = 0;
let multipleDetailOrders = 0;
let zeroDetailOrders = 0;
const batchItems = [];

for (const order of orders) {
  const details = detailsByOrder.get(order.OrderID) ?? [];
  if (details.length === 0) zeroDetailOrders += 1;
  else if (details.length === 1) singleDetailOrders += 1;
  else multipleDetailOrders += 1;

  const customer = customersById.get(order.CustomerID);
  const envelope = {
    source: `${UPSTREAM_REPO}@${UPSTREAM_COMMIT}`,
    customer: structuredClone(customer),
    order: structuredClone(order),
    orderDetails: structuredClone(details),
  };
  const before = JSON.stringify(envelope);
  const safe = adaptNorthwindOrderSafely(envelope);
  if (JSON.stringify(envelope) !== before) sourceMutationCount += 1;

  if (!safe.accepted) {
    schemaBlocked += 1;
    continue;
  }
  schemaAccepted += 1;
  batchItems.push({
    raw: safe.adaptation.raw,
    capturedAt: "2026-09-19T15:30:00.000Z",
    ingress: {
      source: `${UPSTREAM_REPO}@${UPSTREAM_COMMIT}`,
      transport: "file",
      destination: "petraplan-bridge",
      service: "external-northwind-mass-proof",
      operation: "readOrder",
      interactionMode: "one_way",
      correlationId: `external-northwind:order:${order.OrderID}`,
      contract: "order-v1",
      transportStatus: "received",
    },
    conflicts: safe.adaptation.issues.map((issue) => ({ ...issue, origin: "adapter" })),
  });
}

assert.equal(sourceMutationCount, 0, "External Source Truth was mutated");
assert.equal(schemaAccepted + schemaBlocked, orders.length);

const batch = evaluateBatch(batchItems);
assert.equal(batch.total, schemaAccepted);

const blockingReasonCounts = {};
const stateCounts = {};
for (const record of batch.records) {
  stateCounts[record.state] = (stateCounts[record.state] ?? 0) + 1;
  for (const constraint of record.evaluation.constraints) {
    if (!constraint.passed && constraint.severity === "blocking") {
      blockingReasonCounts[constraint.id] = (blockingReasonCounts[constraint.id] ?? 0) + 1;
    }
  }
}

const summary = {
  proof: "external-northwind-mass-proof-v1",
  upstream: {
    repository: UPSTREAM_REPO,
    commit: UPSTREAM_COMMIT,
    files: ["data/orders.csv", "data/order-details.csv", "data/customers.csv"],
  },
  sourceRows: {
    orders: orders.length,
    orderDetails: orderDetails.length,
    customers: customers.length,
  },
  relationships: {
    missingCustomerJoins: missingCustomerJoins.length,
    zeroDetailOrders,
    singleDetailOrders,
    multipleDetailOrders,
  },
  schemaGate: {
    accepted: schemaAccepted,
    blocked: schemaBlocked,
  },
  bridge: {
    evaluated: batch.total,
    released: batch.released,
    blocked: batch.blocked,
    stateCounts,
    blockingReasonCounts,
  },
  sourceMutationCount,
};

await writeFile("external-northwind-mass-summary.json", `${JSON.stringify(summary, null, 2)}\n`, "utf8");
console.log("EXTERNAL_NORTHWIND_MASS_SUMMARY");
console.log(JSON.stringify(summary, null, 2));
