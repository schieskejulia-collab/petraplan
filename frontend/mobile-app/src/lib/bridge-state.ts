import {
  blockingConstraintFailures,
  type ConstraintResult,
} from "./bridge-constraints";

export type BridgeState = "VALID" | "BLOCKED" | "NEEDS_CONFIRMATION";
export type BridgeReactionType =
  | "release"
  | "retry_transport"
  | "confirm_contract"
  | "confirm_semantics"
  | "correct_source_data";

export type BridgeResolutionStep = {
  constraintId: string;
  category: ConstraintResult["category"] | "release";
  field: ConstraintResult["field"];
  reactionType: BridgeReactionType;
  evidence: string;
  safeAction: string;
  resolutionProposal: string;
  mutatesSource: false;
  requiresConfirmation: boolean;
};

export type BridgeStateDecision = {
  state: BridgeState;
  releaseAllowed: boolean;
  reason: string;
  reaction: string;
  triggeringConstraintIds: string[];
  resolutionPlan: BridgeResolutionStep[];
  canReevaluate: boolean;
};

const confirmationCategories = new Set<ConstraintResult["category"]>(["contract", "semantics"]);

function reactionTypeFor(constraint: ConstraintResult): BridgeReactionType {
  switch (constraint.category) {
    case "transport":
      return "retry_transport";
    case "contract":
      return "confirm_contract";
    case "semantics":
      return "confirm_semantics";
    case "data":
      return "correct_source_data";
    default:
      return "correct_source_data";
  }
}

function resolutionStepFor(constraint: ConstraintResult): BridgeResolutionStep {
  const reactionType = reactionTypeFor(constraint);
  return {
    constraintId: constraint.id,
    category: constraint.category,
    field: constraint.field,
    reactionType,
    evidence: constraint.evidence,
    safeAction: constraint.safeAction,
    resolutionProposal: constraint.resolutionProposal,
    mutatesSource: false,
    requiresConfirmation:
      reactionType === "confirm_contract" ||
      reactionType === "confirm_semantics" ||
      reactionType === "correct_source_data",
  };
}

/**
 * Turns constraint results into one explicit processing state and a safe
 * resolution plan. The state layer interprets evidence; it never changes the
 * original source values itself.
 *
 * Priority is deliberate:
 * 1. No blocking failures -> VALID.
 * 2. Any transport/data failure -> BLOCKED.
 * 3. Remaining contract/semantics uncertainty -> NEEDS_CONFIRMATION.
 *
 * A mixed case is therefore BLOCKED. A semantic ambiguity never hides a
 * concrete transport or business-data violation.
 */
export function deriveBridgeState(results: ConstraintResult[]): BridgeStateDecision {
  const failures = blockingConstraintFailures(results);

  if (failures.length === 0) {
    return {
      state: "VALID",
      releaseAllowed: true,
      reason: "Alle blockierenden Constraints sind erfüllt.",
      reaction: "Freigabe dokumentieren und Ausgabe übergeben.",
      triggeringConstraintIds: [],
      resolutionPlan: [
        {
          constraintId: "release",
          category: "release",
          field: null,
          reactionType: "release",
          evidence: "Keine blockierenden Constraint-Verletzungen.",
          safeAction: "Geprüftes Ergebnis dokumentiert weitergeben.",
          resolutionProposal: "Keine Auflösung nötig.",
          mutatesSource: false,
          requiresConfirmation: false,
        },
      ],
      canReevaluate: false,
    };
  }

  const resolutionPlan = failures.map(resolutionStepFor);
  const hasHardFailure = failures.some(({ category }) => category === "transport" || category === "data");

  if (hasHardFailure) {
    return {
      state: "BLOCKED",
      releaseAllowed: false,
      reason: "Mindestens eine bestätigte Transport- oder Datenregel ist verletzt.",
      reaction: "Quelle unverändert lassen, belegte Ursache anzeigen und erst nach einer bestätigten Korrektur erneut prüfen.",
      triggeringConstraintIds: failures.map(({ id }) => id),
      resolutionPlan,
      canReevaluate: true,
    };
  }

  const confirmationOnly = failures.every(({ category }) => confirmationCategories.has(category));
  if (confirmationOnly) {
    return {
      state: "NEEDS_CONFIRMATION",
      releaseAllowed: false,
      reason: "Die Daten sind prüfbar, aber Vertrag oder Bedeutung sind noch nicht ausreichend bestätigt.",
      reaction: "Fehlende Regel oder Bedeutung bestätigen, nichts erfinden und danach mit derselben Source erneut prüfen.",
      triggeringConstraintIds: failures.map(({ id }) => id),
      resolutionPlan,
      canReevaluate: true,
    };
  }

  // Fail-safe fallback: an unbekannte neue Kategorie niemals automatisch freigeben.
  return {
    state: "BLOCKED",
    releaseAllowed: false,
    reason: "Ein nicht eindeutig klassifizierter blockierender Zustand liegt vor.",
    reaction: "Zustand dokumentieren und vor einer Freigabe eindeutig klassifizieren.",
    triggeringConstraintIds: failures.map(({ id }) => id),
    resolutionPlan,
    canReevaluate: true,
  };
}
