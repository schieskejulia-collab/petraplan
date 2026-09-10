export type EvidenceKind =
  | "interface_contract"
  | "mapping_table"
  | "system_documentation"
  | "source_system_record"
  | "independent_case"
  | "human_statement";

export type EvidenceStrength = "authoritative" | "supporting" | "unverified";
export type EvidenceScope = "case" | "rule";

export type EvidenceRecord = {
  id: string;
  kind: EvidenceKind;
  strength: EvidenceStrength;
  scope: EvidenceScope;
  reference: string;
  capturedAt: string;
  submittedBy: string;
};

export type RuleProposal = {
  id: string;
  subject: string;
  proposedValue: string;
  scope: EvidenceScope;
  proposedBy: string;
};

export type EvidenceDecisionStatus =
  | "EVIDENCE_CONFIRMED"
  | "HUMAN_CONFIRMED"
  | "UNRESOLVED";

export type EvidenceDecision = {
  status: EvidenceDecisionStatus;
  eligibleForCaseUse: boolean;
  eligibleForGlobalRule: boolean;
  authoritativeEvidenceIds: string[];
  supportingEvidenceIds: string[];
  humanStatementIds: string[];
  reason: string;
  requiresIndependentEvidence: boolean;
  audit: {
    proposalId: string;
    proposedBy: string;
    evidenceIds: string[];
  };
};

function isHumanStatement(evidence: EvidenceRecord): boolean {
  return evidence.kind === "human_statement";
}

function isUsableEvidence(evidence: EvidenceRecord): boolean {
  return evidence.reference.trim().length > 0 && evidence.capturedAt.trim().length > 0;
}

/**
 * Evidence gate for proposed meanings, contracts and rules.
 *
 * Safety rules:
 * - A human statement alone is never enough to create reusable truth.
 * - Supporting examples can strengthen a case but do not replace authoritative evidence.
 * - A global rule requires authoritative evidence explicitly scoped to the rule.
 * - The gate only decides whether evidence is sufficient. It never mutates source data
 *   and never changes the Bridge release decision by itself.
 */
export function evaluateEvidence(
  proposal: RuleProposal,
  evidenceRecords: EvidenceRecord[],
): EvidenceDecision {
  const evidence = evidenceRecords.filter(isUsableEvidence);
  const authoritative = evidence.filter(({ strength }) => strength === "authoritative");
  const authoritativeForRule = authoritative.filter(({ scope }) => scope === "rule");
  const supporting = evidence.filter(({ strength }) => strength === "supporting");
  const humanStatements = evidence.filter(isHumanStatement);

  const eligibleForCaseUse = authoritative.length > 0;
  const eligibleForGlobalRule =
    proposal.scope === "rule" && authoritativeForRule.length > 0;

  let status: EvidenceDecisionStatus = "UNRESOLVED";
  let reason = "Für die vorgeschlagene Bedeutung liegt noch kein belastbarer Beleg vor.";

  if (authoritative.length > 0) {
    status = "EVIDENCE_CONFIRMED";
    reason = eligibleForGlobalRule
      ? "Die vorgeschlagene Regel ist durch mindestens einen autoritativen, regelbezogenen Beleg gestützt."
      : "Die vorgeschlagene Bedeutung ist für den konkreten Fall autoritativ belegt; daraus entsteht nicht automatisch eine globale Regel.";
  } else if (humanStatements.length > 0) {
    status = "HUMAN_CONFIRMED";
    reason = "Eine menschliche Aussage liegt vor, aber ohne autoritativen Beleg bleibt die Bedeutung technisch unbestätigt.";
  } else if (supporting.length > 0) {
    reason = "Es gibt unterstützende Hinweise, aber keinen autoritativen Beleg für eine Freigabe oder dauerhafte Regel.";
  }

  return {
    status,
    eligibleForCaseUse,
    eligibleForGlobalRule,
    authoritativeEvidenceIds: authoritative.map(({ id }) => id),
    supportingEvidenceIds: supporting.map(({ id }) => id),
    humanStatementIds: humanStatements.map(({ id }) => id),
    reason,
    requiresIndependentEvidence: authoritative.length === 0,
    audit: {
      proposalId: proposal.id,
      proposedBy: proposal.proposedBy,
      evidenceIds: evidence.map(({ id }) => id),
    },
  };
}
