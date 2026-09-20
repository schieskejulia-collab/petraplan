import {
  blockingConstraintFailures,
  decideFromConstraints,
  type ConstraintCategory,
  type ConstraintResult,
} from "./bridge-constraints";
import {
  evaluateRecord,
  type BridgeEvaluation,
  type IngressContext,
  type RawRecord,
  type ResponseContext,
} from "./bridge-pipeline";
import { deriveBridgeState } from "./bridge-state";

export type AdapterConflictCode =
  | "NO_CONFIRMED_SEMANTIC_MAPPING"
  | "NO_ORDER_DETAILS"
  | "CUSTOMER_MISMATCH";

export type AdapterConflict = {
  field: keyof RawRecord;
  code: AdapterConflictCode;
  message: string;
  blocking: true;
};

export type ReportError = {
  origin: "bridge" | "adapter";
  code: string;
  message: string;
};

export type ConflictTruthEvaluation = BridgeEvaluation & {
  adapterConflicts: AdapterConflict[];
  report: BridgeEvaluation["report"] & {
    errorsDetailed: ReportError[];
  };
};

function categoryFor(conflict: AdapterConflict): ConstraintCategory {
  return conflict.code === "NO_CONFIRMED_SEMANTIC_MAPPING" ? "semantics" : "data";
}

function isAlreadyCoveredByBridge(conflict: AdapterConflict, bridgeConstraints: ConstraintResult[]): boolean {
  if (conflict.code !== "NO_CONFIRMED_SEMANTIC_MAPPING" || conflict.field !== "STATUS") return false;

  return bridgeConstraints.some(
    ({ id, passed, severity }) => id === "status.value_map" && !passed && severity === "blocking",
  );
}

function adapterConstraint(
  conflict: AdapterConflict,
  contract: string,
  sequence: number,
): ConstraintResult {
  const category = categoryFor(conflict);
  return {
    id: `adapter.${conflict.code}:${conflict.field}`,
    sequence,
    category,
    field: conflict.field,
    scope: { contract, field: conflict.field },
    label: `Adapter-Konflikt (${conflict.code})`,
    passed: false,
    severity: "blocking",
    comparison: {
      operator: "equals",
      expected: "kein unaufgelöster Adapter-Konflikt",
      observed: `${conflict.code}: ${conflict.message}`,
      observedType: "adapter-conflict",
    },
    rule: category === "semantics"
      ? "Eine fachlich nicht bestätigte Adapter-Bedeutung darf nicht automatisch aufgelöst werden"
      : "Ein bestätigter Adapter-Widerspruch muss vor der Freigabe aufgelöst werden",
    evidence: `${conflict.field}: ${conflict.message}`,
    safeAction: "Source Truth unverändert erhalten und den Adapter-Konflikt sichtbar lassen.",
    resolutionProposal: category === "semantics"
      ? `Bedeutung für ${conflict.field} fachlich bestätigen und danach mit derselben Source erneut prüfen.`
      : `Widerspruch für ${conflict.field} an der Quelle klären und danach mit derselben Source erneut prüfen.`,
    sourcePolicy: "preserve",
    errorPolicy: "capture",
  };
}

/**
 * Connects adapter Conflict Truth to the existing validation/state/release path.
 *
 * Adapter conflicts never mutate raw. Conflicts already represented by a
 * bridge constraint are de-duplicated so blockingIssues counts causes rather
 * than layers. In particular, an unmapped STATUS is already represented by
 * status.value_map; source-only conflicts such as CUSTOMER_MISMATCH remain
 * visible as their own blocking constraints.
 *
 * All observed adapter conflicts remain available as provenance on the final
 * evaluation, including conflicts de-duplicated from the blocking count.
 */
export function evaluateRecordWithConflictTruth(
  raw: RawRecord,
  capturedAt: string,
  ingressOverrides: Partial<IngressContext> = {},
  responseOverrides: Partial<ResponseContext> = {},
  conflictTruth: AdapterConflict[] = [],
): ConflictTruthEvaluation {
  const base = evaluateRecord(raw, capturedAt, ingressOverrides, responseOverrides);
  const adapterConflicts = structuredClone(conflictTruth);
  const maxSequence = base.constraints.reduce((max, { sequence }) => Math.max(max, sequence), 0);
  const visibleConflicts = adapterConflicts.filter(
    (conflict) => !isAlreadyCoveredByBridge(conflict, base.constraints),
  );
  const adapterConstraints = visibleConflicts.map((conflict, index) =>
    adapterConstraint(conflict, base.contract.name, maxSequence + index + 1),
  );
  const constraints = [...base.constraints, ...adapterConstraints].sort((a, b) => a.sequence - b.sequence);

  const constraintDecision = decideFromConstraints(constraints);
  const state = deriveBridgeState(constraints);
  const blockingConstraints = blockingConstraintFailures(constraints);
  const warningConstraints = constraints.filter(
    ({ passed, severity }) => !passed && severity === "warning",
  );
  const passed = constraints.every(({ passed }) => passed);
  const releaseAllowed = constraintDecision.releaseAllowed;
  const blockingIssues = constraintDecision.blockingIssues;

  const formatConstraint = ({ id, label, evidence }: ConstraintResult): string =>
    id.startsWith("adapter.")
      ? `[adapter] ${label}: ${evidence}`
      : `${label}: ${evidence}`;

  const errorsDetailed: ReportError[] = blockingConstraints.map(({ id, label, evidence }) => ({
    origin: id.startsWith("adapter.") ? "adapter" : "bridge",
    code: id,
    message: `${label}: ${evidence}`,
  }));

  // Conflict Truth must also be visible at field-trace level. The canonical
  // value remains untouched; only the validation state of the affected field
  // changes to failed. Use visibleConflicts here so a de-duplicated STATUS
  // conflict does not manufacture a second validation cause.
  const conflictFields = new Set(visibleConflicts.map(({ field }) => field));
  const trace = base.trace.map((step) =>
    conflictFields.has(step.sourceField)
      ? { ...step, validation: "failed" as const }
      : step,
  );

  return {
    ...base,
    adapterConflicts,
    constraints,
    state,
    trace,
    passed,
    release: {
      releaseAllowed,
      blockingIssues,
      reason: releaseAllowed
        ? "Alle BLOCKING-Constraints sind erfüllt."
        : `${blockingIssues} BLOCKING-Constraint${blockingIssues === 1 ? "" : "s"} fehlgeschlagen: ${constraintDecision.failedConstraintIds.join(", ")}. Freigabe blockiert.`,
    },
    provenance: {
      ...base.provenance,
      overallStatus: passed ? "valid" : "needs_review",
      conflicts: [
        ...blockingConstraints.map(formatConstraint),
        ...warningConstraints.map(formatConstraint),
      ],
    },
    report: {
      ...base.report,
      openPoints: warningConstraints.map(formatConstraint),
      errors: errorsDetailed.map(({ origin, message }) =>
        origin === "adapter" ? `[adapter] ${message}` : message,
      ),
      errorsDetailed,
      nextStep: state.state === "VALID"
        ? state.reaction
        : `${state.state}: ${state.reaction} Auflösungsvorschläge: ${constraintDecision.resolutionProposals.join(" | ")}`,
    },
  };
}
