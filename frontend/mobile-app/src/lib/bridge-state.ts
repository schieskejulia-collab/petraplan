import {
  blockingConstraintFailures,
  type ConstraintResult,
} from "./bridge-constraints";

export type BridgeState = "VALID" | "BLOCKED" | "NEEDS_CONFIRMATION";

export type BridgeStateDecision = {
  state: BridgeState;
  releaseAllowed: boolean;
  reason: string;
  reaction: string;
  triggeringConstraintIds: string[];
  canReevaluate: boolean;
};

const confirmationCategories = new Set<ConstraintResult["category"]>(["contract", "semantics"]);

/**
 * Turns constraint results into one explicit processing state.
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
      canReevaluate: false,
    };
  }

  const hasHardFailure = failures.some(({ category }) => category === "transport" || category === "data");
  if (hasHardFailure) {
    return {
      state: "BLOCKED",
      releaseAllowed: false,
      reason: "Mindestens eine bestätigte Transport- oder Datenregel ist verletzt.",
      reaction: "Quelle unverändert lassen, belegte Ursache anzeigen und erst nach einer bestätigten Korrektur erneut prüfen.",
      triggeringConstraintIds: failures.map(({ id }) => id),
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
    canReevaluate: true,
  };
}
