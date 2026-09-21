import {
  blockingConstraintFailures,
  decideFromConstraints,
  type ConstraintResult,
} from "./bridge-constraints";
import type { ConflictTruthEvaluation } from "./bridge-conflict-truth";
import type { CanonicalStatus } from "./bridge-governed-evidence";
import { deriveBridgeState, type BridgeStateDecision } from "./bridge-state";

export type EvidenceAuthorityKind = "business_rule" | "auditor" | "domain_owner" | "test_authority";

export type EvidenceAuthority = {
  authorityId: string;
  kind: EvidenceAuthorityKind;
  displayName: string;
};

export type AuthorityBackedStatusEvidence = {
  evidenceId: string;
  version: string;
  reviewId: string;
  confirmedAt: string;
  confirmedBy: string;
  scope: "northwind-proof-only";
  status: "ACTIVE" | "REVOKED";
  authority: EvidenceAuthority;
  claim: {
    sourceField: "order.ShippedDate";
    predicate: "NOT_NULL";
    bridgeField: "STATUS";
    canonicalValue: CanonicalStatus;
  };
  rationale: string;
};

export type AppliedAuthorityEvidence = {
  evidenceId: string;
  version: string;
  reviewId: string;
  confirmedAt: string;
  confirmedBy: string;
  scope: "northwind-proof-only";
  authority: EvidenceAuthority;
  claim: AuthorityBackedStatusEvidence["claim"];
};

export type AuthorityEvaluation = {
  sourceSnapshotId: string;
  rawUnchanged: ConflictTruthEvaluation["raw"];
  governedMapped: ConflictTruthEvaluation["mapped"];
  governedConstraints: ConstraintResult[];
  state: BridgeStateDecision;
  appliedEvidence: AppliedAuthorityEvidence[];
  release: {
    releaseAllowed: boolean;
    blockingIssues: number;
    failedConstraintIds: string[];
    releaseBasis: AppliedAuthorityEvidence[];
  };
};

export type ReleaseBasisRecord = {
  recordId: string;
  releaseBasis: AppliedAuthorityEvidence[];
};

export type AuthorityRevocationImpact = {
  revokedEvidenceIds: string[];
  affectedRecordIds: string[];
  unaffectedRecordIds: string[];
};

function appliedRecord(evidence: AuthorityBackedStatusEvidence): AppliedAuthorityEvidence {
  return {
    evidenceId: evidence.evidenceId,
    version: evidence.version,
    reviewId: evidence.reviewId,
    confirmedAt: evidence.confirmedAt,
    confirmedBy: evidence.confirmedBy,
    scope: evidence.scope,
    authority: structuredClone(evidence.authority),
    claim: structuredClone(evidence.claim),
  };
}

function evidenceLabel(evidence: AuthorityBackedStatusEvidence): string {
  return [
    `evidence=${evidence.evidenceId}`,
    `version=${evidence.version}`,
    `review=${evidence.reviewId}`,
    `authority=${evidence.authority.authorityId}`,
    `confirmedBy=${evidence.confirmedBy}`,
  ].join("; ");
}

/**
 * Re-evaluates one already-observed Bridge record with an explicitly scoped,
 * authority-backed semantic claim.
 *
 * Important boundaries:
 * - Source Truth and the observed five-field raw record are never rewritten.
 * - The rule is proof-only and does not assert that Northwind ShippedDate has a
 *   universal business meaning.
 * - Only STATUS-related failures may be resolved by this evidence.
 * - Other failures (for example ambiguous multi-detail MENGE) remain blocking.
 */
export function evaluateWithAuthorityEvidence(
  base: ConflictTruthEvaluation,
  facts: { shippedDate: string | null },
  evidence: AuthorityBackedStatusEvidence,
): AuthorityEvaluation {
  const governedMapped = structuredClone(base.mapped);
  const appliedEvidence: AppliedAuthorityEvidence[] = [];
  const matches =
    evidence.status === "ACTIVE" &&
    evidence.scope === "northwind-proof-only" &&
    evidence.claim.sourceField === "order.ShippedDate" &&
    evidence.claim.predicate === "NOT_NULL" &&
    facts.shippedDate !== null &&
    facts.shippedDate !== "";

  if (matches) {
    governedMapped.status = evidence.claim.canonicalValue;
    appliedEvidence.push(appliedRecord(evidence));
  }

  const failedSchemaFields = new Set(
    base.schema
      .filter(({ present, typeOk, formatOk }) => !present || !typeOk || !formatOk)
      .map(({ field }) => field),
  );

  const governedConstraints = base.constraints.map((constraint): ConstraintResult => {
    if (!matches || constraint.passed) return structuredClone(constraint);

    if (constraint.id === "status.value_map") {
      return {
        ...structuredClone(constraint),
        passed: true,
        comparison: {
          ...constraint.comparison,
          expected: `${evidence.claim.sourceField} ${evidence.claim.predicate} -> ${evidence.claim.canonicalValue}`,
          observed: facts.shippedDate ?? "<null>",
          observedType: facts.shippedDate === null ? "null" : typeof facts.shippedDate,
        },
        rule: `Authority-backed proof rule ${evidence.version}: non-null ShippedDate -> canonical STATUS ${evidence.claim.canonicalValue}`,
        evidence: `${constraint.evidence}; ${evidenceLabel(evidence)}; shippedDate=${facts.shippedDate}`,
        resolutionProposal: "Keine weitere STATUS-Auflösung nötig, solange diese Evidence aktiv und im gleichen Scope gültig ist.",
      };
    }

    if (constraint.id === "contract.schema" && failedSchemaFields.has("STATUS")) {
      const unresolvedSchemaFields = [...failedSchemaFields].filter((field) => field !== "STATUS");
      if (unresolvedSchemaFields.length === 0) {
        return {
          ...structuredClone(constraint),
          passed: true,
          comparison: {
            ...constraint.comparison,
            observed: "schemaFehler=0 nach authority-backed STATUS resolution",
          },
          evidence: `${constraint.evidence}; STATUS resolved by ${evidenceLabel(evidence)}`,
          resolutionProposal: "Keine weitere Schema-Auflösung nötig; STATUS ist für diesen Lauf authority-backed abgeleitet.",
        };
      }

      return {
        ...structuredClone(constraint),
        evidence: `${constraint.evidence}; STATUS resolved by ${evidenceLabel(evidence)}; unresolved=${unresolvedSchemaFields.join(",")}`,
      };
    }

    return structuredClone(constraint);
  });

  const decision = decideFromConstraints(governedConstraints);
  const state = deriveBridgeState(governedConstraints);
  const failures = blockingConstraintFailures(governedConstraints);

  return {
    sourceSnapshotId: base.provenance.metadata.sourceSnapshotId,
    rawUnchanged: structuredClone(base.raw),
    governedMapped,
    governedConstraints,
    state,
    appliedEvidence: structuredClone(appliedEvidence),
    release: {
      releaseAllowed: decision.releaseAllowed,
      blockingIssues: failures.length,
      failedConstraintIds: failures.map(({ id }) => id),
      releaseBasis: decision.releaseAllowed ? structuredClone(appliedEvidence) : [],
    },
  };
}

export function assessAuthorityRevocationImpact(
  releases: ReleaseBasisRecord[],
  revokedEvidenceIds: string[],
): AuthorityRevocationImpact {
  const revoked = new Set(revokedEvidenceIds);
  const affectedRecordIds: string[] = [];
  const unaffectedRecordIds: string[] = [];

  for (const release of releases) {
    const impacted = release.releaseBasis.some(({ evidenceId }) => revoked.has(evidenceId));
    (impacted ? affectedRecordIds : unaffectedRecordIds).push(release.recordId);
  }

  return {
    revokedEvidenceIds: [...revoked].sort(),
    affectedRecordIds: [...new Set(affectedRecordIds)].sort(),
    unaffectedRecordIds: [...new Set(unaffectedRecordIds)].sort(),
  };
}
