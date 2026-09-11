import type { EvidenceStatus, RelationCardinality, RelationProfile } from "./bridge-instance-profile";

export type RelationEvidence = {
  relationId: string;
  targetEntity: string;
  sourceField: string;
  sourceValue: string;
  targetField?: string;
  targetValue?: string;
  targetRecordObserved?: boolean;
  foreignKeyConstraintObserved?: boolean;
  cardinality?: RelationCardinality;
  evidence: string[];
};

export type RelationVerification = {
  relationId: string;
  semanticStatus: EvidenceStatus;
  targetIdentityStatus: EvidenceStatus;
  technicalLinkStatus: EvidenceStatus;
  foreignKeyConstraintStatus: EvidenceStatus;
  cardinalityStatus: EvidenceStatus;
  cardinality: RelationCardinality;
  sourceField: string | null;
  targetField: string | null;
  matchedValue: string | null;
  evidence: string[];
  blockers: string[];
  note: string;
};

/**
 * Verifies only what the supplied evidence can actually prove.
 *
 * A matching source/target identifier can confirm an observed link between two
 * records. It does NOT prove that a database foreign-key constraint exists.
 * Cardinality is likewise left unresolved unless source metadata explicitly
 * provides it.
 */
export function verifyRelation(
  relation: RelationProfile,
  evidence?: RelationEvidence,
): RelationVerification {
  const sourceField = relation.sourceFields[0] ?? null;

  if (!evidence) {
    return {
      relationId: relation.id,
      semanticStatus: relation.semanticMeaningStatus,
      targetIdentityStatus: "unresolved",
      technicalLinkStatus: relation.technicalLinkStatus,
      foreignKeyConstraintStatus: "unresolved",
      cardinalityStatus: relation.cardinality === "unknown" ? "unresolved" : "confirmed",
      cardinality: relation.cardinality,
      sourceField,
      targetField: null,
      matchedValue: null,
      evidence: [...relation.evidence],
      blockers: [
        "Kein beobachteter Ziel-Datensatz für die Referenzprüfung vorhanden.",
        "Kein bestätigtes Zielschlüsselfeld vorhanden.",
        ...(relation.cardinality === "unknown" ? ["Kardinalität ist nicht durch Quellenmetadaten bestätigt."] : []),
      ],
      note: "Die fachliche Bedeutung kann bekannt sein, der konkrete technische Link bleibt ohne Zielbeleg unbestätigt.",
    };
  }

  const relationMatches = evidence.relationId === relation.id && evidence.targetEntity === relation.targetEntity;
  const sourceFieldMatches = sourceField !== null && evidence.sourceField === sourceField;
  const targetIdentityKnown = Boolean(evidence.targetField && evidence.targetValue !== undefined);
  const valuesMatch = targetIdentityKnown && evidence.sourceValue === evidence.targetValue;
  const targetObserved = evidence.targetRecordObserved === true;

  const targetIdentityStatus: EvidenceStatus =
    relationMatches && targetIdentityKnown && targetObserved ? "confirmed" : targetIdentityKnown ? "candidate" : "unresolved";

  const technicalLinkStatus: EvidenceStatus =
    relationMatches && sourceFieldMatches && valuesMatch && targetObserved
      ? "confirmed"
      : relationMatches && sourceFieldMatches
        ? "candidate"
        : "unresolved";

  const foreignKeyConstraintStatus: EvidenceStatus = evidence.foreignKeyConstraintObserved === true
    ? "confirmed"
    : "unresolved";

  const cardinality = evidence.cardinality ?? relation.cardinality;
  const cardinalityStatus: EvidenceStatus = cardinality === "unknown" ? "unresolved" : "confirmed";

  const blockers: string[] = [];
  if (!relationMatches) blockers.push("Der Zielbeleg gehört nicht zur erwarteten Beziehung.");
  if (!sourceFieldMatches) blockers.push("Das belegte Quellfeld stimmt nicht mit dem Relationsprofil überein.");
  if (!targetIdentityKnown) blockers.push("Das Zielschlüsselfeld oder sein Wert ist nicht bestätigt.");
  if (targetIdentityKnown && !valuesMatch) blockers.push("Quell- und Zielkennung stimmen nicht überein.");
  if (!targetObserved) blockers.push("Der Ziel-Datensatz wurde nicht als beobachtet bestätigt.");
  if (foreignKeyConstraintStatus !== "confirmed") blockers.push("Ein Datenbank-Foreign-Key-Constraint ist nicht beobachtet.");
  if (cardinalityStatus !== "confirmed") blockers.push("Die Kardinalität ist nicht durch Quellenmetadaten bestätigt.");

  return {
    relationId: relation.id,
    semanticStatus: relation.semanticMeaningStatus,
    targetIdentityStatus,
    technicalLinkStatus,
    foreignKeyConstraintStatus,
    cardinalityStatus,
    cardinality,
    sourceField,
    targetField: evidence.targetField ?? null,
    matchedValue: valuesMatch ? evidence.sourceValue : null,
    evidence: [...relation.evidence, ...evidence.evidence],
    blockers,
    note: technicalLinkStatus === "confirmed"
      ? "Der beobachtete Quellwert verweist auf einen beobachteten Ziel-Datensatz mit derselben bestätigten Kennung. Das bestätigt den konkreten Record-Link, nicht automatisch einen Datenbank-Constraint."
      : "Die vorhandenen Belege reichen noch nicht für einen bestätigten Record-Link.",
  };
}

export function verifyRelations(
  relations: RelationProfile[],
  evidence: RelationEvidence[] = [],
): RelationVerification[] {
  return relations.map((relation) =>
    verifyRelation(relation, evidence.find((entry) => entry.relationId === relation.id)),
  );
}
