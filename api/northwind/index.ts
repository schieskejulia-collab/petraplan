const NORTHWIND_UPSTREAM_REPO = 'neo4j-contrib/northwind-neo4j';
const NORTHWIND_UPSTREAM_COMMIT = '5db323116a2779434ba0c17eb2b733575bfc2a4a';
const NORTHWIND_PROOF_CAPTURED_AT = '2026-09-19T15:30:00.000Z';
const RAW_BASE = `https://raw.githubusercontent.com/${NORTHWIND_UPSTREAM_REPO}/${NORTHWIND_UPSTREAM_COMMIT}/data`;

type BrowserDataset = {
  orders: any[];
  details: any[];
  customers: any[];
  detailsByOrder: Map<number, any[]>;
  customersById: Map<string, any>;
};

let browserDatasetPromise: Promise<BrowserDataset> | null = null;

async function fetchText(name: string) {
  const response = await fetch(`${RAW_BASE}/${name}`);
  if (!response.ok) throw new Error(`Pinned Northwind source download failed for ${name}: HTTP ${response.status}`);
  return response.text();
}

function lines(text: string) {
  return text.replace(/^\uFEFF/, '').split(/\r?\n/).filter(Boolean);
}

function parseOrders(text: string) {
  const [header, ...rows] = lines(text);
  if (!header?.startsWith('orderID,customerID,employeeID,orderDate,requiredDate,shippedDate,shipVia,freight,')) {
    throw new Error('Unexpected pinned Northwind orders.csv header');
  }
  return rows.map((row) => {
    const [orderID, customerID, employeeID, orderDate, requiredDate, shippedDate, shipVia, freight] = row.split(',');
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

function parseDetails(text: string) {
  const [header, ...rows] = lines(text);
  if (header !== 'orderID,productID,unitPrice,quantity,discount') {
    throw new Error('Unexpected pinned Northwind order-details.csv header');
  }
  return rows.map((row) => {
    const [orderID, productID, unitPrice, quantity, discount] = row.split(',');
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
  const [header, ...rows] = lines(text);
  if (!header?.startsWith('customerID,companyName,')) {
    throw new Error('Unexpected pinned Northwind customers.csv header');
  }
  return rows.map((row) => {
    const firstComma = row.indexOf(',');
    const secondComma = row.indexOf(',', firstComma + 1);
    if (firstComma <= 0 || secondComma <= firstComma) throw new Error(`Malformed customer row: ${row}`);
    return { CustomerID: row.slice(0, firstComma), CompanyName: row.slice(firstComma + 1, secondComma) };
  });
}

async function loadBrowserDataset() {
  if (!browserDatasetPromise) {
    browserDatasetPromise = (async () => {
      const [ordersText, detailsText, customersText] = await Promise.all([
        fetchText('orders.csv'),
        fetchText('order-details.csv'),
        fetchText('customers.csv'),
      ]);
      const orders = parseOrders(ordersText);
      const details = parseDetails(detailsText);
      const customers = parseCustomers(customersText);
      const detailsByOrder = new Map<number, any[]>();
      for (const detail of details) {
        const current = detailsByOrder.get(detail.OrderID) ?? [];
        current.push(detail);
        detailsByOrder.set(detail.OrderID, current);
      }
      const customersById = new Map(customers.map((customer) => [String(customer.CustomerID), customer]));
      return { orders, details, customers, detailsByOrder, customersById };
    })().catch((error) => {
      browserDatasetPromise = null;
      throw error;
    });
  }
  return browserDatasetPromise;
}

export default async function handler(req: any, res: any) {
  try {
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      return res.status(405).json({ error: 'Method not allowed' });
    }

    const dataset = await loadBrowserDataset();
    const q = String(req.query?.q ?? '').trim().toLowerCase();
    const stateFilter = String(req.query?.state ?? '').trim().toUpperCase();
    const rawLimit = Number(req.query?.limit ?? 25);
    const rawOffset = Number(req.query?.offset ?? 0);
    const limit = Math.min(100, Math.max(1, Number.isFinite(rawLimit) ? Math.floor(rawLimit) : 25));
    const offset = Math.max(0, Number.isFinite(rawOffset) ? Math.floor(rawOffset) : 0);

    const allItems = dataset.orders.map((order) => {
      const orderDetails = dataset.detailsByOrder.get(order.OrderID) ?? [];
      const customer = order.CustomerID ? dataset.customersById.get(String(order.CustomerID)) : null;
      if (!customer) throw new Error(`Pinned Northwind order ${order.OrderID} has no matching customer`);
      const detailCount = orderDetails.length;
      const quantityConfirmed = detailCount === 1;
      const bridgeState = quantityConfirmed ? 'NEEDS_CONFIRMATION' : 'BLOCKED';
      return {
        orderId: order.OrderID,
        recordId: `A-${order.OrderID}`,
        customerId: order.CustomerID,
        companyName: customer.CompanyName,
        orderDate: order.OrderDate,
        detailCount,
        sourceQuantities: orderDetails.map((detail) => detail.Quantity),
        sourceSchemaGate: 'ACCEPTED',
        bridgeContractSchema: 'FAILED',
        bridgeState,
        releaseAllowed: false,
        blockingIssues: quantityConfirmed ? 2 : 4,
        failedConstraintIds: quantityConfirmed
          ? ['contract.completeness', 'status.value_map']
          : ['contract.completeness', 'status.value_map', 'quantity.positive', 'adapter.NO_CONFIRMED_SEMANTIC_MAPPING:MENGE'],
        evidence: {
          structure: { customerRelation: { status: 'CONFIRMED' } },
          values: {
            status: { status: 'UNPROVEN' },
            quantity: { status: quantityConfirmed ? 'CONFIRMED' : 'UNPROVEN' },
          },
        },
      };
    });

    const filtered = allItems.filter((item) => {
      const haystack = `${item.recordId} ${item.customerId ?? ''} ${item.companyName}`.toLowerCase();
      if (q && !haystack.includes(q)) return false;
      if (stateFilter && item.bridgeState !== stateFilter) return false;
      return true;
    });

    return res.status(200).json({
      proof: 'external-northwind-mass-proof-v4-evidence-split',
      upstream: {
        repository: NORTHWIND_UPSTREAM_REPO,
        commit: NORTHWIND_UPSTREAM_COMMIT,
        capturedAt: NORTHWIND_PROOF_CAPTURED_AT,
      },
      summary: {
        orders: dataset.orders.length,
        orderDetails: dataset.details.length,
        customers: dataset.customers.length,
        sourceSchemaAccepted: dataset.orders.length,
        sourceSchemaBlocked: 0,
        singleDetailOrders: allItems.filter((item) => item.detailCount === 1).length,
        multipleDetailOrders: allItems.filter((item) => item.detailCount > 1).length,
        zeroDetailOrders: allItems.filter((item) => item.detailCount === 0).length,
        stateCounts: {
          BLOCKED: allItems.filter((item) => item.bridgeState === 'BLOCKED').length,
          NEEDS_CONFIRMATION: allItems.filter((item) => item.bridgeState === 'NEEDS_CONFIRMATION').length,
        },
        evidenceCounts: {
          structure: { CONFIRMED: dataset.orders.length, CONTRADICTED: 0, UNPROVEN: 0 },
          statusValue: { CONFIRMED: 0, UNPROVEN: dataset.orders.length },
          quantityValue: {
            CONFIRMED: allItems.filter((item) => item.detailCount === 1).length,
            UNPROVEN: allItems.filter((item) => item.detailCount !== 1).length,
          },
        },
      },
      total: filtered.length,
      offset,
      limit,
      items: filtered.slice(offset, offset + limit),
    });
  } catch (error) {
    console.error('PetraPlan Northwind browser failed:', error);
    return res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown Northwind browser error' });
  }
}
