import type {
  AssociationEntityProfileEntry,
  CollectionProfileEntry,
  CollectionShape,
  ConfirmedInstanceProfile,
  EvidenceStatus,
} from "./bridge-instance-profile";

export type CollectionStructureEvidence = {
  relationId: string;
  shape?: CollectionShape;
  shapeStatus?: EvidenceStatus;
  ordered?: boolean | null;
  orderingStatus?: EvidenceStatus;
  orderField?: string | null;
  joinObject?: string | null;
  associationMeaningStatus?: EvidenceStatus;
  hasOwnMeaning?: boolean | null;
  ownFields?: string[];
  evidence: string[];
};

export type CollectionStructureAssessment = {
  collection: CollectionProfileEntry;
  associationEntity: AssociationEntityProfileEntry;
};

/**
 * Describes how a relation is represented without turning storage shape into
 * business meaning.
 *
 * A List/Set/Map/Bag/Array can be reported when observed, but collection shape
 * does not itself prove ordering semantics. Likewise, a join object is only
 * treated as a meaningful association entity when its own business meaning is
 * explicitly confirmed. Otherwise it remains technical/candidate metadata.
 */
export function assessCollectionStructure(
  input: CollectionStructureEvidence,
): CollectionStructureAssessment {
  const shape = input.shape ?? "unknown";
  const shapeStatus: EvidenceStatus = shape === "unknown"
    ? "unresolved"
    : input.shapeStatus === "confirmed"
      ? "confirmed"
      : "candidate";

  const orderingKnown = input.ordered !== undefined && input.ordered !== null;
  const orderingStatus: EvidenceStatus = !orderingKnown
    ? "unresolved"
    : input.orderingStatus === "confirmed"
      ? "confirmed"
      : "candidate";

  const collectionBlockers: string[] = [];
  if (shapeStatus !== "confirmed") {
    collectionBlockers.push("Die Collection-/Strukturform ist nicht bestätigt.");
  }
  if (orderingStatus !== "confirmed") {
    collectionBlockers.push("Eine technische oder fachliche Reihenfolge ist nicht bestätigt.");
  }

  const collection: CollectionProfileEntry = {
    relationId: input.relationId,
    shape,
    shapeStatus,
    ordered: orderingKnown ? input.ordered ?? null : null,
    orderingStatus,
    orderField: input.orderField ?? null,
    evidence: [...input.evidence],
    blockers: collectionBlockers,
    note: shapeStatus === "confirmed"
      ? `Die beobachtete Collection-Form ${shape} ist bestätigt. Daraus wird keine fachliche Reihenfolge oder Bedeutung abgeleitet.`
      : "Die technische Collection-Form ist noch nicht ausreichend bestätigt.",
  };

  const joinObserved = Boolean(input.joinObject);
  let associationStatus: EvidenceStatus = "unresolved";
  if (joinObserved) {
    associationStatus = input.associationMeaningStatus === "confirmed" ? "confirmed" : "candidate";
  }

  const associationBlockers: string[] = [];
  if (!joinObserved) {
    associationBlockers.push("Kein Join-/Assoziationsobjekt wurde beobachtet.");
  }
  if (joinObserved && associationStatus !== "confirmed") {
    associationBlockers.push("Die fachliche Bedeutung des Join-/Assoziationsobjekts ist nicht bestätigt.");
  }
  if (input.hasOwnMeaning === true && (input.ownFields?.length ?? 0) === 0) {
    associationBlockers.push("Eigene fachliche Bedeutung ist behauptet, aber keine eigenen Felder sind belegt.");
    associationStatus = "candidate";
  }

  const hasOwnMeaning = joinObserved ? input.hasOwnMeaning ?? null : null;
  const associationEntity: AssociationEntityProfileEntry = {
    relationId: input.relationId,
    joinObject: input.joinObject ?? null,
    status: associationStatus,
    hasOwnMeaning,
    ownFields: [...(input.ownFields ?? [])],
    evidence: [...input.evidence],
    blockers: associationBlockers,
    note: associationStatus === "confirmed" && hasOwnMeaning === true
      ? "Das beobachtete Dazwischen trägt bestätigte eigene fachliche Bedeutung und wird als Association Entity behandelt."
      : associationStatus === "confirmed"
        ? "Das Join-Objekt ist bestätigt, aber keine eigene fachliche Bedeutung wird behauptet."
        : "Das Join-/Assoziationsobjekt bleibt technisch oder fachlich unbestätigt; keine Bedeutung wird erfunden.",
  };

  return { collection, associationEntity };
}

export function attachCollectionStructure(
  profile: ConfirmedInstanceProfile,
  assessment: CollectionStructureAssessment,
): ConfirmedInstanceProfile {
  return {
    ...profile,
    collections: [
      ...profile.collections.filter(({ relationId }) => relationId !== assessment.collection.relationId),
      assessment.collection,
    ],
    associationEntities: [
      ...profile.associationEntities.filter(({ relationId }) => relationId !== assessment.associationEntity.relationId),
      assessment.associationEntity,
    ],
  };
}
