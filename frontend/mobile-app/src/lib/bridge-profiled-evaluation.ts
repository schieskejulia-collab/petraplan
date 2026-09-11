import {
  evaluateRecord,
  type BridgeEvaluation,
  type IngressContext,
  type RawRecord,
  type ResponseContext,
} from "./bridge-pipeline";
import {
  buildOrderInstanceProfile,
  type ConfirmedInstanceProfile,
} from "./bridge-instance-profile";
import {
  verifyRelations,
  type RelationEvidence,
  type RelationVerification,
} from "./bridge-relation-verification";

export type ProfiledBridgeReport = BridgeEvaluation["report"] & {
  confirmedIdentities: string[];
  relationFindings: string[];
  relationVerifications: RelationVerification[];
};

export type ProfiledBridgeEvaluation = Omit<BridgeEvaluation, "report"> & {
  instanceProfile: ConfirmedInstanceProfile;
  relationVerifications: RelationVerification[];
  report: ProfiledBridgeReport;
};

/**
 * Extends the existing read-only bridge evaluation with a conservative
 * instance profile and optional relation evidence.
 *
 * Evidence may confirm that a concrete source reference points to an observed
 * target record. It never upgrades database FK/cardinality facts unless those
 * facts are explicitly supplied as observed evidence.
 */
export function evaluateRecordWithInstanceProfile(
  raw: RawRecord,
  capturedAt: string,
  ingressOverrides: Partial<IngressContext> = {},
  responseOverrides: Partial<ResponseContext> = {},
  relationEvidence: RelationEvidence[] = [],
): ProfiledBridgeEvaluation {
  const evaluation = evaluateRecord(raw, capturedAt, ingressOverrides, responseOverrides);

  const instanceProfile = buildOrderInstanceProfile({
    raw,
    source: evaluation.ingress.source,
    sourceSnapshotId: evaluation.snapshot.id,
    observedAt: capturedAt,
  });

  const confirmedIdentities = instanceProfile.identities
    .filter(({ status }) => status === "confirmed")
    .map(({ subject, parts, note }) => {
      const fields = parts.map(({ field, value }) => `${field}=${value}`).join(" + ");
      return `${subject}: ${fields}. ${note}`;
    });

  const unresolvedIdentityPoints = instanceProfile.identities
    .filter(({ status }) => status !== "confirmed")
    .map(({ subject, status, note }) => `Identität ${subject} ist ${status}: ${note}`);

  const relationVerifications = verifyRelations(instanceProfile.relations, relationEvidence);

  const relationFindings = relationVerifications.map((verification) => {
    const relation = instanceProfile.relations.find(({ id }) => id === verification.relationId);
    const label = relation
      ? `${relation.sourceEntity} → ${relation.targetEntity}`
      : verification.relationId;
    return `${label}: Record-Link=${verification.technicalLinkStatus}, Zielidentität=${verification.targetIdentityStatus}, DB-FK=${verification.foreignKeyConstraintStatus}, Kardinalität=${verification.cardinalityStatus === "confirmed" ? verification.cardinality : "unbestätigt"}. ${verification.note}`;
  });

  const unresolvedRelationPoints = relationVerifications
    .filter(({ technicalLinkStatus, foreignKeyConstraintStatus, cardinalityStatus }) =>
      technicalLinkStatus !== "confirmed" ||
      foreignKeyConstraintStatus !== "confirmed" ||
      cardinalityStatus !== "confirmed",
    )
    .flatMap((verification) => verification.blockers.map((blocker) =>
      `Beziehung ${verification.relationId}: ${blocker}`,
    ));

  return {
    ...evaluation,
    instanceProfile,
    relationVerifications,
    report: {
      ...evaluation.report,
      confirmedIdentities,
      relationFindings,
      relationVerifications,
      openPoints: [
        ...evaluation.report.openPoints,
        ...unresolvedIdentityPoints,
        ...unresolvedRelationPoints,
      ],
    },
  };
}
