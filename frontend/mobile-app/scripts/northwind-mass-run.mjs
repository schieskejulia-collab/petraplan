import { mkdir, writeFile } from "node:fs/promises";
import { adaptNorthwindOrderSafely } from "../.bridge-mass-build/bridge-northwind-adapter.js";
import { evaluateRecordWithConflictTruth } from "../.bridge-mass-build/bridge-conflict-truth.js";

const SOURCE_COMMIT = "5db323116a2779434ba0c17eb2b733575bfc2a4a";
const SOURCE_BASE = `https://raw.githubusercontent.com/neo4j-contrib/northwind-neo4j/${SOURCE_COMMIT}/data`;
const CAPTURED_AT = "2026-09-20T00:00:00.000Z";
const OUT_DIR = "proof/northwind-830";

async function fetchText(name) {
  const url = `${SOURCE_BASE}/${name}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Northwind source fetch failed: ${name} (${response.status})`);
  return { url, text: await response.text() };
}

function lines(text) {
  return text.replace(/\r/g, "").trimEnd().split("\n");
}

// The historical Neo4j export has unquoted commas in some shipping/address
// columns. The bridge only needs the stable prefix through Freight, whose first
// eight data columns are unambiguous, so we deliberately do not guess the tail.
function parseOrders(text) {
  return lines(text).slice(1).map((line) => {
    const c = line.split(",");
    if (c.length < 8) throw new Error(`Malformed order row: ${line}`);
    return {
      OrderID: Number(c[0]),
      CustomerID: c[1] === "NULL" ? null : c[1],
      EmployeeID: c[2] === "NULL" ? null : Number(c[2]),
      OrderDate: c[3] === "NULL" ? null : c[3],
      RequiredDate: c[4] === "NULL" ? null : c[4],
      ShippedDate: c[5] === "NULL" ? null : c[5],
      ShipVia: c[6] === "NULL" ? null : Number(c[6]),
      Freight: c[7] === "NULL" ? null : Number(c[7]),
    };
  });
}

function parseOrderDetails(text) {
  return lines(text).slice(1).map((line) => {
    const c = line.split(",");
    if (c.length !== 5) throw new Error(`Malformed order-detail row: ${line}`);
    return {
      OrderID: Number(c[0]),
      ProductID: Number(c[1]),
      UnitPrice: Number(c[2]),
      Quantity: Number(c[3]),
      Discount: Number(c[4]),
    };
  });
}

function csvCell(value) {
  const text = value == null ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

const [ordersSource, detailsSource] = await Promise.all([
  fetchText("orders.csv"),
  fetchText("order-details.csv"),
]);
const orders = parseOrders(ordersSource.text);
const details = parseOrderDetails(detailsSource.text);

if (orders.length !== 830) throw new Error(`Expected 830 Northwind orders, got ${orders.length}`);
if (details.length !== 2155) throw new Error(`Expected 2155 Northwind order details, got ${details.length}`);

const detailsByOrder = new Map();
for (const detail of details) {
  const bucket = detailsByOrder.get(detail.OrderID) ?? [];
  bucket.push(detail);
  detailsByOrder.set(detail.OrderID, bucket);
}

const traces = [];
for (const order of orders) {
  const orderDetails = detailsByOrder.get(order.OrderID) ?? [];
  const envelope = {
    source: `Northwind classic @ ${SOURCE_COMMIT}`,
    // CustomerID identity is taken from the Orders foreign-key value. We do not
    // claim this run proves cross-table CUSTOMER_MISMATCH detection; that has a
    // separate synthetic conflict test.
    customer: {
      CustomerID: order.CustomerID ?? "",
      CompanyName: "not-read-by-mass-run",
    },
    order,
    orderDetails,
  };

  const safe = adaptNorthwindOrderSafely(envelope);
  if (!safe.accepted || !safe.adaptation) {
    traces.push({
      recordId: `A-${order.OrderID}`,
      sourceOrderId: order.OrderID,
      customerId: order.CustomerID ?? "",
      detailCount: orderDetails.length,
      sourceQuantities: orderDetails.map(({ Quantity }) => Quantity).join(" | "),
      shippedDate: order.ShippedDate ?? "",
      freight: order.Freight ?? "",
      schemaGate: "REJECTED",
      adapterStatus: "",
      adapterQuantity: "",
      canonicalStatus: "",
      canonicalQuantity: "",
      bridgeState: "NOT_EVALUATED",
      releaseAllowed: false,
      blockingIssues: "",
      blockingReasonIds: "schema_drift",
      adapterConflictCodes: "",
    });
    continue;
  }

  const adaptation = safe.adaptation;
  const evaluation = evaluateRecordWithConflictTruth(
    adaptation.raw,
    CAPTURED_AT,
    {
      source: "northwind",
      transport: "file",
      destination: "petraplan-bridge",
      service: "northwind-orders",
      operation: "massReadOrder",
      interactionMode: "one_way",
      correlationId: `northwind:order:${order.OrderID}`,
      contract: "order-v1",
      transportStatus: "received",
    },
    {},
    adaptation.issues,
  );

  traces.push({
    recordId: adaptation.raw.AUFTRAGS_NR,
    sourceOrderId: order.OrderID,
    customerId: order.CustomerID ?? "",
    detailCount: orderDetails.length,
    sourceQuantities: orderDetails.map(({ Quantity }) => Quantity).join(" | "),
    shippedDate: order.ShippedDate ?? "",
    freight: order.Freight ?? "",
    schemaGate: "ACCEPTED",
    adapterStatus: adaptation.raw.STATUS,
    adapterQuantity: adaptation.raw.MENGE,
    canonicalStatus: evaluation.mapped.status ?? "",
    canonicalQuantity: evaluation.mapped.quantity ?? "",
    bridgeState: evaluation.state.state,
    releaseAllowed: evaluation.release.releaseAllowed,
    blockingIssues: evaluation.release.blockingIssues,
    blockingReasonIds: evaluation.constraints.filter(({ passed, severity }) => !passed && severity === "blocking").map(({ id }) => id).join(" | "),
    adapterConflictCodes: adaptation.issues.map(({ code, field }) => `${code}:${field}`).join(" | "),
  });
}

const counts = (key) => Object.fromEntries(
  [...new Set(traces.map((row) => String(row[key])))].sort().map((value) => [value, traces.filter((row) => String(row[key]) === value).length]),
);

const summary = {
  proofType: "mass data evaluation, not 830 unit tests",
  source: {
    repository: "neo4j-contrib/northwind-neo4j",
    commit: SOURCE_COMMIT,
    ordersUrl: ordersSource.url,
    orderDetailsUrl: detailsSource.url,
  },
  sourceOrders: orders.length,
  sourceOrderDetails: details.length,
  processed: traces.length,
  schemaGate: counts("schemaGate"),
  bridgeState: counts("bridgeState"),
  releaseAllowed: counts("releaseAllowed"),
  blockingIssues: counts("blockingIssues"),
  traceRecordsWritten: traces.length,
  note: "CUSTOMER_MISMATCH is intentionally not claimed by this run because customer identity is sourced from Orders.CustomerID; the separate conflict test proves that guard rail.",
};

await mkdir(OUT_DIR, { recursive: true });
await writeFile(`${OUT_DIR}/source-orders.csv`, ordersSource.text);
await writeFile(`${OUT_DIR}/source-order-details.csv`, detailsSource.text);
await writeFile(`${OUT_DIR}/external-northwind-830-traces.jsonl`, traces.map((row) => JSON.stringify(row)).join("\n") + "\n");
await writeFile(`${OUT_DIR}/external-northwind-mass-summary.json`, JSON.stringify(summary, null, 2) + "\n");

const headers = Object.keys(traces[0]);
const csv = [headers.join(","), ...traces.map((row) => headers.map((key) => csvCell(row[key])).join(","))].join("\n") + "\n";
await writeFile(`${OUT_DIR}/external-northwind-830-traces.csv`, csv);

console.log("NORTHWIND MASS RUN");
console.log(`Source commit:         ${SOURCE_COMMIT}`);
console.log(`Source orders:         ${summary.sourceOrders}`);
console.log(`Processed:             ${summary.processed}`);
console.log(`Schema gate accepted:  ${summary.schemaGate.ACCEPTED ?? 0}`);
console.log(`BLOCKED:               ${summary.bridgeState.BLOCKED ?? 0}`);
console.log(`NEEDS_CONFIRMATION:    ${summary.bridgeState.NEEDS_CONFIRMATION ?? 0}`);
console.log(`Release allowed true:  ${summary.releaseAllowed.true ?? 0}`);
console.log(`Trace records written: ${summary.traceRecordsWritten}`);
