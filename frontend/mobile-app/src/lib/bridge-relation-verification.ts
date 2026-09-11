import type { EvidenceStatus, RelationCardinality, RelationProfile } from "./bridge-instance-profile";

export type RelationEvidencePart = {
  sourceField: string;
  sourceValue: string;
  targetField: string;
  targetValue: string;
};

export type RelationEvidence = {
  relationId: string;
  targetEntity: string;
  sourceField: string;
  sourceValue: string;
  targetField?: string;
  targetValue?: string;
  identityParts?: RelationEvidencePart[];
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
  matchedParts: RelationEvidencePart[];
  evidence: string[];
  blockers: string[];
  note: string;
};

function normalizedEvidenceParts(evidence: RelationEvidence): RelationEvidencePart[] {
  if (evidence.identityParts && evidence.identityParts.length > 0) {
    return evidence.identityParts;
  }

  if (evidence.targetField && evidence.targetValue !== undefined) {
    return [{
      sourceField: evidence.sourceField,
      sourceValue: evidence.sourceValue,
      targetField: evidence.targetField,
      targetValue: evidence.targetValue,
    }];
  }

  return [];
}

function sameFieldSet(expected: string[], actual: string[]): boolean {
  if (expected.length !== actual.length) return false;
  const a = [...expected].sort();
  const b = [...actual].sort();
  return a.every((field, index) => field === b[index]);
}

/**
 * Verifies only what the supplied evidence can actually prove.
 *
 * A relation may be identified by one field or by multiple identity parts.
 * For a composite identity every required source part must be present and each
 * source value must match its observed target value before the concrete record
 * link can be confirmed.
 *
 * A confirmed record link still does NOT prove that a database foreign-key
 * constraint exists. Cardinality likewise stays unresolved unless source
 * metadata explicitly provides it.
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
      matchedParts: [],
      evidence: [...relation.evidence],
      blockers: [
        "Kein beobachteter Ziel-Datensatz für die Referenzprüfung vorhanden.",
        "Kein bestätigtes Zielschlüsselfeld vorhanden.",
        ...(relation.cardinality === "unknown" ? ["Kardinalität ist nicht durch Quellenmetadaten bestätigt."] : []),
      ],
      note: "Die fachliche Bedeutung kann bekannt sein, der konkrete technische Link bleibt ohne Zielbeleg unbestätigt.",
    };
  }

  const parts = normalizedEvidenceParts(evidence);
  const relationMatches = evidence.relationId === relation.id && evidence.targetEntity === relation.targetEntity;
  const suppliedSourceFields = parts.map(({ sourceField: field }) => field);
  const sourceFieldsMatch = sameFieldSet(relation.sourceFields, suppliedSourceFields);
  const targetIdentityKnown = parts.length > 0 && parts.every(({ targetField, targetValue }) =>
    targetField.trim() !== "" && targetValue !== undefined,
  );
  const valuesMatch = targetIdentityKnown && parts.every(({ sourceValue, targetValue }) => sourceValue === targetValue);
  const targetObserved = evidence.targetRecordObserved === true;

  const targetIdentityStatus: EvidenceStatus =
    relationMatches && targetIdentityKnown && targetObserved ? "confirmed" : targetIdentityKnown ? "candidate" : "unresolved";

  const technicalLinkStatus: EvidenceStatus =
    relationMatches && sourceFieldsMatch && valuesMatch && targetObserved
      ? "confirmed"
      : relationMatches && (sourceFieldsMatch || suppliedSourceFields.some((field) => relation.sourceFields.includes(field)))
        ? "candidate"
        : "unresolved";

  const foreignKeyConstraintStatus: EvidenceStatus = evidence.foreignKeyConstraintObserved === true
    ? "confirmed"
    : "unresolved";

  const cardinality = evidence.cardinality ?? relation.cardinality;
  const cardinalityStatus: EvidenceStatus = cardinality === "unknown" ? "unresolved" : "confirmed";

  const blockers: string[] = [];
  if (!relationMatches) blockers.push("Der Zielbeleg gehört nicht zur erwarteten Beziehung.");
  if (!sourceFieldsMatch) {
    blockers.push(
      relation.sourceFields.length > 1
        ? "Nicht alle Teile des zusammengesetzten Quellschlüssels sind vollständig und passend belegt."
        : "Das belegte Quellfeld stimmt nicht mit dem Relationsprofil überein.",
    );
  }
  if (!targetIdentityKnown) blockers.push("Das Zielschlüsselfeld oder sein Wert ist nicht vollständig bestätigt.");
  if (targetIdentityKnown && !valuesMatch) {
    blockers.push(
      parts.length > 1
        ? "Mindestens ein Teil des zusammengesetzten Schlüssels stimmt zwischen Quelle und Ziel nicht überein."
        : "Quell- und Zielkennung stimmen nicht überein.",
    );
  }
  if (!targetObserved) blockers.push("Der Ziel-Datensatz wurde nicht als beobachtet bestätigt.");
  if (foreignKeyConstraintStatus !== "confirmed") blockers.push("Ein Datenbank-Foreign-Key-Constraint ist nicht beobachtet.");
  if (cardinalityStatus !== "confirmed") blockers.push("Die Kardinalität ist nicht durch Quellenmetadaten bestätigt.");

  const matchedParts = technicalLinkStatus === "confirmed" ? parts : [];

  return {
    relationId: relation.id,
    semanticStatus: relation.semanticMeaningStatus,
    targetIdentityStatus,
    technicalLinkStatus,
    foreignKeyConstraintStatus,
    cardinalityStatus,
    cardinality,
    sourceField,
    targetField: parts[0]?.targetField ?? evidence.targetField ?? null,
    matchedValue: matchedParts.length === 1 ? matchedParts[0].sourceValue : null,
    matchedParts,
    evidence: [...relation.evidence, ...evidence.evidence],
    blockers,
    note: technicalLinkStatus === "confirmed"
      ? matchedParts.length > 1
        ? "Alle Teile der bestätigten zusammengesetzten Identität stimmen zwischen beobachteter Quelle und beobachtetem Ziel überein. Das bestätigt den konkreten Record-Link, nicht automatisch einen Datenbank-Constraint."
        : "Der beobachtete Quellwert verweist auf einen beobachteten Ziel-Datensatz mit derselben bestätigten Kennung. Das bestätigt den konkreten Record-Link, nicht automatisch einen Datenbank-Constraint."
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
