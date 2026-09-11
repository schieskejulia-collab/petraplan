import type { AddressableReadPlan } from "./bridge-addressable-read-plan";
import type { FreshnessProfileEntry } from "./bridge-instance-profile";
import type { SourceReadinessAssessment } from "./bridge-source-readiness";

export type ReadAccessStatus = "ready" | "refresh_required" | "needs_confirmation" | "blocked";

export type ReadAccessDecision = {
  status: ReadAccessStatus;
  readAllowed: boolean;
  refreshRequired: boolean;
  blockers: string[];
  evidence: string[];
  sourcePolicy: "preserve";
  writePolicy: "forbidden";
  cachePolicy: "cache_never_source_truth";
  loadingPolicy: "addressable_read_only";
  note: string;
};

/**
 * Final conservative gate before PetraPlan uses an addressable read plan.
 *
 * A read is only allowed when the source is ready, the targeted read plan is
 * fully confirmed, and the snapshot freshness is explicitly confirmed as
 * fresh. A stale snapshot requires a new source read under the same safe plan;
 * unconfirmed freshness does not get silently treated as fresh. Cache may be
 * used as a temporary read copy only when fresh, and never becomes source truth.
 */
export function decideReadAccess(input: {
  sourceReadiness: SourceReadinessAssessment;
  readPlan: AddressableReadPlan;
  freshness: FreshnessProfileEntry;
}): ReadAccessDecision {
  const { sourceReadiness, readPlan, freshness } = input;
  const blockers: string[] = [];

  if (!sourceReadiness.sourceReady) {
    blockers.push(
      `Quelle ist nicht lesebereit: ${sourceReadiness.failedCheckIds.join(", ") || "unbekannte Readiness-Prüfung"}.`,
    );
  }

  if (readPlan.status === "blocked") {
    blockers.push("Der adressierbare Lesepfad ist blockiert.");
  } else if (readPlan.status === "needs_confirmation") {
    blockers.push("Der adressierbare Lesepfad enthält noch unbestätigte Ziele oder Scope-Informationen.");
  }

  const freshnessConfirmed = freshness.status === "confirmed";
  const isFresh = freshness.freshnessStatus === "fresh";
  const isStale = freshness.freshnessStatus === "stale";

  if (!freshnessConfirmed) {
    blockers.push("Die Aktualität des Snapshots ist nicht bestätigt.");
  } else if (!isFresh && !isStale) {
    blockers.push(`Der Snapshot hat keinen freigabefähigen Freshness-Status: ${freshness.freshnessStatus}.`);
  }

  let status: ReadAccessStatus;
  if (!sourceReadiness.sourceReady || readPlan.status === "blocked") {
    status = "blocked";
  } else if (freshnessConfirmed && isStale && readPlan.status === "ready") {
    status = "refresh_required";
  } else if (readPlan.status !== "ready" || !freshnessConfirmed || !isFresh) {
    status = "needs_confirmation";
  } else {
    status = "ready";
  }

  const readAllowed = status === "ready";
  const refreshRequired = status === "refresh_required";

  const evidence = [
    ...readPlan.evidence,
    ...freshness.evidence,
    ...sourceReadiness.checks.map(
      ({ id, passed, observed }) => `${id}:${passed ? "passed" : "failed"}:${observed}`,
    ),
  ];

  let note: string;
  if (status === "ready") {
    note = freshness.readOrigin === "cache"
      ? "Der gezielte Read ist freigegeben. Der verwendete Cache-Stand ist innerhalb einer bestätigten Freshness-Grenze, bleibt aber ausdrücklich nur Lesekopie und niemals Source Truth."
      : "Der gezielte Read ist freigegeben: Quelle, adressierter Lesepfad und Snapshot-Aktualität sind bestätigt.";
  } else if (status === "refresh_required") {
    note = "Der Lesepfad ist sicher adressiert und die Quelle ist bereit, aber der aktuelle Snapshot ist veraltet. Vor Nutzung muss derselbe gezielte read-only Pfad erneut gegen die Quelle gelesen werden.";
  } else if (status === "needs_confirmation") {
    note = "Mindestens eine Voraussetzung für einen belastbaren gezielten Read ist noch unbestätigt. PetraPlan liest nicht auf Verdacht weiter.";
  } else {
    note = "Der gezielte Read bleibt blockiert, weil Quelle oder read-only Lesepfad nicht sicher freigegeben sind.";
  }

  return {
    status,
    readAllowed,
    refreshRequired,
    blockers,
    evidence,
    sourcePolicy: "preserve",
    writePolicy: "forbidden",
    cachePolicy: "cache_never_source_truth",
    loadingPolicy: "addressable_read_only",
    note,
  };
}
