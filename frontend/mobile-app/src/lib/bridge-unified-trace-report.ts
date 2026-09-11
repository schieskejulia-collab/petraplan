import type { ProfiledBridgeEvaluation } from "./bridge-profiled-evaluation";
import type { QueryTraceReport } from "./bridge-query-trace-report";

export type UnifiedTraceStatus = "ready" | "refresh_required" | "needs_confirmation" | "blocked";

export type UnifiedEvidenceStep = {
  domain: "source_provenance" | "bridge_analysis" | "instance_relations" | "query_read";
  status: "confirmed" | "needs_confirmation" | "refresh_required" | "blocked";
  summary: string;
  evidence: string[];
};

export type UnifiedBridgeTraceReport = {
  identity: {
    source: string;
    sourceRecord: string;
    snapshotId: string;
    capturedAt: string;
    messageId: string;
    correlationId: string;
  };
  decision: {
    status: UnifiedTraceStatus;
    bridgeReleaseAllowed: boolean;
    queryExecutable: boolean;
  };
  bridgeReport: ProfiledBridgeEvaluation["report"];
  queryReport: QueryTraceReport;
  provenance: ProfiledBridgeEvaluation["provenance"];
  evidencePath: UnifiedEvidenceStep[];
  openPoints: string[];
  evidence: string[];
  sourcePolicy: "preserve";
  writePolicy: "forbidden";
  methodPolicy: "report_aggregation_only_no_new_public_phase";
  conclusion: string;
};

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function deriveStatus(
  bridgeReleaseAllowed: boolean,
  queryReport: QueryTraceReport,
): UnifiedTraceStatus {
  if (!bridgeReleaseAllowed || queryReport.execution.status === "blocked") return "blocked";
  if (queryReport.execution.status === "refresh_required") return "refresh_required";
  if (!queryReport.execution.executable || queryReport.execution.status !== "ready") return "needs_confirmation";
  return "ready";
}

/**
 * Aggregates the existing Bridge report/provenance and the query trace into one
 * evidence-preserving report. This is reporting only: it introduces no public
 * phase, does not reinterpret evidence and has no authority to change release
 * decisions. Parameter values are not added; the query report already limits
 * itself to parameter names.
 */
export function buildUnifiedBridgeTraceReport(input: {
  bridge: ProfiledBridgeEvaluation;
  query: QueryTraceReport;
}): UnifiedBridgeTraceReport {
  const { bridge, query } = input;
  const status = deriveStatus(bridge.release.releaseAllowed, query);

  const provenanceEvidence = unique([
    ...bridge.provenance.metadata.evidenceRefs,
    `snapshot:${bridge.provenance.metadata.sourceSnapshotId}`,
    `message:${bridge.provenance.messageId}`,
    `correlation:${bridge.provenance.correlationId}`,
  ]);

  const bridgeEvidence = unique([
    ...bridge.report.confirmedMappings,
    ...bridge.report.confirmedIdentities,
    ...bridge.report.relationFindings,
    ...bridge.report.subtypeFindings,
  ]);

  const relationStatus = bridge.relationDecision.releaseAllowed ? "confirmed" : "needs_confirmation";

  const evidencePath: UnifiedEvidenceStep[] = [
    {
      domain: "source_provenance",
      status: "confirmed",
      summary: `Quelle=${bridge.provenance.source}; Snapshot=${bridge.provenance.metadata.sourceSnapshotId}; Datensatz=${bridge.provenance.sourceRecord}.`,
      evidence: provenanceEvidence,
    },
    {
      domain: "bridge_analysis",
      status: bridge.release.releaseAllowed ? "confirmed" : "needs_confirmation",
      summary: `Bridge-Analyse: releaseAllowed=${bridge.release.releaseAllowed}; blockingIssues=${bridge.release.blockingIssues}.`,
      evidence: bridgeEvidence,
    },
    {
      domain: "instance_relations",
      status: relationStatus,
      summary: `Instanz-/Relationsprüfung: ${bridge.relationDecision.note}`,
      evidence: unique(bridge.relationVerifications.flatMap(({ evidence }) => evidence)),
    },
    ...query.trace.map((step): UnifiedEvidenceStep => ({
      domain: "query_read",
      status: step.status,
      summary: `${step.step}: ${step.summary}`,
      evidence: [...step.evidence],
    })),
  ];

  const openPoints = unique([
    ...bridge.report.openPoints,
    ...query.blockers,
  ]);

  const evidence = unique([
    ...provenanceEvidence,
    ...bridgeEvidence,
    ...query.evidence,
    ...evidencePath.flatMap(({ evidence: stepEvidence }) => stepEvidence),
  ]);

  const conclusion = status === "ready"
    ? "Der Nachweisweg ist konsistent: Quelle und Snapshot sind rückverfolgbar, Bridge-Analyse und Relationsprüfung sind freigegeben und die Query hat den read-only Ausführungsgate passiert."
    : status === "refresh_required"
      ? "Der Nachweisweg ist vorhanden, aber der Lesestand ist veraltet. Vor Nutzung ist ein neuer read-only Source-Read über den bestätigten Pfad erforderlich."
      : status === "needs_confirmation"
        ? "Der Nachweisweg ist zusammengeführt, enthält aber noch unbestätigte Punkte. Teilbelege werden sichtbar gehalten und nicht zu einer Freigabe hochgestuft."
        : "Der zusammengeführte Nachweisweg bleibt blockiert. Eine technische Teilfreigabe überschreibt keine blockierende Bridge- oder Query-Entscheidung.";

  return {
    identity: {
      source: bridge.provenance.source,
      sourceRecord: bridge.provenance.sourceRecord,
      snapshotId: bridge.provenance.metadata.sourceSnapshotId,
      capturedAt: bridge.provenance.capturedAt,
      messageId: bridge.provenance.messageId,
      correlationId: bridge.provenance.correlationId,
    },
    decision: {
      status,
      bridgeReleaseAllowed: bridge.release.releaseAllowed,
      queryExecutable: query.execution.executable,
    },
    bridgeReport: bridge.report,
    queryReport: query,
    provenance: bridge.provenance,
    evidencePath,
    openPoints,
    evidence,
    sourcePolicy: "preserve",
    writePolicy: "forbidden",
    methodPolicy: "report_aggregation_only_no_new_public_phase",
    conclusion,
  };
}
