import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";

import { adaptNorthwindOrderSafely } from "../.bridge-authority-build/bridge-northwind-adapter.js";
import { evaluateRecordWithConflictTruth } from "../.bridge-authority-build/bridge-conflict-truth.js";
import {
  assessAuthorityRevocationImpact,
  evaluateWithAuthorityEvidence,
} from "../.bridge-authority-build/bridge-authority-evidence.js";

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
  return text.replace(/^\uFEFF/, "").split(/\r?\n/).filter(Boolean);
}

function parseOrders(text) {
  const [header, ...lines] = nonEmptyLines(text);
  assert.ok(header.startsWith("orderID,customerID,employeeID,orderDate,requiredDate,shippedDate,shipVia,freight,"));
  return lines.map((line) => {
    const [orderID, customerID, employeeID, orderDate, requiredDate, shippedDate, shipVia, freight] = line.split(",");
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
const details = parseOrderDetails(detailsText);
const customers = parseCustomers(customersText);
const customersById = new Map(customers.map((customer) => [customer.CustomerID, customer]));
const detailsByOrder = new Map();
for (const detail of details) {
  const list = detailsByOrder.get(detail.OrderID) ?? [];
  list.push(detail);
  detailsByOrder.set(detail.OrderID, list);
}

const evidence = {
  evidenceId: "NW-STATUS-SHIPPEDDATE-001",
  version: "1.0.0",
  reviewId: "NW-PROOF-REVIEW-001",
  confirmedAt: "2026-09-21T07:45:00.000Z",
  confirmedBy: "northwind-proof-reviewer",
  scope: "northwind-proof-only",
  status: "ACTIVE",
  authority: {
    authorityId: "northwind-proof-authority",
    kind: "test_authority",
    displayName: "Northwind proof authority (test-only)",
  },
  claim: {
    sourceField: "order.ShippedDate",
    predicate: "NOT_NULL",
    bridgeField: "STATUS",
    canonicalValue: "closed",
  },
  rationale: "Test-only authority rule for proving the evidence lifecycle. It is not asserted as universal Northwind business truth.",
};

const activeResults = [];
const revokedResults = [];
let sourceMutationCount = 0;
let baselineReleaseCount = 0;
let singleDetailOrders = 0;
let shippedSingleDetailOrders = 0;
let unshippedSingleDetailOrders = 0;

for (const order of orders) {
  const orderDetails = detailsByOrder.get(order.OrderID) ?? [];
  if (orderDetails.length === 1) {
    singleDetailOrders += 1;
    if (order.ShippedDate) shippedSingleDetailOrders += 1;
    else unshippedSingleDetailOrders += 1;
  }

  const customer = customersById.get(order.CustomerID);
  assert.ok(customer, `Missing customer for order ${order.OrderID}`);
  const envelope = {
    source: `${UPSTREAM_REPO}@${UPSTREAM_COMMIT}`,
    customer: structuredClone(customer),
    order: structuredClone(order),
    orderDetails: structuredClone(orderDetails),
  };
  const before = JSON.stringify(envelope);
  const safe = adaptNorthwindOrderSafely(envelope);
  assert.equal(safe.accepted, true, `Source schema rejected order ${order.OrderID}`);
  if (JSON.stringify(envelope) !== before) sourceMutationCount += 1;

  const adaptation = safe.adaptation;
  const ingress = {
    source: `${UPSTREAM_REPO}@${UPSTREAM_COMMIT}`,
    transport: "file",
    destination: "petraplan-bridge",
    service: "northwind-authority-lifecycle-proof",
    operation: "readOrder",
    interactionMode: "one_way",
    correlationId: `authority-proof:order:${order.OrderID}`,
    contract: "order-v1",
    transportStatus: "received",
  };
  const base = evaluateRecordWithConflictTruth(
    adaptation.raw,
    "2026-09-21T07:45:00.000Z",
    ingress,
    {},
    adaptation.issues,
  );
  if (base.release.releaseAllowed) baselineReleaseCount += 1;

  const active = evaluateWithAuthorityEvidence(base, { shippedDate: order.ShippedDate }, evidence);
  assert.deepEqual(active.rawUnchanged, base.raw, `Authority layer mutated raw for A-${order.OrderID}`);
  activeResults.push({ recordId: `A-${order.OrderID}`, order, orderDetails, base, result: active });

  const revokedEvidence = { ...evidence, status: "REVOKED" };
  const revoked = evaluateWithAuthorityEvidence(base, { shippedDate: order.ShippedDate }, revokedEvidence);
  assert.deepEqual(revoked.rawUnchanged, base.raw, `Revocation path mutated raw for A-${order.OrderID}`);
  revokedResults.push({ recordId: `A-${order.OrderID}`, result: revoked });
}

assert.equal(orders.length, 830);
assert.equal(sourceMutationCount, 0);
assert.equal(baselineReleaseCount, 0, "Baseline must remain fail-closed before authority evidence");
assert.equal(singleDetailOrders, 137);
assert.equal(shippedSingleDetailOrders, 133);
assert.equal(unshippedSingleDetailOrders, 4);

const activeReleased = activeResults.filter(({ result }) => result.release.releaseAllowed);
const activeBlocked = activeResults.filter(({ result }) => !result.release.releaseAllowed);
const revokedReleased = revokedResults.filter(({ result }) => result.release.releaseAllowed);

assert.equal(activeReleased.length, shippedSingleDetailOrders, "Only shipped single-detail orders should release");
assert.equal(revokedReleased.length, 0, "Revoked evidence must remove every authority-backed release");

for (const { recordId, order, orderDetails, result } of activeResults) {
  if (result.release.releaseAllowed) {
    assert.equal(orderDetails.length, 1, `${recordId} released with ambiguous MENGE`);
    assert.ok(order.ShippedDate, `${recordId} released without matching authority predicate`);
    assert.equal(result.governedMapped.status, "closed");
    assert.equal(result.release.releaseBasis.length, 1);
    assert.equal(result.release.releaseBasis[0].evidenceId, evidence.evidenceId);
    assert.equal(result.release.releaseBasis[0].authority.authorityId, evidence.authority.authorityId);
    assert.equal(result.release.failedConstraintIds.length, 0);
  }
}

const releaseBasisRecords = activeReleased.map(({ recordId, result }) => ({
  recordId,
  releaseBasis: result.release.releaseBasis,
}));
const revocationImpact = assessAuthorityRevocationImpact(releaseBasisRecords, [evidence.evidenceId]);
assert.equal(revocationImpact.affectedRecordIds.length, activeReleased.length);
assert.equal(revocationImpact.unaffectedRecordIds.length, 0);

const stateCounts = activeResults.reduce((acc, { result }) => {
  acc[result.state.state] = (acc[result.state.state] ?? 0) + 1;
  return acc;
}, {});

const summary = {
  proof: "northwind-authority-lifecycle-proof-v1",
  upstream: { repository: UPSTREAM_REPO, commit: UPSTREAM_COMMIT },
  invariant: "authority-backed meaning is scoped, traceable, reversible, and never rewrites Source Truth",
  evidence,
  dataset: {
    orders: orders.length,
    orderDetails: details.length,
    customers: customers.length,
    singleDetailOrders,
    shippedSingleDetailOrders,
    unshippedSingleDetailOrders,
  },
  baseline: {
    released: baselineReleaseCount,
  },
  authorityActive: {
    released: activeReleased.length,
    notReleased: activeBlocked.length,
    stateCounts,
  },
  revocation: {
    releasedAfterRevocation: revokedReleased.length,
    impact: revocationImpact,
  },
  sourceMutationCount,
};

const traces = activeResults.map(({ recordId, order, orderDetails, result }) => ({
  recordId,
  shippedDate: order.ShippedDate,
  detailCount: orderDetails.length,
  authorityApplied: result.appliedEvidence.length > 0,
  authorityEvidenceIds: result.appliedEvidence.map(({ evidenceId }) => evidenceId),
  authorityId: result.appliedEvidence[0]?.authority.authorityId ?? null,
  governedStatus: result.governedMapped.status,
  bridgeState: result.state.state,
  releaseAllowed: result.release.releaseAllowed,
  releaseBasis: result.release.releaseBasis,
  failedConstraintIds: result.release.failedConstraintIds,
}));

await Promise.all([
  writeFile("northwind-authority-lifecycle-summary.json", `${JSON.stringify(summary, null, 2)}\n`),
  writeFile("northwind-authority-lifecycle-traces.jsonl", `${traces.map((row) => JSON.stringify(row)).join("\n")}\n`),
]);

console.log(JSON.stringify(summary, null, 2));
