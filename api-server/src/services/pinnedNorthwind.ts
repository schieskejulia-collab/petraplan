import { adaptNorthwindOrderSafely, type NorthwindOrderEnvelope } from '../../../frontend/mobile-app/src/lib/bridge-northwind-adapter.js';
import { evaluateRecordWithConflictTruth } from '../../../frontend/mobile-app/src/lib/bridge-conflict-truth.js';

export const NORTHWIND_UPSTREAM_REPO = 'neo4j-contrib/northwind-neo4j';
export const NORTHWIND_UPSTREAM_COMMIT = '5db323116a2779434ba0c17eb2b733575bfc2a4a';
export const NORTHWIND_PROOF_CAPTURED_AT = '2026-09-19T15:30:00.000Z';
const RAW_BASE = `https://raw.githubusercontent.com/${NORTHWIND_UPSTREAM_REPO}/${NORTHWIND_UPSTREAM_COMMIT}/data`;

type NorthwindDataset = {
  orders: any[];
  details: any[];
  customers: any[];
  customersById: Map<string, any>;
  detailsByOrder: Map<number, any[]>;
};

let datasetPromise: Promise<NorthwindDataset> | null = null;

async function fetchText(name: string) {
  const response = await fetch(`${RAW_BASE}/${name}`);
  if (!response.ok) throw new Error(`Northwind upstream download failed for ${name}: ${response.status}`);
  return response.text();
}

function nonEmptyLines(text: string) {
  return text.replace(/^\uFEFF/, '').split(/\r?\n/).filter((line) => line.length > 0);
}

function parseOrders(text: string) {
  const [header, ...lines] = nonEmptyLines(text);
  if (!header?.startsWith('orderID,customerID,employeeID,orderDate,requiredDate,shippedDate,shipVia,freight,')) {
    throw new Error('Unexpected pinned Northwind orders.csv header');
  }
  return lines.map((line) => {
    const parts = line.split(',');
    if (parts.length < 8) throw new Error(`Malformed pinned Northwind order row: ${line}`);
    const [orderID, customerID, employeeID, orderDate, requiredDate, shippedDate, shipVia, freight] = parts;
    return {
      OrderID: Number(orderID),
      CustomerID: customerID === 'NULL' ? null : customerID,
      EmployeeID: employeeID === 'NULL' ? null : Number(employeeID),
      OrderDate: orderDate === 'NULL' ? null : orderDate,
      RequiredDate: requiredDate === 'NULL' ? null : requiredDate,
      ShippedDate: shippedDate === 'NULL' ? null : shippedDate,
      ShipVia: shipVia === 'NULL' ? null : Number(shipVia),
      Freight: freight === 'NULL' ? null : Number(freight),
    };
  });
}

function parseOrderDetails(text: string) {
  const [header, ...lines] = nonEmptyLines(text);
  if (header !== 'orderID,productID,unitPrice,quantity,discount') {
    throw new Error('Unexpected pinned Northwind order-details.csv header');
  }
  return lines.map((line) => {
    const [orderID, productID, unitPrice, quantity, discount] = line.split(',');
    return {
      OrderID: Number(orderID),
      ProductID: Number(productID),
      UnitPrice: Number(unitPrice),
      Quantity: Number(quantity),
      Discount: Number(discount),
    };
  });
}

function parseCustomers(text: string) {
  const [header, ...lines] = nonEmptyLines(text);
  if (!header?.startsWith('customerID,companyName,')) {
    throw new Error('Unexpected pinned Northwind customers.csv header');
  }
  return lines.map((line) => {
    const firstComma = line.indexOf(',');
    const secondComma = line.indexOf(',', firstComma + 1);
    if (firstComma <= 0 || secondComma <= firstComma) throw new Error(`Malformed pinned Northwind customer row: ${line}`);
    return {
      CustomerID: line.slice(0, firstComma),
      CompanyName: line.slice(firstComma + 1, secondComma),
    };
  });
}

async function loadDataset(): Promise<NorthwindDataset> {
  if (!datasetPromise) {
    datasetPromise = (async () => {
      const [ordersText, detailsText, customersText] = await Promise.all([
        fetchText('orders.csv'),
        fetchText('order-details.csv'),
        fetchText('customers.csv'),
      ]);
      const orders = parseOrders(ordersText);
      const details = parseOrderDetails(detailsText);
      const customers = parseCustomers(customersText);
      const customersById = new Map(customers.map((customer) => [String(customer.CustomerID), customer]));
      const detailsByOrder = new Map<number, any[]>();
      for (const detail of details) {
        const list = detailsByOrder.get(detail.OrderID) ?? [];
        list.push(detail);
        detailsByOrder.set(detail.OrderID, list);
      }
      return { orders, details, customers, customersById, detailsByOrder };
    })();
  }
  return datasetPromise;
}

function envelopeFor(dataset: NorthwindDataset, order: any): NorthwindOrderEnvelope {
  const customer = order.CustomerID ? dataset.customersById.get(String(order.CustomerID)) : null;
  if (!customer) throw new Error(`Pinned Northwind order ${order.OrderID} has no matching customer`);
  return {
    source: `${NORTHWIND_UPSTREAM_REPO}@${NORTHWIND_UPSTREAM_COMMIT}`,
    customer: structuredClone(customer),
    order: structuredClone(order),
    orderDetails: structuredClone(dataset.detailsByOrder.get(order.OrderID) ?? []),
  };
}

export async function getPinnedNorthwindOrder(orderId: number, capturedAt = NORTHWIND_PROOF_CAPTURED_AT) {
  const dataset = await loadDataset();
  const order = dataset.orders.find((item) => Number(item.OrderID) === Number(orderId));
  if (!order) return null;
  const envelope = envelopeFor(dataset, order);
  const safe = adaptNorthwindOrderSafely(envelope);
  if (!safe.accepted || !safe.adaptation) {
    return {
      orderId,
      envelope,
      sourceSchemaGate: 'BLOCKED' as const,
      sourceSchemaIssues: safe.drift.issues,
      adaptation: null,
      evaluation: null,
    };
  }
  const evaluation = evaluateRecordWithConflictTruth(
    safe.adaptation.raw,
    capturedAt,
    {
      source: envelope.source,
      transport: 'file',
      destination: 'petraplan-bridge',
      service: 'external-northwind-mass-proof',
      operation: 'readOrder',
      interactionMode: 'one_way',
      correlationId: `external-northwind:order:${order.OrderID}`,
      contract: 'order-v1',
      transportStatus: 'received',
    },
    {},
    safe.adaptation.issues.map((issue) => ({ ...issue })),
  );
  return {
    orderId,
    envelope,
    sourceSchemaGate: 'ACCEPTED' as const,
    sourceSchemaIssues: safe.drift.issues,
    adaptation: safe.adaptation,
    evaluation,
  };
}

export async function listPinnedNorthwindOrders(input: {
  q?: string;
  state?: string;
  offset?: number;
  limit?: number;
} = {}) {
  const dataset = await loadDataset();
  const q = String(input.q ?? '').trim().toLowerCase();
  const state = String(input.state ?? '').trim().toUpperCase();
  const offset = Math.max(0, Math.floor(input.offset ?? 0));
  const limit = Math.min(100, Math.max(1, Math.floor(input.limit ?? 25)));

  const summaries = [] as any[];
  const stateCounts: Record<string, number> = {};
  let sourceAccepted = 0;
  let sourceBlocked = 0;
  let singleDetail = 0;
  let multipleDetail = 0;
  let zeroDetail = 0;

  for (const order of dataset.orders) {
    const detailCount = (dataset.detailsByOrder.get(order.OrderID) ?? []).length;
    if (detailCount === 0) zeroDetail += 1;
    else if (detailCount === 1) singleDetail += 1;
    else multipleDetail += 1;
    const result = await getPinnedNorthwindOrder(order.OrderID);
    if (!result || result.sourceSchemaGate === 'BLOCKED' || !result.evaluation) {
      sourceBlocked += 1;
      continue;
    }
    sourceAccepted += 1;
    const bridgeState = result.evaluation.state.state;
    stateCounts[bridgeState] = (stateCounts[bridgeState] ?? 0) + 1;
    const item = {
      orderId: order.OrderID,
      recordId: `A-${order.OrderID}`,
      customerId: order.CustomerID,
      companyName: result.envelope.customer.CompanyName,
      orderDate: order.OrderDate,
      detailCount,
      sourceQuantities: result.envelope.orderDetails.map((detail) => detail.Quantity),
      sourceSchemaGate: result.sourceSchemaGate,
      bridgeContractSchema: result.evaluation.constraints.find((constraint) => constraint.id === 'contract.schema')?.passed ? 'PASSED' : 'FAILED',
      bridgeState,
      releaseAllowed: result.evaluation.release.releaseAllowed,
      blockingIssues: result.evaluation.release.blockingIssues,
      failedConstraintIds: result.evaluation.constraints.filter((constraint) => !constraint.passed && constraint.severity === 'blocking').map((constraint) => constraint.id),
    };
    const haystack = `${item.recordId} ${item.customerId ?? ''} ${item.companyName}`.toLowerCase();
    if (q && !haystack.includes(q)) continue;
    if (state && bridgeState !== state) continue;
    summaries.push(item);
  }

  return {
    proof: 'external-northwind-mass-proof-v3',
    upstream: {
      repository: NORTHWIND_UPSTREAM_REPO,
      commit: NORTHWIND_UPSTREAM_COMMIT,
      capturedAt: NORTHWIND_PROOF_CAPTURED_AT,
    },
    summary: {
      orders: dataset.orders.length,
      orderDetails: dataset.details.length,
      customers: dataset.customers.length,
      sourceSchemaAccepted: sourceAccepted,
      sourceSchemaBlocked: sourceBlocked,
      singleDetailOrders: singleDetail,
      multipleDetailOrders: multipleDetail,
      zeroDetailOrders: zeroDetail,
      stateCounts,
    },
    total: summaries.length,
    offset,
    limit,
    items: summaries.slice(offset, offset + limit),
  };
}
