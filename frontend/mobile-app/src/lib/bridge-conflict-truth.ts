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
  type SchemaCheck,
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

function adapterExplainsUnresolvedField(conflict: AdapterConflict): boolean {
  return (
    conflict.field === "STATUS" && conflict.code === "NO_CONFIRMED_SEMANTIC_MAPPING"
  ) || (
    conflict.field === "MENGE" &&
    (conflict.code === "NO_CONFIRMED_SEMANTIC_MAPPING" || conflict.code === "NO_ORDER_DETAILS")
  );
}

function unresolvedAdapterFields(conflictTruth: AdapterConflict[]): Set<keyof RawRecord> {
  return new Set(
    conflictTruth
      .filter(adapterExplainsUnresolvedField)
      .map(({ field }) => field),
  );
}

function remainingSchemaFailures(
  schema: SchemaCheck[],
  adapterFields: Set<keyof RawRecord>,
): SchemaCheck[] {
  return schema.filter(({ field, present, typeOk, formatOk }) => {
    if (!present || !typeOk) return true;
    if (formatOk) return false;
    return !adapterFields.has(field);
  });
}

function reconcileBaseConstraints(
  baseConstraints: ConstraintResult[],
  schemaFailures: SchemaCheck[],
  adapterFields: Set<keyof RawRecord>,
): ConstraintResult[] {
  return baseConstraints
    .filter(({ id }) => !(id === "quantity.positive" && adapterFields.has("MENGE")))
    .map((constraint) => {
      if (constraint.id !== "contract.schema" || schemaFailures.length > 0) return constraint;

      return {
        ...constraint,
        passed: true,
        comparison: {
          ...constraint.comparison,
          observed: "schemaFehler=0; unresolved adapter semantics handled separately",
        },
        evidence: "schemaFehler=0 nach Trennung von Struktur und explizit ungeklärter Adapter-Semantik",
        resolutionProposal: "Keine Schemaauflösung nötig; ungeklärte Bedeutungen werden durch eigene Semantik-Constraints behandelt.",
      };
    });
}

function reconcileGatewayIssues(
  gatewayIssues: BridgeEvaluation["gatewayIssues"],
  schemaFailures: SchemaCheck[],
): BridgeEvaluation["gatewayIssues"] {
  return gatewayIssues.flatMap((issue) => {
    if (issue.issue !== "CONTRACT_MISMATCH") return [issue];
    if (schemaFailures.length === 0) return [];

    return [{
      ...issue,
      message: `${schemaFailures.length} Feld${schemaFailures.length === 1 ? "" : "er"} entsprechen nicht dem bestätigten Vertrag order-v1.`,
    }];
  });
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
 * than layers. An unmapped STATUS remains represented by status.value_map.
 * If an adapter explicitly proves that MENGE cannot yet be derived, the empty
 * bridge placeholder is not counted again as quantity.positive. Likewise,
 * format failures caused only by those explicit unresolved adapter semantics
 * do not become a second contract.schema cause.
 */
export function evaluateRecordWithConflictTruth(
  raw: RawRecord,
  capturedAt: string,
  ingressOverrides: Partial<IngressContext> = {},
  responseOverrides: Partial<ResponseContext> = {},
  conflictTruth: AdapterConflict[] = [],
): ConflictTruthEvaluation {
  const base = evaluateRecord(raw, capturedAt, ingressOverrides, responseOverrides);
  const adapterFields = unresolvedAdapterFields(conflictTruth);
  const schemaFailures = remainingSchemaFailures(base.schema, adapterFields);
  const reconciledBaseConstraints = reconcileBaseConstraints(base.constraints, schemaFailures, adapterFields);
  const maxSequence = reconciledBaseConstraints.reduce((max, { sequence }) => Math.max(max, sequence), 0);
  const visibleConflicts = conflictTruth.filter(
    (conflict) => !isAlreadyCoveredByBridge(conflict, reconciledBaseConstraints),
  );
  const adapterConstraints = visibleConflicts.map((conflict, index) =>
    adapterConstraint(conflict, base.contract.name, maxSequence + index + 1),
  );
  const constraints = [...reconciledBaseConstraints, ...adapterConstraints].sort((a, b) => a.sequence - b.sequence);

  const constraintDecision = decideFromConstraints(constraints);
  const state = deriveBridgeState(constraints);
  const blockingConstraints = blockingConstraintFailures(constraints);
  const warningConstraints = constraints.filter(
    ({ passed, severity }) => !passed && severity === "warning",
  );
  const passed = constraints.every(({ passed }) => passed);
  const releaseAllowed = constraintDecision.releaseAllowed;
  const blockingIssues = constraintDecision.blockingIssues;
  const gatewayIssues = reconcileGatewayIssues(base.gatewayIssues, schemaFailures);

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
  // changes to failed.
  const conflictFields = new Set(visibleConflicts.map(({ field }) => field));
  const trace = base.trace.map((step) =>
    conflictFields.has(step.sourceField)
      ? { ...step, validation: "failed" as const }
      : step,
  );

  return {
    ...base,
    gatewayIssues,
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
