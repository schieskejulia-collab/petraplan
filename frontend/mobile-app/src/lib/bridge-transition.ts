import type { BridgeEvaluation, RawRecord } from "./bridge-pipeline";
import type { BridgeState, BridgeReactionType } from "./bridge-state";

export type BridgeTransitionOutcome = "RESOLVED" | "PROGRESSED" | "UNCHANGED" | "REGRESSED";

export type BridgeTransition = {
  fromState: BridgeState;
  toState: BridgeState;
  outcome: BridgeTransitionOutcome;
  sourceChanged: boolean;
  sourceChangeFields: Array<keyof RawRecord>;
  resolvedConstraintIds: string[];
  remainingConstraintIds: string[];
  newConstraintIds: string[];
  appliedReactionTypes: BridgeReactionType[];
  releaseAllowed: boolean;
  auditable: true;
  note: string;
};

const rawFields: Array<keyof RawRecord> = ["KUNDEN_NR", "AUFTRAGS_NR", "STATUS", "MENGE", "DATUM"];

function changedSourceFields(before: RawRecord, after: RawRecord): Array<keyof RawRecord> {
  return rawFields.filter((field) => before[field] !== after[field]);
}

function outcomeFor(
  before: BridgeEvaluation,
  after: BridgeEvaluation,
  resolved: string[],
  added: string[],
): BridgeTransitionOutcome {
  if (after.state.state === "VALID" && after.release.releaseAllowed) return "RESOLVED";
  if (added.length > 0) return "REGRESSED";
  if (resolved.length > 0) return "PROGRESSED";
  return "UNCHANGED";
}

/**
 * Records what actually happened between two complete evaluations.
 *
 * The transition layer never sets a target state itself. A state change only
 * becomes real after the record has been evaluated again by the normal
 * constraint -> state -> release chain.
 */
export function recordBridgeTransition(
  before: BridgeEvaluation,
  after: BridgeEvaluation,
): BridgeTransition {
  const beforeIds = new Set(before.state.triggeringConstraintIds);
  const afterIds = new Set(after.state.triggeringConstraintIds);

  const resolvedConstraintIds = before.state.triggeringConstraintIds.filter((id) => !afterIds.has(id));
  const remainingConstraintIds = before.state.triggeringConstraintIds.filter((id) => afterIds.has(id));
  const newConstraintIds = after.state.triggeringConstraintIds.filter((id) => !beforeIds.has(id));
  const sourceChangeFields = changedSourceFields(before.snapshot.values, after.snapshot.values);

  const appliedReactionTypes = before.state.resolutionPlan
    .filter(({ constraintId }) => resolvedConstraintIds.includes(constraintId))
    .map(({ reactionType }) => reactionType);

  const outcome = outcomeFor(before, after, resolvedConstraintIds, newConstraintIds);

  return {
    fromState: before.state.state,
    toState: after.state.state,
    outcome,
    sourceChanged: sourceChangeFields.length > 0,
    sourceChangeFields,
    resolvedConstraintIds,
    remainingConstraintIds,
    newConstraintIds,
    appliedReactionTypes,
    releaseAllowed: after.release.releaseAllowed,
    auditable: true,
    note: outcome === "RESOLVED"
      ? "Der Knoten ist erst nach erneuter vollständiger Prüfung als aufgelöst dokumentiert."
      : outcome === "PROGRESSED"
        ? "Mindestens ein belegter Knoten wurde aufgelöst; weitere blockierende Punkte bleiben offen."
        : outcome === "REGRESSED"
          ? "Nach der erneuten Prüfung sind neue blockierende Punkte hinzugekommen."
          : "Die erneute Prüfung hat den blockierenden Zustand nicht verändert.",
  };
}
