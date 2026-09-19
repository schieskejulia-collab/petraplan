import type { RawRecord } from "./bridge-pipeline";

export type NorthwindCustomer = {
  CustomerID: string;
  CompanyName: string;
  ContactName?: string | null;
  ContactTitle?: string | null;
  Address?: string | null;
  City?: string | null;
  Region?: string | null;
  PostalCode?: string | null;
  Country?: string | null;
};

export type NorthwindOrder = {
  OrderID: number;
  CustomerID: string | null;
  EmployeeID?: number | null;
  OrderDate: string | null;
  RequiredDate?: string | null;
  ShippedDate?: string | null;
  ShipVia?: number | null;
  Freight?: number | null;
  ShipName?: string | null;
  ShipAddress?: string | null;
  ShipCity?: string | null;
  ShipRegion?: string | null;
  ShipPostalCode?: string | null;
  ShipCountry?: string | null;
};

export type NorthwindOrderDetail = {
  OrderID: number;
  ProductID: number;
  UnitPrice: number;
  Quantity: number;
  Discount: number;
};

export type NorthwindOrderEnvelope = {
  source: string;
  customer: NorthwindCustomer;
  order: NorthwindOrder;
  orderDetails: NorthwindOrderDetail[];
};

export type NorthwindAdaptationIssue = {
  field: keyof RawRecord;
  code: "NO_CONFIRMED_SEMANTIC_MAPPING" | "NO_ORDER_DETAILS" | "CUSTOMER_MISMATCH";
  message: string;
  blocking: true;
};

export type NorthwindAdaptation = {
  sourceSnapshot: NorthwindOrderEnvelope;
  raw: RawRecord;
  issues: NorthwindAdaptationIssue[];
  evidence: {
    customerIdSource: "order.CustomerID";
    orderIdSource: "order.OrderID";
    quantitySource: "orderDetails[0].Quantity" | "unmapped";
    dateSource: "order.OrderDate";
    statusSource: "unmapped";
  };
};

function isoDateOnly(value: string | null): string {
  if (!value) return "";
  const match = value.match(/^(\d{4}-\d{2}-\d{2})/);
  return match?.[1] ?? value;
}

/**
 * Read-only source adapter for the classic Northwind order shape.
 *
 * It deliberately does NOT invent business semantics:
 * - STATUS stays empty because Northwind has no confirmed equivalent to the
 *   bridge status value map.
 * - MENGE is mapped only when exactly one Order_Detail exists. With multiple
 *   product rows, summing quantities would invent an unconfirmed meaning for
 *   the bridge's single MENGE field, so the value stays empty and is blocked.
 *
 * The original envelope is preserved as sourceSnapshot and is never mutated.
 */
export function adaptNorthwindOrder(envelope: NorthwindOrderEnvelope): NorthwindAdaptation {
  const sourceSnapshot = structuredClone(envelope);
  const issues: NorthwindAdaptationIssue[] = [];

  if (envelope.customer.CustomerID !== envelope.order.CustomerID) {
    issues.push({
      field: "KUNDEN_NR",
      code: "CUSTOMER_MISMATCH",
      message: "Customer.CustomerID und Order.CustomerID stimmen nicht überein.",
      blocking: true,
    });
  }

  let quantity = "";
  let quantitySource: NorthwindAdaptation["evidence"]["quantitySource"] = "unmapped";

  if (envelope.orderDetails.length === 0) {
    issues.push({
      field: "MENGE",
      code: "NO_ORDER_DETAILS",
      message: "Der Auftrag enthält keine Order_Details; eine Menge kann nicht bestätigt werden.",
      blocking: true,
    });
  } else if (envelope.orderDetails.length === 1) {
    quantity = String(envelope.orderDetails[0].Quantity);
    quantitySource = "orderDetails[0].Quantity";
  } else {
    issues.push({
      field: "MENGE",
      code: "NO_CONFIRMED_SEMANTIC_MAPPING",
      message: "Mehrere Order_Details enthalten positionsbezogene Mengen; eine Summierung zu Bridge-MENGE ist fachlich nicht bestätigt.",
      blocking: true,
    });
  }

  issues.push({
    field: "STATUS",
    code: "NO_CONFIRMED_SEMANTIC_MAPPING",
    message: "Northwind Order enthält keinen bestätigten Gegenpart zum Bridge-Statusmodell; STATUS bleibt ungefüllt.",
    blocking: true,
  });

  return {
    sourceSnapshot,
    raw: {
      KUNDEN_NR: envelope.order.CustomerID ?? "",
      AUFTRAGS_NR: `A-${envelope.order.OrderID}`,
      STATUS: "",
      MENGE: quantity,
      DATUM: isoDateOnly(envelope.order.OrderDate),
    },
    issues,
    evidence: {
      customerIdSource: "order.CustomerID",
      orderIdSource: "order.OrderID",
      quantitySource,
      dateSource: "order.OrderDate",
      statusSource: "unmapped",
    },
  };
}
