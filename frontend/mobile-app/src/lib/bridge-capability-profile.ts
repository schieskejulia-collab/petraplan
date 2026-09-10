export type CapabilityEvidenceLevel =
  | "authoritative_metadata"
  | "driver_report"
  | "documentation"
  | "observed"
  | "human_only"
  | "missing";

export type CapabilitySupport = "supported" | "unsupported" | "unknown";

export type CapabilityEvidence = {
  level: CapabilityEvidenceLevel;
  reference: string;
};

export type CapabilityObservation = {
  capability: string;
  support: CapabilitySupport;
  evidence: CapabilityEvidence;
};

export type ConnectionIdentity = {
  databaseType: string;
  databaseVersion: string;
  driverName: string;
  driverVersion: string;
};

export type StructureObservation = {
  tablesKnown: boolean;
  columnsKnown: boolean;
  keysKnown: boolean;
  dataTypesKnown: boolean;
  nullabilityKnown: boolean;
};

export type ConnectionLimits = {
  identifierLength: string;
  typeLimits: string;
  dateTimeRepresentation: string;
  driverSpecificRestrictions: string[];
};

export type CapabilityProfileInput = {
  connectionId: string;
  identity: ConnectionIdentity;
  structure: StructureObservation;
  capabilities: CapabilityObservation[];
  limits: ConnectionLimits;
};

export type CapabilityProfileCheckId =
  | "capability.identity"
  | "capability.structure"
  | "capability.evidence"
  | "capability.unknowns"
  | "capability.limits";

export type CapabilityProfileCheck = {
  id: CapabilityProfileCheckId;
  label: string;
  passed: boolean;
  observed: string;
  expected: string;
  safeAction: string;
};

export type CapabilityProfile = {
  connectionId: string;
  identity: ConnectionIdentity;
  structure: StructureObservation;
  capabilities: CapabilityObservation[];
  limits: ConnectionLimits;
  checks: CapabilityProfileCheck[];
  usableForOperationChecks: boolean;
  unresolvedCapabilities: string[];
  weaklyEvidencedCapabilities: string[];
  sourcePolicy: "preserve";
  releaseAuthority: "none";
  principle: "identify_read_capabilities_read_limits_build_profile";
};

const strongEvidence = new Set<CapabilityEvidenceLevel>([
  "authoritative_metadata",
  "driver_report",
  "documentation",
]);

function hasText(value: string): boolean {
  return value.trim().length > 0;
}

/**
 * Builds an internal profile for one concrete database/driver connection.
 *
 * The profile does not infer support from a database family name alone. A capability
 * is only treated as established when the input explicitly reports its support state
 * and includes usable evidence. The profile never decides business release and never
 * mutates the connected source.
 */
export function buildCapabilityProfile(input: CapabilityProfileInput): CapabilityProfile {
  const identityComplete =
    hasText(input.connectionId) &&
    hasText(input.identity.databaseType) &&
    hasText(input.identity.databaseVersion) &&
    hasText(input.identity.driverName) &&
    hasText(input.identity.driverVersion);

  const structureComplete = Object.values(input.structure).every(Boolean);

  const unresolvedCapabilities = input.capabilities
    .filter(({ support, evidence }) => support === "unknown" || evidence.level === "missing" || !hasText(evidence.reference))
    .map(({ capability }) => capability);

  const weaklyEvidencedCapabilities = input.capabilities
    .filter(({ support, evidence }) =>
      support !== "unknown" &&
      hasText(evidence.reference) &&
      !strongEvidence.has(evidence.level),
    )
    .map(({ capability }) => capability);

  const evidenceComplete = input.capabilities.length > 0 && unresolvedCapabilities.length === 0;
  const noUnknownCapabilities = input.capabilities.length > 0 && input.capabilities.every(({ support }) => support !== "unknown");

  const limitsDocumented =
    hasText(input.limits.identifierLength) &&
    hasText(input.limits.typeLimits) &&
    hasText(input.limits.dateTimeRepresentation);

  const checks: CapabilityProfileCheck[] = [
    {
      id: "capability.identity",
      label: "Konkrete Verbindung ist identifiziert",
      passed: identityComplete,
      observed: `connection=${input.connectionId || "<leer>"}; db=${input.identity.databaseType || "<leer>"} ${input.identity.databaseVersion || "<leer>"}; driver=${input.identity.driverName || "<leer>"} ${input.identity.driverVersion || "<leer>"}`,
      expected: "Connection-ID, Datenbanktyp/-version und Treibername/-version",
      safeAction: "Fähigkeiten nicht pauschal aus dem Namen einer Datenbankfamilie ableiten.",
    },
    {
      id: "capability.structure",
      label: "Struktur der Verbindung ist ausreichend beschrieben",
      passed: structureComplete,
      observed: JSON.stringify(input.structure),
      expected: "Tabellen, Spalten, Schlüssel, Datentypen und NULL-Fähigkeit bekannt",
      safeAction: "Operationen nicht auf einer angenommenen Struktur planen.",
    },
    {
      id: "capability.evidence",
      label: "Fähigkeitsangaben besitzen verwendbare Belege",
      passed: evidenceComplete,
      observed: unresolvedCapabilities.length === 0 ? "alle Angaben belegt" : `ungeklärt: ${unresolvedCapabilities.join(", ")}`,
      expected: "expliziter Supportstatus plus verwertbare Evidenz",
      safeAction: "Unbelegte Fähigkeiten als unbekannt behandeln, nicht als unterstützt.",
    },
    {
      id: "capability.unknowns",
      label: "Keine benötigte Fähigkeit ist nur angenommen",
      passed: noUnknownCapabilities,
      observed: noUnknownCapabilities ? "keine unknown-Einträge" : `unknown: ${input.capabilities.filter(({ support }) => support === "unknown").map(({ capability }) => capability).join(", ")}`,
      expected: "supported oder unsupported auf Basis expliziter Beobachtung",
      safeAction: "Bei unbekannter Unterstützung blockierend konservativ bleiben, bis Evidenz vorliegt.",
    },
    {
      id: "capability.limits",
      label: "Relevante Grenzen der Verbindung sind dokumentiert",
      passed: limitsDocumented,
      observed: `identifierLength=${input.limits.identifierLength || "<leer>"}; typeLimits=${input.limits.typeLimits || "<leer>"}; dateTime=${input.limits.dateTimeRepresentation || "<leer>"}; driverRestrictions=${input.limits.driverSpecificRestrictions.length}`,
      expected: "Namens-/Typgrenzen und Datums-/Zeitdarstellung dokumentiert",
      safeAction: "Treiber- und Datenbankgrenzen vor einer Operation explizit prüfen.",
    },
  ];

  return {
    connectionId: input.connectionId,
    identity: { ...input.identity },
    structure: { ...input.structure },
    capabilities: input.capabilities.map((entry) => ({
      capability: entry.capability,
      support: entry.support,
      evidence: { ...entry.evidence },
    })),
    limits: {
      ...input.limits,
      driverSpecificRestrictions: [...input.limits.driverSpecificRestrictions],
    },
    checks,
    usableForOperationChecks: checks.every(({ passed }) => passed),
    unresolvedCapabilities,
    weaklyEvidencedCapabilities,
    sourcePolicy: "preserve",
    releaseAuthority: "none",
    principle: "identify_read_capabilities_read_limits_build_profile",
  };
}

export type OperationRequirement = {
  capability: string;
  requiredSupport: "supported";
};

export type OperationCapabilityAssessment = {
  operation: string;
  allowedByProfile: boolean;
  failedRequirements: string[];
  evidence: string[];
  releaseAuthority: "none";
};

/**
 * Checks an operation against a previously built profile. This is deliberately
 * narrower than a release decision: it only answers whether the connection profile
 * contains sufficiently supported capabilities for the requested technical operation.
 */
export function assessOperationAgainstProfile(
  profile: CapabilityProfile,
  operation: string,
  requirements: readonly OperationRequirement[],
): OperationCapabilityAssessment {
  const failedRequirements: string[] = [];
  const evidence: string[] = [];

  for (const requirement of requirements) {
    const match = profile.capabilities.find(({ capability }) => capability === requirement.capability);
    const supported =
      profile.usableForOperationChecks &&
      match?.support === "supported" &&
      match.evidence.level !== "missing" &&
      hasText(match.evidence.reference);

    if (!supported) failedRequirements.push(requirement.capability);
    if (match) evidence.push(`${match.capability}:${match.support}:${match.evidence.level}:${match.evidence.reference || "<leer>"}`);
    else evidence.push(`${requirement.capability}:not_profiled`);
  }

  return {
    operation,
    allowedByProfile: failedRequirements.length === 0,
    failedRequirements,
    evidence,
    releaseAuthority: "none",
  };
}
