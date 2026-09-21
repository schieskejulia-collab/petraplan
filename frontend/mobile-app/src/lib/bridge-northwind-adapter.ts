import type { RawRecord } from "./bridge-pipeline.js";
import {
  classifyStructureEvidence,
  classifyValueEvidence,
  type StructureEvidenceResult,
  type ValueEvidenceResult,
} from "./bridge-evidence.js";
import {
  assessSchemaDrift,
  type SchemaDriftAssessment,
  type SchemaPathRule,
} from "./bridge-schema-drift.js";
import {
  observeSourceStructure,
  type SourceStructureObservation,
} from "./bridge-source-observation.js";

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
    statusSource: "order.ShippedDate" | "unmapped";
    structure: {
      customerRelation: StructureEvidenceResult;
    };
    values: {
      status: ValueEvidenceResult;
      quantity: ValueEvidenceResult;
    };
  };
};

export type NorthwindSafeAdaptation =
  | {
      accepted: true;
      structureObservation: SourceStructureObservation;
      drift: SchemaDriftAssessment;
      sourceSnapshot: unknown;
      adaptation: NorthwindAdaptation;
    }
  | {
      accepted: false;
      structureObservation: SourceStructureObservation;
      drift: SchemaDriftAssessment;
      sourceSnapshot: unknown;
      adaptation: null;
    };

export const northwindRuntimeSchemaContract: SchemaPathRule[] = [
  { path: "source", expectedTypes: ["string"], required: true },
  { path: "customer", expectedTypes: ["object"], required: true },
  { path: "customer.CustomerID", expectedTypes: ["string"], required: true },
  { path: "customer.CompanyName", expectedTypes: ["string"], required: true },
  { path: "order", expectedTypes: ["object"], required: true },
  { path: "order.OrderID", expectedTypes: ["number"], required: true },
  { path: "order.CustomerID", expectedTypes: ["string", "null"], required: true },
  { path: "order.OrderDate", expectedTypes: ["string", "null"], required: true },
  { path: "orderDetails", expectedTypes: ["array"], required: true },
  { path: "orderDetails[].OrderID", expectedTypes: ["number"], required: true },
  { path: "orderDetails[].ProductID", expectedTypes: ["number"], required: true },
  { path: "orderDetails[].UnitPrice", expectedTypes: ["number"], required: true },
  { path: "orderDetails[].Quantity", expectedTypes: ["number"], required: true },
  { path: "orderDetails[].Discount", expectedTypes: ["number"], required: true },
];

function isoDateOnly(value: string | null): string {
  if (!value) return "";
  const match = value.match(/^(\d{4}-\d{2}-\d{2})/);
  return match?.[1] ?? value;
}

/**
 * Read-only source adapter for the classic Northwind order shape.
 *
 * The adapter preserves the original proof behaviour: a single position can
 * supply its quantity directly, but multiple position quantities are never
 * silently summed into an order-level meaning. ShippedDate is retained as a
 * source fact, not translated into the bridge status without confirmed
 * authority evidence. The original envelope is never mutated.
 */
export function adaptNorthwindOrder(envelope: NorthwindOrderEnvelope): NorthwindAdaptation {
  const sourceSnapshot = structuredClone(envelope);
  const issues: NorthwindAdaptationIssue[] = [];

  const customerRelation = classifyStructureEvidence({
    subject: "order.CustomerID",
    relatedTo: "customer.CustomerID",
    documentedRelation: true,
    subjectValue: envelope.order.CustomerID,
    relatedValue: envelope.customer.CustomerID,
    sourceReference: "Northwind adapter relation contract + observed matching customer row",
  });

  if (customerRelation.status === "CONTRADICTED") {
    issues.push({
      field: "KUNDEN_NR",
      code: "CUSTOMER_MISMATCH",
      message: "Customer.CustomerID und Order.CustomerID stimmen nicht überein.",
      blocking: true,
    });
  }

  let quantity = "";
  let quantitySource: NorthwindAdaptation["evidence"]["quantitySource"] = "unmapped";
  let quantityValueEvidence: ValueEvidenceResult;

  if (envelope.orderDetails.length === 0) {
    issues.push({
      field: "MENGE",
      code: "NO_ORDER_DETAILS",
      message: "Der Auftrag enthält keine Order_Details; eine Menge kann nicht bestätigt werden.",
      blocking: true,
    });
    quantityValueEvidence = classifyValueEvidence({
      field: "MENGE",
      sourceValue: null,
      confirmedMapping: null,
      sourceReference: null,
    });
  } else if (envelope.orderDetails.length === 1) {
    quantity = String(envelope.orderDetails[0].Quantity);
    quantitySource = "orderDetails[0].Quantity";
    quantityValueEvidence = classifyValueEvidence({
      field: "MENGE",
      sourceValue: envelope.orderDetails[0].Quantity,
      confirmedMapping: envelope.orderDetails[0].Quantity,
      sourceReference: "Northwind adapter rule: exactly one Order_Detail.Quantity maps directly to Bridge MENGE",
    });
  } else {
    issues.push({
      field: "MENGE",
      code: "NO_CONFIRMED_SEMANTIC_MAPPING",
      message: "Mehrere Order_Details enthalten positionsbezogene Mengen; eine Summierung zu Bridge-MENGE ist fachlich nicht bestätigt.",
      blocking: true,
    });
    quantityValueEvidence = classifyValueEvidence({
      field: "MENGE",
      sourceValue: envelope.orderDetails.map(({ Quantity }) => Quantity),
      confirmedMapping: null,
      sourceReference: null,
    });
  }

  const statusValueEvidence = classifyValueEvidence({
    field: "STATUS",
    sourceValue: null,
    confirmedMapping: null,
    sourceReference: null,
  });
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
      structure: {
        customerRelation,
      },
      values: {
        status: statusValueEvidence,
        quantity: quantityValueEvidence,
      },
    },
  };
}

/**
 * Runtime gate for foreign Northwind-shaped payloads.
 * First the source is observed exactly as received. Only after that observation
 * is the explicit runtime contract checked. A changed/missing critical source
 * path is treated as schema drift and is never silently guessed.
 */
export function adaptNorthwindOrderSafely(source: unknown): NorthwindSafeAdaptation {
  const sourceSnapshot = structuredClone(source);
  const structureObservation = observeSourceStructure(source);
  const drift = assessSchemaDrift(source, "northwind-order-envelope-v1", northwindRuntimeSchemaContract);

  if (!drift.compatible) {
    return {
      accepted: false,
      structureObservation,
      drift,
      sourceSnapshot,
      adaptation: null,
    };
  }

  return {
    accepted: true,
    structureObservation,
    drift,
    sourceSnapshot,
    adaptation: adaptNorthwindOrder(source as NorthwindOrderEnvelope),
  };
}
