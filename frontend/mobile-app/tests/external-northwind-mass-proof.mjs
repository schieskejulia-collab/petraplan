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

function csvCell(value) {
  const text = value == null ? "" : String(value);
  return `"${text.replaceAll('"', '""')}"`;
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

let sourceSchemaAccepted = 0;
let sourceSchemaBlocked = 0;
let sourceMutationCount = 0;
let singleDetailOrders = 0;
let multipleDetailOrders = 0;
let zeroDetailOrders = 0;
const batchItems = [];
const sourceByRecordId = new Map();
const sourceSchemaBlockedTraces = [];

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

  const recordId = `A-${order.OrderID}`;
  sourceByRecordId.set(recordId, {
    upstreamOrder: structuredClone(order),
    upstreamCustomer: structuredClone(customer),
    upstreamOrderDetails: structuredClone(details),
    adapterEvidence: safe.accepted ? structuredClone(safe.adaptation.evidence) : null,
  });

  if (!safe.accepted) {
    sourceSchemaBlocked += 1;
    sourceSchemaBlockedTraces.push({
      recordId,
      upstreamOrder: order,
      upstreamCustomer: customer,
      upstreamOrderDetails: details,
      adapterEvidence: null,
      sourceSchemaGate: "BLOCKED",
      sourceSchemaIssues: safe.drift.issues,
      bridgeContractSchema: "NOT_EVALUATED",
      bridgeState: "NOT_EVALUATED",
      releaseAllowed: false,
      reason: "Source schema gate blocked the foreign record before canonical bridge evaluation.",
    });
    continue;
  }
  sourceSchemaAccepted += 1;
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
assert.equal(sourceSchemaAccepted + sourceSchemaBlocked, orders.length);

const batch = evaluateBatch(batchItems);
assert.equal(batch.total, sourceSchemaAccepted);

const blockingReasonCounts = {};
const stateCounts = {};
const bridgeContractSchemaCounts = { passed: 0, failed: 0 };
for (const record of batch.records) {
  stateCounts[record.state] = (stateCounts[record.state] ?? 0) + 1;
  const contractSchema = record.evaluation.constraints.find(({ id }) => id === "contract.schema");
  assert.ok(contractSchema, `Missing contract.schema constraint for ${record.recordId}`);
  if (contractSchema.passed) bridgeContractSchemaCounts.passed += 1;
  else bridgeContractSchemaCounts.failed += 1;

  for (const constraint of record.evaluation.constraints) {
    if (!constraint.passed && constraint.severity === "blocking") {
      blockingReasonCounts[constraint.id] = (blockingReasonCounts[constraint.id] ?? 0) + 1;
    }
  }
}

// Full learning trace: one independently inspectable entry for every foreign
// order. Structure evidence and value evidence are deliberately exported as
// independent proof dimensions. A confirmed relation must not manufacture a
// STATUS meaning or a many-detail MENGE aggregation.
const evaluatedTraces = batch.records.map((record, index) => {
  const source = sourceByRecordId.get(record.recordId);
  assert.ok(source, `Missing source context for ${record.recordId}`);
  const input = batchItems[index];
  assert.equal(input.raw.AUFTRAGS_NR, record.recordId, "Batch/source order changed unexpectedly");

  const failedConstraints = record.evaluation.constraints
    .filter(({ passed }) => !passed)
    .map(({ id, label, severity, evidence }) => ({ id, label, severity, evidence }));
  const contractSchema = record.evaluation.constraints.find(({ id }) => id === "contract.schema");
  assert.ok(contractSchema, `Missing contract.schema constraint for ${record.recordId}`);

  return {
    recordId: record.recordId,
    correlationId: record.evaluation.ingress.correlationId,
    upstreamOrder: source.upstreamOrder,
    upstreamCustomer: source.upstreamCustomer,
    upstreamOrderDetails: source.upstreamOrderDetails,
    detailCount: source.upstreamOrderDetails.length,
    sourceSchemaGate: "ACCEPTED",
    bridgeContractSchema: contractSchema.passed ? "PASSED" : "FAILED",
    bridgeContractSchemaEvidence: contractSchema.evidence,
    adapterRaw: record.evaluation.raw,
    adapterConflicts: record.evaluation.adapterConflicts,
    adapterEvidence: source.adapterEvidence,
    canonicalMapped: record.evaluation.mapped,
    bridgeState: record.state,
    releaseAllowed: record.releaseAllowed,
    blockingIssues: record.blockingIssues,
    releaseReason: record.evaluation.release.reason,
    failedConstraints,
    errorsDetailed: record.evaluation.report.errorsDetailed,
    fieldTrace: record.evaluation.trace,
  };
});

const allTraces = [...evaluatedTraces, ...sourceSchemaBlockedTraces].sort((a, b) => {
  const aId = Number(String(a.recordId).replace(/^A-/, ""));
  const bId = Number(String(b.recordId).replace(/^A-/, ""));
  return aId - bId;
});
assert.equal(allTraces.length, orders.length, "Expected exactly one trace per upstream order");
assert.equal(new Set(allTraces.map(({ recordId }) => recordId)).size, orders.length, "Duplicate/missing order traces");

const evidenceCounts = {
  structure: { CONFIRMED: 0, CONTRADICTED: 0, UNPROVEN: 0 },
  statusValue: { CONFIRMED: 0, UNPROVEN: 0 },
  quantityValue: { CONFIRMED: 0, UNPROVEN: 0 },
};
for (const trace of evaluatedTraces) {
  const evidence = trace.adapterEvidence;
  assert.ok(evidence, `Missing adapter evidence for ${trace.recordId}`);
  evidenceCounts.structure[evidence.structure.customerRelation.status] += 1;
  evidenceCounts.statusValue[evidence.values.status.status] += 1;
  evidenceCounts.quantityValue[evidence.values.quantity.status] += 1;
  assert.equal(
    evidence.structure.customerRelation.status === "CONFIRMED" && evidence.values.status.status === "CONFIRMED",
    false,
    `Structure confirmation manufactured STATUS meaning for ${trace.recordId}`,
  );
}

assert.equal(evidenceCounts.structure.CONFIRMED, sourceSchemaAccepted);
assert.equal(evidenceCounts.structure.CONTRADICTED, 0);
assert.equal(evidenceCounts.structure.UNPROVEN, 0);
assert.equal(evidenceCounts.statusValue.CONFIRMED, 0);
assert.equal(evidenceCounts.statusValue.UNPROVEN, sourceSchemaAccepted);
assert.equal(evidenceCounts.quantityValue.CONFIRMED, singleDetailOrders);
assert.equal(evidenceCounts.quantityValue.UNPROVEN, multipleDetailOrders + zeroDetailOrders);

const csvHeader = [
  "recordId",
  "customerId",
  "companyName",
  "orderDate",
  "requiredDate",
  "shippedDate",
  "freight",
  "detailCount",
  "sourceQuantities",
  "structureCustomerRelationStatus",
  "structureCustomerRelationReference",
  "statusValueEvidenceStatus",
  "statusValueEvidenceReference",
  "quantityValueEvidenceStatus",
  "quantityValueEvidenceReference",
  "adapterStatus",
  "adapterQuantity",
  "canonicalStatus",
  "canonicalQuantity",
  "sourceSchemaGate",
  "bridgeContractSchema",
  "bridgeState",
  "releaseAllowed",
  "blockingIssues",
  "blockingReasonIds",
  "adapterConflictCodes",
];
const csvRows = allTraces.map((trace) => {
  const constraints = trace.failedConstraints ?? [];
  const conflicts = trace.adapterConflicts ?? [];
  const evidence = trace.adapterEvidence;
  return [
    trace.recordId,
    trace.upstreamOrder?.CustomerID,
    trace.upstreamCustomer?.CompanyName,
    trace.upstreamOrder?.OrderDate,
    trace.upstreamOrder?.RequiredDate,
    trace.upstreamOrder?.ShippedDate,
    trace.upstreamOrder?.Freight,
    trace.detailCount ?? trace.upstreamOrderDetails?.length ?? 0,
    (trace.upstreamOrderDetails ?? []).map(({ Quantity }) => Quantity).join(" | "),
    evidence?.structure?.customerRelation?.status,
    evidence?.structure?.customerRelation?.sourceReference,
    evidence?.values?.status?.status,
    evidence?.values?.status?.sourceReference,
    evidence?.values?.quantity?.status,
    evidence?.values?.quantity?.sourceReference,
    trace.adapterRaw?.STATUS,
    trace.adapterRaw?.MENGE,
    trace.canonicalMapped?.status,
    trace.canonicalMapped?.quantity,
    trace.sourceSchemaGate,
    trace.bridgeContractSchema,
    trace.bridgeState,
    trace.releaseAllowed,
    trace.blockingIssues ?? "",
    constraints.filter(({ severity }) => severity === "blocking").map(({ id }) => id).join(" | "),
    conflicts.map(({ code, field }) => `${code}:${field}`).join(" | "),
  ].map(csvCell).join(",");
});

const summary = {
  proof: "external-northwind-mass-proof-v4-evidence-split",
  invariant: "connected != same meaning",
  upstream: {
    repository: UPSTREAM_REPO,
    commit: UPSTREAM_COMMIT,
    files: ["data/orders.csv", "data/order-details.csv", "data/customers.csv"],
  },
  layerDefinitions: {
    sourceSchemaGate: "Can the foreign Northwind envelope be read safely by the source adapter without inventing structure?",
    bridgeContractSchema: "Does the adapted five-field record satisfy the confirmed order-v1 required-field, type and format contract?",
    structureEvidence: "Is a relation supported by the documented adapter/source relation and the observed concrete keys? Equal names or equal values alone are not proof.",
    valueEvidence: "Does a concrete source value have an explicit confirmed canonical meaning? Structural confirmation never creates value meaning.",
    release: "Are all independent BLOCKING constraints satisfied?",
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
  evidence: evidenceCounts,
  sourceSchemaGate: {
    accepted: sourceSchemaAccepted,
    blocked: sourceSchemaBlocked,
  },
  bridgeContractSchema: bridgeContractSchemaCounts,
  bridge: {
    evaluated: batch.total,
    released: batch.released,
    blocked: batch.blocked,
    stateCounts,
    blockingReasonCounts,
  },
  traceExport: {
    records: allTraces.length,
    jsonl: "external-northwind-830-traces.jsonl",
    csv: "external-northwind-830-traces.csv",
  },
  sourceMutationCount,
};

await Promise.all([
  writeFile("external-northwind-mass-summary.json", `${JSON.stringify(summary, null, 2)}\n`, "utf8"),
  writeFile("external-northwind-830-traces.jsonl", `${allTraces.map((trace) => JSON.stringify(trace)).join("\n")}\n`, "utf8"),
  writeFile("external-northwind-830-traces.csv", `${csvHeader.map(csvCell).join(",")}\n${csvRows.join("\n")}\n`, "utf8"),
]);

console.log("EXTERNAL_NORTHWIND_MASS_SUMMARY");
console.log(JSON.stringify(summary, null, 2));
console.log(`Wrote ${allTraces.length} inspectable per-order traces with independent structure/value evidence (JSONL + CSV).`);
