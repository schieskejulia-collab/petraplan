import { demoValidRecord } from "./bridge-pipeline";
import type { RelationEvidence } from "./bridge-relation-verification";

export type DemoObservedCustomer = {
  CUSTOMER_ID: string;
  NAME: string;
  observedAt: string;
  source: string;
};

/**
 * Demo-only observed target record. This is deliberately separate from the
 * order payload so the bridge has to compare a source reference with an
 * independently observed target identity.
 */
export const demoObservedCustomer: DemoObservedCustomer = {
  CUSTOMER_ID: "4711",
  NAME: "Demo Kunde 4711",
  observedAt: "2026-09-11T18:10:00.000Z",
  source: "demo-customer-source",
};

/**
 * Evidence proves only the concrete record link for the demo:
 * order.KUNDEN_NR === customer.CUSTOMER_ID.
 *
 * It intentionally does NOT claim that a database FK constraint or source
 * cardinality has been observed.
 */
export const demoOrderToCustomerEvidence: RelationEvidence = {
  relationId: "order_to_customer_reference",
  targetEntity: "customer",
  sourceField: "KUNDEN_NR",
  sourceValue: demoValidRecord.KUNDEN_NR,
  targetField: "CUSTOMER_ID",
  targetValue: demoObservedCustomer.CUSTOMER_ID,
  targetRecordObserved: true,
  foreignKeyConstraintObserved: false,
  evidence: [
    `order-v1:KUNDEN_NR=${demoValidRecord.KUNDEN_NR}`,
    `demo-customer-source:CUSTOMER_ID=${demoObservedCustomer.CUSTOMER_ID}`,
    `target-observed-at:${demoObservedCustomer.observedAt}`,
  ],
};
