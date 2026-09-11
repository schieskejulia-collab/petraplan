import type {
  ConfirmedInstanceProfile,
  EvidenceStatus,
  InheritanceStrategy,
  SubtypeProfileEntry,
} from "./bridge-instance-profile";

export type SubtypeDefinition = {
  baseType: string;
  discriminatorField: string;
  discriminatorStatus: EvidenceStatus;
  discriminatorValues: Record<string, string>;
  valueMapStatus: EvidenceStatus;
  inheritanceStrategy?: InheritanceStrategy;
  inheritanceStrategyStatus?: EvidenceStatus;
  evidence: string[];
};

export type SubtypeAssessment = SubtypeProfileEntry;

function hasObservedValue(value: string | undefined): value is string {
  if (value === undefined) return false;
  const normalized = value.trim().toUpperCase();
  return normalized !== "" && normalized !== "NULL" && normalized !== "N/A";
}

/**
 * Assesses a concrete subtype without deriving business meaning from structure
 * alone.
 *
 * A discriminator value confirms a subtype only when both the discriminator
 * definition and its value-to-subtype mapping are themselves confirmed. An
 * observed field/value with candidate metadata remains candidate. Unknown
 * values remain unresolved. The storage/inheritance strategy is reported
 * separately and is never inferred merely from a subtype match.
 */
export function assessSubtype(input: {
  record: Record<string, string | undefined>;
  definition: SubtypeDefinition;
}): SubtypeAssessment {
  const { record, definition } = input;
  const observed = record[definition.discriminatorField];
  const observedPresent = hasObservedValue(observed);
  const subtype = observedPresent ? definition.discriminatorValues[observed] ?? null : null;

  const definitionConfirmed = definition.discriminatorStatus === "confirmed";
  const valueMapConfirmed = definition.valueMapStatus === "confirmed";

  let subtypeStatus: EvidenceStatus = "unresolved";
  if (observedPresent && subtype) {
    subtypeStatus = definitionConfirmed && valueMapConfirmed ? "confirmed" : "candidate";
  }

  const inheritanceStrategy = definition.inheritanceStrategy ?? "unknown";
  const inheritanceStrategyStatus: EvidenceStatus =
    inheritanceStrategy === "unknown"
      ? "unresolved"
      : definition.inheritanceStrategyStatus === "confirmed"
        ? "confirmed"
        : "candidate";

  const blockers: string[] = [];
  if (!observedPresent) blockers.push("Kein verwertbarer Discriminator-Wert wurde beobachtet.");
  if (observedPresent && !subtype) blockers.push("Der beobachtete Discriminator-Wert ist keinem bestätigten Subtype zugeordnet.");
  if (subtype && !definitionConfirmed) blockers.push("Die Discriminator-Definition ist nicht bestätigt.");
  if (subtype && !valueMapConfirmed) blockers.push("Die Zuordnung vom Discriminator-Wert zum Subtype ist nicht bestätigt.");
  if (inheritanceStrategyStatus !== "confirmed") blockers.push("Die technische Vererbungs-/Speicherstrategie ist nicht bestätigt.");

  const note = subtypeStatus === "confirmed"
    ? `Der beobachtete Discriminator ${definition.discriminatorField}=${observed} bestätigt den konkreten Subtype ${subtype}. Die technische Speicherstrategie wird davon getrennt bewertet.`
    : subtypeStatus === "candidate"
      ? `Der beobachtete Wert passt zu ${subtype}, aber mindestens ein Teil der Subtype-Definition ist noch nicht bestätigt.`
      : "Die vorhandenen Belege reichen nicht aus, um einen konkreten Subtype zu bestätigen.";

  return {
    baseType: definition.baseType,
    subtype,
    discriminatorField: definition.discriminatorField,
    observedDiscriminatorValue: observedPresent ? observed : null,
    subtypeStatus,
    inheritanceStrategy,
    inheritanceStrategyStatus,
    evidence: [...definition.evidence],
    blockers,
    note,
  };
}

/**
 * Adds already-assessed subtype evidence to an instance profile without
 * changing identities, relations or source evidence. This keeps subtype
 * classification part of the profile while preserving its independent proof
 * status.
 */
export function attachSubtypeAssessment(
  profile: ConfirmedInstanceProfile,
  assessment: SubtypeAssessment,
): ConfirmedInstanceProfile {
  return {
    ...profile,
    subtypes: [...profile.subtypes, assessment],
  };
}
