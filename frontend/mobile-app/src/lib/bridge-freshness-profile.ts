import type {
  ConfirmedInstanceProfile,
  EvidenceStatus,
  FreshnessProfileEntry,
  ReadOrigin,
} from "./bridge-instance-profile";

export type FreshnessAssessmentInput = {
  sourceSnapshotId: string;
  capturedAt: string;
  assessedAt: string;
  readOrigin: ReadOrigin;
  maxAgeMs?: number | null;
  freshnessPolicyStatus: EvidenceStatus;
  evidence: string[];
};

function parseTime(value: string): number | null {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Evaluates whether a previously read snapshot is still within an explicitly
 * confirmed freshness window.
 *
 * A cache entry may be fresh enough for a read decision, but it never becomes
 * source truth. Without a confirmed max-age policy PetraPlan does not call a
 * snapshot "fresh" merely because it was read recently.
 */
export function assessSnapshotFreshness(
  input: FreshnessAssessmentInput,
): FreshnessProfileEntry {
  const capturedAtMs = parseTime(input.capturedAt);
  const assessedAtMs = parseTime(input.assessedAt);
  const maxAgeMs = input.maxAgeMs ?? null;
  const policyConfirmed = input.freshnessPolicyStatus === "confirmed";
  const validWindow = maxAgeMs !== null && Number.isFinite(maxAgeMs) && maxAgeMs >= 0;

  const blockers: string[] = [];
  let ageMs: number | null = null;
  let freshnessStatus: FreshnessProfileEntry["freshnessStatus"] = "unresolved";
  let status: EvidenceStatus = "unresolved";

  if (capturedAtMs === null || assessedAtMs === null) {
    blockers.push("Snapshot- oder Prüfzeitpunkt ist nicht als gültiger Zeitstempel lesbar.");
  } else {
    ageMs = assessedAtMs - capturedAtMs;

    if (ageMs < 0) {
      freshnessStatus = "future_timestamp";
      blockers.push("Der Snapshot-Zeitpunkt liegt nach dem Prüfzeitpunkt; Freshness kann nicht bestätigt werden.");
    } else if (!validWindow) {
      freshnessStatus = "unbounded";
      status = "candidate";
      blockers.push("Es ist kein gültiges maximales Snapshot-Alter bestätigt.");
    } else if (!policyConfirmed) {
      freshnessStatus = ageMs <= maxAgeMs ? "fresh" : "stale";
      status = "candidate";
      blockers.push("Die Freshness-Grenze ist nur Kandidat und nicht als Regel bestätigt.");
    } else if (ageMs <= maxAgeMs) {
      freshnessStatus = "fresh";
      status = "confirmed";
    } else {
      freshnessStatus = "stale";
      status = "confirmed";
      blockers.push(`Der Snapshot ist ${ageMs - maxAgeMs} ms älter als die bestätigte Freshness-Grenze.`);
    }
  }

  if (input.readOrigin === "unknown") {
    blockers.push("Die Herkunft des Lesestands (Quelle oder Cache) ist nicht bestätigt.");
    if (status === "confirmed") status = "candidate";
  }

  const originNote = input.readOrigin === "cache"
    ? "Der Lesestand stammt aus einem Cache. Cache bleibt eine temporäre Lesekopie und ist niemals Source Truth."
    : input.readOrigin === "source"
      ? "Der Lesestand wurde direkt aus der Quelle beobachtet."
      : "Die Herkunft des Lesestands ist noch ungeklärt.";

  const freshnessNote = freshnessStatus === "fresh" && status === "confirmed"
    ? "Der Snapshot liegt innerhalb der bestätigten Freshness-Grenze."
    : freshnessStatus === "stale" && status === "confirmed"
      ? "Der Snapshot ist nach der bestätigten Freshness-Regel veraltet und muss vor einer zeitkritischen Entscheidung neu gelesen werden."
      : freshnessStatus === "future_timestamp"
        ? "Der Zeitbezug ist widersprüchlich; der Lesestand wird nicht als aktuell behandelt."
        : "Die vorhandenen Belege reichen nicht aus, um die Aktualität des Snapshots verbindlich zu bestätigen.";

  return {
    sourceSnapshotId: input.sourceSnapshotId,
    readOrigin: input.readOrigin,
    capturedAt: input.capturedAt,
    assessedAt: input.assessedAt,
    maxAgeMs: validWindow ? maxAgeMs : null,
    ageMs,
    status,
    freshnessStatus,
    cacheIsSourceTruth: false,
    evidence: [...input.evidence],
    blockers,
    note: `${originNote} ${freshnessNote}`,
  };
}

export function attachFreshnessAssessment(
  profile: ConfirmedInstanceProfile,
  assessment: FreshnessProfileEntry,
): ConfirmedInstanceProfile {
  return {
    ...profile,
    freshness: [
      ...profile.freshness.filter(({ sourceSnapshotId }) => sourceSnapshotId !== assessment.sourceSnapshotId),
      assessment,
    ],
  };
}
