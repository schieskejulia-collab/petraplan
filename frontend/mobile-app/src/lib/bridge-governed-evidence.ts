import {
  blockingConstraintFailures,
  decideFromConstraints,
  type ConstraintResult,
} from "./bridge-constraints";
import {
  evaluateRecord,
  type BridgeEvaluation,
  type MappedRecord,
  type RawRecord,
} from "./bridge-pipeline";
import { deriveBridgeState, type BridgeStateDecision } from "./bridge-state";

export type CanonicalStatus = Exclude<MappedRecord["status"], null>;

export type GovernanceEvidenceBase = {
  evidenceId: string;
  version: string;
  reviewId: string;
  confirmedAt: string;
  confirmedBy: string;
  scope: "demo-only";
  constraintId: "quantity.positive" | "status.value_map";
  field: "MENGE" | "STATUS";
  sourceValue: string;
  rationale: string;
};

export type QuantityRuleEvidence = GovernanceEvidenceBase & {
  kind: "RULE_CONFIRMATION";
  constraintId: "quantity.positive";
  field: "MENGE";
  decision: "ALLOW_OBSERVED_VALUE_IN_DEMO_CONTEXT";
};

export type StatusSemanticEvidence = GovernanceEvidenceBase & {
  kind: "SEMANTIC_MAPPING_CONFIRMATION";
  constraintId: "status.value_map";
  field: "STATUS";
  canonicalValue: CanonicalStatus;
};

export type GovernanceEvidence = QuantityRuleEvidence | StatusSemanticEvidence;

export type AppliedEvidence = {
  evidenceId: string;
  version: string;
  reviewId: string;
  constraintId: string;
  field: string;
  sourceValue: string;
  canonicalValue: CanonicalStatus | null;
  confirmedBy: string;
  confirmedAt: string;
  scope: "demo-only";
};

export type GovernedEvidenceEvaluation = {
  sourceSnapshotId: string;
  raw: RawRecord;
  baseEvaluation: BridgeEvaluation;
  governedConstraints: ConstraintResult[];
  governedMapped: MappedRecord;
  state: BridgeStateDecision;
  release: {
    releaseAllowed: boolean;
    blockingIssues: number;
    failedConstraintIds: string[];
    releaseBasis: AppliedEvidence[];
  };
  appliedEvidence: AppliedEvidence[];
  ignoredEvidenceIds: string[];
};

function evidenceMatchesSource(evidence: GovernanceEvidence, raw: RawRecord): boolean {
  return raw[evidence.field] === evidence.sourceValue;
}

function appliedRecord(evidence: GovernanceEvidence): AppliedEvidence {
  return {
    evidenceId: evidence.evidenceId,
    version: evidence.version,
    reviewId: evidence.reviewId,
    constraintId: evidence.constraintId,
    field: evidence.field,
    sourceValue: evidence.sourceValue,
    canonicalValue: evidence.kind === "SEMANTIC_MAPPING_CONFIRMATION" ? evidence.canonicalValue : null,
    confirmedBy: evidence.confirmedBy,
    confirmedAt: evidence.confirmedAt,
    scope: evidence.scope,
  };
}

/**
 * Demonstrates a governed re-evaluation path without mutating Source Truth.
 *
 * This is deliberately scoped to a demo proof. Evidence may resolve only the
 * exact constraint, field and source value it was reviewed for. It cannot
 * silently change unrelated constraints or rewrite the observed raw record.
 */
export function evaluateWithGovernedEvidence(
  raw: RawRecord,
  capturedAt: string,
  evidence: GovernanceEvidence[] = [],
): GovernedEvidenceEvaluation {
  const source = structuredClone(raw);
  const baseEvaluation = evaluateRecord(source, capturedAt);
  const governedMapped: MappedRecord = structuredClone(baseEvaluation.mapped);
  const appliedEvidence: AppliedEvidence[] = [];
  const ignoredEvidenceIds: string[] = [];

  const evidenceByConstraint = new Map<string, GovernanceEvidence>();
  for (const item of evidence) {
    if (item.scope !== "demo-only" || !evidenceMatchesSource(item, source)) {
      ignoredEvidenceIds.push(item.evidenceId);
      continue;
    }
    evidenceByConstraint.set(item.constraintId, item);
  }

  const governedConstraints = baseEvaluation.constraints.map((constraint): ConstraintResult => {
    if (constraint.passed) return structuredClone(constraint);

    const confirmation = evidenceByConstraint.get(constraint.id);
    if (!confirmation) return structuredClone(constraint);

    if (
      constraint.id === "quantity.positive" &&
      confirmation.kind === "RULE_CONFIRMATION" &&
      confirmation.field === "MENGE" &&
      confirmation.decision === "ALLOW_OBSERVED_VALUE_IN_DEMO_CONTEXT"
    ) {
      appliedEvidence.push(appliedRecord(confirmation));
      return {
        ...structuredClone(constraint),
        passed: true,
        comparison: {
          ...constraint.comparison,
          expected: `bestaetigte Regel ${confirmation.version} fuer exakt MENGE=${confirmation.sourceValue}`,
        },
        rule: `Demo-Regel ${confirmation.version}: der exakt beobachtete Wert ${confirmation.sourceValue} ist nach Review ${confirmation.reviewId} bestaetigt`,
        evidence: `${constraint.evidence}; resolvedBy=${confirmation.evidenceId}; review=${confirmation.reviewId}; version=${confirmation.version}`,
        resolutionProposal: "Keine weitere Aufloesung fuer diesen exakt bestaetigten Demo-Wert noetig.",
      };
    }

    if (
      constraint.id === "status.value_map" &&
      confirmation.kind === "SEMANTIC_MAPPING_CONFIRMATION" &&
      confirmation.field === "STATUS"
    ) {
      governedMapped.status = confirmation.canonicalValue;
      appliedEvidence.push(appliedRecord(confirmation));
      return {
        ...structuredClone(constraint),
        passed: true,
        comparison: {
          ...constraint.comparison,
          expected: `${confirmation.sourceValue} -> ${confirmation.canonicalValue} (${confirmation.version})`,
        },
        rule: `Demo-Semantik ${confirmation.version}: ${confirmation.sourceValue} -> ${confirmation.canonicalValue}`,
        evidence: `${constraint.evidence}; resolvedBy=${confirmation.evidenceId}; review=${confirmation.reviewId}; version=${confirmation.version}; canonical=${confirmation.canonicalValue}`,
        resolutionProposal: "Keine weitere Aufloesung fuer diese exakt bestaetigte Demo-Zuordnung noetig.",
      };
    }

    ignoredEvidenceIds.push(confirmation.evidenceId);
    return structuredClone(constraint);
  });

  const decision = decideFromConstraints(governedConstraints);
  const state = deriveBridgeState(governedConstraints);
  const failures = blockingConstraintFailures(governedConstraints);

  return {
    sourceSnapshotId: baseEvaluation.provenance.metadata.sourceSnapshotId,
    raw: structuredClone(source),
    baseEvaluation,
    governedConstraints,
    governedMapped,
    state,
    release: {
      releaseAllowed: decision.releaseAllowed,
      blockingIssues: failures.length,
      failedConstraintIds: failures.map(({ id }) => id),
      releaseBasis: decision.releaseAllowed ? structuredClone(appliedEvidence) : [],
    },
    appliedEvidence: structuredClone(appliedEvidence),
    ignoredEvidenceIds: [...new Set(ignoredEvidenceIds)],
  };
}
