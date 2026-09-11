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

export type ProfiledBridgeReport = BridgeEvaluation["report"] & {
  confirmedIdentities: string[];
  relationFindings: string[];
};

export type ProfiledBridgeEvaluation = Omit<BridgeEvaluation, "report"> & {
  instanceProfile: ConfirmedInstanceProfile;
  report: ProfiledBridgeReport;
};

/**
 * Extends the existing read-only bridge evaluation with a conservative
 * instance profile. The profile may confirm payload-level identity/meaning,
 * but it never upgrades candidate database facts to confirmed facts without
 * source evidence.
 */
export function evaluateRecordWithInstanceProfile(
  raw: RawRecord,
  capturedAt: string,
  ingressOverrides: Partial<IngressContext> = {},
  responseOverrides: Partial<ResponseContext> = {},
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

  const relationFindings = instanceProfile.relations.map((relation) => {
    const technical = `technischer Link=${relation.technicalLinkStatus}`;
    const semantic = `Bedeutung=${relation.semanticMeaningStatus}`;
    return `${relation.sourceEntity} → ${relation.targetEntity}: ${technical}, ${semantic}, Kardinalität=${relation.cardinality}. ${relation.note}`;
  });

  const unresolvedRelationPoints = instanceProfile.relations
    .filter(({ technicalLinkStatus, cardinality }) => technicalLinkStatus !== "confirmed" || cardinality === "unknown")
    .map((relation) => `Beziehung ${relation.sourceEntity} → ${relation.targetEntity} technisch nicht vollständig bestätigt: ${relation.note}`);

  return {
    ...evaluation,
    instanceProfile,
    report: {
      ...evaluation.report,
      confirmedIdentities,
      relationFindings,
      openPoints: [
        ...evaluation.report.openPoints,
        ...unresolvedIdentityPoints,
        ...unresolvedRelationPoints,
      ],
    },
  };
}
