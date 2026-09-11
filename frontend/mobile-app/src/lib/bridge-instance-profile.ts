export type EvidenceStatus = "confirmed" | "candidate" | "unresolved";

export type IdentityKind =
  | "source_record_identifier"
  | "candidate_entity_identifier"
  | "composite_identifier";

export type IdentityPart = {
  field: string;
  value: string;
  present: boolean;
};

export type ObservedIdentity = {
  subject: string;
  kind: IdentityKind;
  parts: IdentityPart[];
  status: EvidenceStatus;
  evidence: string[];
  note: string;
};

export type RelationDirection = "unidirectional" | "bidirectional" | "unknown";
export type RelationCardinality = "one_to_one" | "one_to_many" | "many_to_one" | "many_to_many" | "unknown";

export type RelationProfile = {
  id: string;
  sourceEntity: string;
  targetEntity: string;
  direction: RelationDirection;
  cardinality: RelationCardinality;
  sourceFields: string[];
  targetFields: string[];
  technicalLinkStatus: EvidenceStatus;
  semanticMeaningStatus: EvidenceStatus;
  evidence: string[];
  note: string;
};

export type ConfirmedInstanceProfile = {
  source: string;
  sourceSnapshotId: string;
  observedAt: string;
  identities: ObservedIdentity[];
  relations: RelationProfile[];
};

export type OrderIdentitySource = {
  KUNDEN_NR: string;
  AUFTRAGS_NR: string;
};

function hasValue(value: string): boolean {
  const normalized = value.trim().toUpperCase();
  return normalized !== "" && normalized !== "NULL" && normalized !== "N/A";
}

/**
 * Builds the smallest conservative identity/relation view for the current
 * order demo contract.
 *
 * Important: the record fields prove that identifiers are present in the
 * payload. They do NOT prove database primary keys, foreign-key constraints,
 * owner-side metadata or source cardinality. Those stay candidate/unknown
 * until source metadata or other evidence confirms them.
 */
export function buildOrderInstanceProfile(input: {
  raw: OrderIdentitySource;
  source: string;
  sourceSnapshotId: string;
  observedAt: string;
}): ConfirmedInstanceProfile {
  const { raw, source, sourceSnapshotId, observedAt } = input;
  const orderIdPresent = hasValue(raw.AUFTRAGS_NR);
  const customerIdPresent = hasValue(raw.KUNDEN_NR);

  const orderIdentity: ObservedIdentity = {
    subject: "order",
    kind: "source_record_identifier",
    parts: [{ field: "AUFTRAGS_NR", value: raw.AUFTRAGS_NR, present: orderIdPresent }],
    status: orderIdPresent ? "confirmed" : "unresolved",
    evidence: [
      "order-v1 contract names AUFTRAGS_NR as the order identifier in the source payload",
      `snapshot:${sourceSnapshotId}`,
    ],
    note: "Confirmed as the source record identifier for this bridge payload; not asserted as a database primary key.",
  };

  const customerIdentity: ObservedIdentity = {
    subject: "customer_reference",
    kind: "candidate_entity_identifier",
    parts: [{ field: "KUNDEN_NR", value: raw.KUNDEN_NR, present: customerIdPresent }],
    status: customerIdPresent ? "candidate" : "unresolved",
    evidence: [
      "order-v1 payload contains KUNDEN_NR and the semantic map describes it as a customer identifier",
      `snapshot:${sourceSnapshotId}`,
    ],
    note: "The payload identifies a customer reference, but no customer-table primary-key metadata is claimed.",
  };

  const orderToCustomer: RelationProfile = {
    id: "order_to_customer_reference",
    sourceEntity: "order",
    targetEntity: "customer",
    direction: "unidirectional",
    cardinality: "unknown",
    sourceFields: ["KUNDEN_NR"],
    targetFields: [],
    technicalLinkStatus: customerIdPresent ? "candidate" : "unresolved",
    semanticMeaningStatus: customerIdPresent ? "confirmed" : "unresolved",
    evidence: [
      "KUNDEN_NR is present on the order payload",
      "current mapping confirms the field meaning as customer identifier",
      "no source foreign-key or target-table metadata has been observed yet",
      `snapshot:${sourceSnapshotId}`,
    ],
    note: "Meaning is known at payload level. Technical FK, target key, owner side and cardinality remain unconfirmed.",
  };

  return {
    source,
    sourceSnapshotId,
    observedAt,
    identities: [orderIdentity, customerIdentity],
    relations: [orderToCustomer],
  };
}
