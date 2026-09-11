import type { RelationVerification } from "./bridge-relation-verification";

export type RelationGateStatus = "confirmed" | "needs_confirmation";

export type RelationGateDecision = {
  status: RelationGateStatus;
  releaseAllowed: boolean;
  blockingRelations: string[];
  note: string;
};

/**
 * Conservative release gate for relation evidence.
 *
 * A relation is sufficient for release only when its semantic meaning,
 * observed target identity and concrete record link are confirmed.
 * Database FK constraints and source cardinality are valuable metadata but are
 * not required to prove the concrete record link, so they stay reportable
 * open points without becoming release blockers by themselves.
 */
export function decideFromRelationVerifications(
  verifications: RelationVerification[],
): RelationGateDecision {
  const blockingRelations = verifications
    .filter(({ semanticStatus, targetIdentityStatus, technicalLinkStatus }) =>
      semanticStatus !== "confirmed" ||
      targetIdentityStatus !== "confirmed" ||
      technicalLinkStatus !== "confirmed",
    )
    .map(({ relationId }) => relationId);

  if (blockingRelations.length > 0) {
    return {
      status: "needs_confirmation",
      releaseAllowed: false,
      blockingRelations,
      note: "Mindestens eine fachlich benötigte Beziehung ist noch nicht durch Zielidentität und konkreten Record-Link bestätigt.",
    };
  }

  return {
    status: "confirmed",
    releaseAllowed: true,
    blockingRelations: [],
    note: "Alle profilierten Beziehungen sind auf Ebene von Bedeutung, Zielidentität und konkretem Record-Link bestätigt.",
  };
}
