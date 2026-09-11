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
  decideFromRelationVerifications,
  type RelationGateDecision,
} from "./bridge-relation-decision";
import {
  verifyRelations,
  type RelationEvidence,
  type RelationVerification,
} from "./bridge-relation-verification";
import {
  attachSubtypeAssessment,
  type SubtypeAssessment,
} from "./bridge-subtype-profile";

export type RelationExplanation = {
  relationId: string;
  label: string;
  status: "confirmed" | "needs_confirmation";
  confirmedBy: string[];
  remainsUnproven: string[];
  conclusion: string;
};

export type ProfiledBridgeReport = BridgeEvaluation["report"] & {
  confirmedIdentities: string[];
  relationFindings: string[];
  relationVerifications: RelationVerification[];
  relationExplanations: RelationExplanation[];
  relationDecision: RelationGateDecision;
  subtypeFindings: string[];
};

export type ProfiledBridgeEvaluation = Omit<BridgeEvaluation, "report" | "release"> & {
  instanceProfile: ConfirmedInstanceProfile;
  relationVerifications: RelationVerification[];
  relationDecision: RelationGateDecision;
  release: BridgeEvaluation["release"];
  report: ProfiledBridgeReport;
};

/**
 * Extends the existing read-only bridge evaluation with a conservative
 * instance profile and optional relation/subtype evidence.
 *
 * Evidence may confirm that a concrete source reference points to an observed
 * target record. It never upgrades database FK/cardinality facts unless those
 * facts are explicitly supplied as observed evidence. Subtype assessments are
 * likewise attached with their own evidence status rather than treated as
 * implicit truth.
 */
export function evaluateRecordWithInstanceProfile(
  raw: RawRecord,
  capturedAt: string,
  ingressOverrides: Partial<IngressContext> = {},
  responseOverrides: Partial<ResponseContext> = {},
  relationEvidence: RelationEvidence[] = [],
  subtypeAssessments: SubtypeAssessment[] = [],
): ProfiledBridgeEvaluation {
  const evaluation = evaluateRecord(raw, capturedAt, ingressOverrides, responseOverrides);

  let instanceProfile = buildOrderInstanceProfile({
    raw,
    source: evaluation.ingress.source,
    sourceSnapshotId: evaluation.snapshot.id,
    observedAt: capturedAt,
  });

  for (const subtypeAssessment of subtypeAssessments) {
    instanceProfile = attachSubtypeAssessment(instanceProfile, subtypeAssessment);
  }

  const confirmedIdentities = instanceProfile.identities
    .filter(({ status }) => status === "confirmed")
    .map(({ subject, parts, note }) => {
      const fields = parts.map(({ field, value }) => `${field}=${value}`).join(" + ");
      return `${subject}: ${fields}. ${note}`;
    });

  const unresolvedIdentityPoints = instanceProfile.identities
    .filter(({ status }) => status !== "confirmed")
    .map(({ subject, status, note }) => `Identität ${subject} ist ${status}: ${note}`);

  const subtypeFindings = instanceProfile.subtypes.map((assessment) => {
    const subtypeLabel = assessment.subtype ?? "ungeklärt";
    return `${assessment.baseType} → ${subtypeLabel}: ${assessment.subtypeStatus}. ${assessment.note}`;
  });

  const unresolvedSubtypePoints = instanceProfile.subtypes
    .filter(({ subtypeStatus }) => subtypeStatus !== "confirmed")
    .flatMap((assessment) => [
      `Subtype ${assessment.baseType} ist ${assessment.subtypeStatus}: ${assessment.note}`,
      ...assessment.blockers.map((blocker) => `Subtype ${assessment.baseType}: ${blocker}`),
    ]);

  const relationVerifications = verifyRelations(instanceProfile.relations, relationEvidence);
  const relationDecision = decideFromRelationVerifications(relationVerifications);

  const relationFindings = relationVerifications.map((verification) => {
    const relation = instanceProfile.relations.find(({ id }) => id === verification.relationId);
    const label = relation
      ? `${relation.sourceEntity} → ${relation.targetEntity}`
      : verification.relationId;
    return `${label}: Record-Link=${verification.technicalLinkStatus}, Zielidentität=${verification.targetIdentityStatus}, DB-FK=${verification.foreignKeyConstraintStatus}, Kardinalität=${verification.cardinalityStatus === "confirmed" ? verification.cardinality : "unbestätigt"}. ${verification.note}`;
  });

  const relationExplanations: RelationExplanation[] = relationVerifications.map((verification) => {
    const relation = instanceProfile.relations.find(({ id }) => id === verification.relationId);
    const label = relation
      ? `${relation.sourceEntity} → ${relation.targetEntity}`
      : verification.relationId;

    const confirmedBy: string[] = [];
    if (verification.semanticStatus === "confirmed") {
      confirmedBy.push("Die fachliche Bedeutung der Beziehung ist im bestätigten Relationsprofil bekannt.");
    }
    if (verification.targetIdentityStatus === "confirmed" && verification.targetField && verification.matchedValue) {
      confirmedBy.push(`Der Ziel-Datensatz wurde mit ${verification.targetField}=${verification.matchedValue} beobachtet.`);
    }
    if (verification.technicalLinkStatus === "confirmed" && verification.sourceField && verification.matchedValue) {
      confirmedBy.push(`Der Quellwert ${verification.sourceField}=${verification.matchedValue} stimmt mit der bestätigten Zielkennung überein.`);
    }

    const remainsUnproven: string[] = [];
    if (verification.targetIdentityStatus !== "confirmed") {
      remainsUnproven.push("Die Zielidentität ist noch nicht durch einen beobachteten Ziel-Datensatz bestätigt.");
    }
    if (verification.technicalLinkStatus !== "confirmed") {
      remainsUnproven.push("Der konkrete Record-Link ist noch nicht belegt.");
    }
    if (verification.foreignKeyConstraintStatus !== "confirmed") {
      remainsUnproven.push("Ein Datenbank-Foreign-Key-Constraint ist nicht beobachtet.");
    }
    if (verification.cardinalityStatus !== "confirmed") {
      remainsUnproven.push("Die Kardinalität der Beziehung ist nicht durch Quellenmetadaten bestätigt.");
    }

    const requiredProofConfirmed =
      verification.semanticStatus === "confirmed" &&
      verification.targetIdentityStatus === "confirmed" &&
      verification.technicalLinkStatus === "confirmed";

    return {
      relationId: verification.relationId,
      label,
      status: requiredProofConfirmed ? "confirmed" : "needs_confirmation",
      confirmedBy,
      remainsUnproven,
      conclusion: requiredProofConfirmed
        ? "Der konkrete Record-Link ist bestätigt. Nicht beobachtete Datenbank-Metadaten bleiben ausdrücklich offen und werden nicht erfunden."
        : "Die vorhandenen Belege reichen noch nicht aus, um den konkreten Record-Link freizugeben.",
    };
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

  const relationReleaseBlocked = !relationDecision.releaseAllowed;
  const release = relationReleaseBlocked
    ? {
        releaseAllowed: false,
        blockingIssues: evaluation.release.blockingIssues + relationDecision.blockingRelations.length,
        reason: `${evaluation.release.reason} Relationsprüfung: ${relationDecision.note}`,
      }
    : evaluation.release;

  return {
    ...evaluation,
    release,
    instanceProfile,
    relationVerifications,
    relationDecision,
    report: {
      ...evaluation.report,
      confirmedIdentities,
      relationFindings,
      relationVerifications,
      relationExplanations,
      relationDecision,
      subtypeFindings,
      openPoints: [
        ...evaluation.report.openPoints,
        ...unresolvedIdentityPoints,
        ...unresolvedSubtypePoints,
        ...unresolvedRelationPoints,
      ],
      nextStep: relationReleaseBlocked
        ? "Zielidentität und konkreten Record-Link für die offene Beziehung belegen; keine Freigabe bis dahin."
        : evaluation.report.nextStep,
    },
  };
}
