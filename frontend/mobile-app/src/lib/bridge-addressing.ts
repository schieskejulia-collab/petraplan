export type RepresentationStatus = "confirmed" | "unconfirmed" | "mismatch";
export type ComparisonRuleStatus = "explicit" | "missing";
export type SequenceStatus = "defined" | "undefined" | "conflicting";
export type AddressStatus = "resolved" | "missing" | "ambiguous";
export type IdentityStatus = "confirmed" | "missing" | "conflicting";

export type AddressingComparisonInput = {
  representationStatus: RepresentationStatus;
  representation: string;
  expectedRepresentation: string;
  comparisonRuleStatus: ComparisonRuleStatus;
  comparisonRule: string;
  sequenceStatus: SequenceStatus;
  sequence: readonly number[];
  addressStatus: AddressStatus;
  address: string;
  identityStatus: IdentityStatus;
  recordId: string;
  correlationId: string;
  source: string;
};

export type AddressingComparisonCheckId =
  | "addressing.representation"
  | "addressing.comparison_rule"
  | "addressing.sequence"
  | "addressing.address"
  | "addressing.identity";

export type AddressingComparisonCheck = {
  id: AddressingComparisonCheckId;
  label: string;
  passed: boolean;
  observed: string;
  expected: string;
  evidence: string;
  safeAction: string;
};

export type AddressingComparisonAssessment = {
  checks: AddressingComparisonCheck[];
  addressingReady: boolean;
  failedCheckIds: AddressingComparisonCheckId[];
  sourcePolicy: "preserve";
  releaseAuthority: "none";
  principle: "representation_compare_sequence_address_identity";
};

function hasStrictlyIncreasingUniqueSequence(sequence: readonly number[]): boolean {
  if (sequence.length === 0) return false;
  const seen = new Set<number>();
  for (let index = 0; index < sequence.length; index += 1) {
    const value = sequence[index];
    if (!Number.isInteger(value) || seen.has(value)) return false;
    if (index > 0 && value <= sequence[index - 1]) return false;
    seen.add(value);
  }
  return true;
}

/**
 * Internal Bridge assessment for making information safely findable and comparable.
 *
 * It does not decide release and does not mutate source data. It only checks whether
 * representation, comparison rule, processing order, address and identity are explicit
 * enough to support deterministic retrieval and traceability.
 */
export function assessAddressingAndComparison(
  input: AddressingComparisonInput,
): AddressingComparisonAssessment {
  const representationMatches =
    input.representationStatus === "confirmed" &&
    input.representation.trim().length > 0 &&
    input.expectedRepresentation.trim().length > 0 &&
    input.representation.trim().toLowerCase() === input.expectedRepresentation.trim().toLowerCase();

  const comparisonRuleExplicit =
    input.comparisonRuleStatus === "explicit" && input.comparisonRule.trim().length > 0;

  const sequenceDefined =
    input.sequenceStatus === "defined" && hasStrictlyIncreasingUniqueSequence(input.sequence);

  const addressResolved =
    input.addressStatus === "resolved" && input.address.trim().length > 0;

  const identityConfirmed =
    input.identityStatus === "confirmed" &&
    input.recordId.trim().length > 0 &&
    input.correlationId.trim().length > 0;

  const checks: AddressingComparisonCheck[] = [
    {
      id: "addressing.representation",
      label: "Technische Repräsentation ist bestätigt",
      passed: representationMatches,
      observed: input.representation || "<leer>",
      expected: input.expectedRepresentation || "<nicht definiert>",
      evidence: `source=${input.source}; representation=${input.representation || "<leer>"}; expected=${input.expectedRepresentation || "<leer>"}; status=${input.representationStatus}`,
      safeAction: "Unbestätigte oder abweichende Kodierung nicht stillschweigend als gleichwertige Darstellung behandeln.",
    },
    {
      id: "addressing.comparison_rule",
      label: "Vergleichsregel ist explizit definiert",
      passed: comparisonRuleExplicit,
      observed: input.comparisonRule || "<leer>",
      expected: "explizite Vergleichsregel",
      evidence: `source=${input.source}; comparisonRuleStatus=${input.comparisonRuleStatus}; rule=${input.comparisonRule || "<leer>"}`,
      safeAction: "Werte nicht vergleichen, solange unklar ist, ob Text, Typ, Bereich oder Bedeutung verglichen werden soll.",
    },
    {
      id: "addressing.sequence",
      label: "Prüfreihenfolge ist eindeutig und deterministisch",
      passed: sequenceDefined,
      observed: input.sequence.length > 0 ? input.sequence.join(" -> ") : "<leer>",
      expected: "eindeutige, streng aufsteigende Sequenz",
      evidence: `source=${input.source}; sequenceStatus=${input.sequenceStatus}; sequence=${input.sequence.join(",") || "<leer>"}`,
      safeAction: "Uneindeutige oder widersprüchliche Reihenfolge nicht als reproduzierbaren Ablauf behandeln.",
    },
    {
      id: "addressing.address",
      label: "Datensatz ist eindeutig adressierbar",
      passed: addressResolved,
      observed: input.address || "<leer>",
      expected: "eindeutig auflösbare Adresse oder Locator",
      evidence: `source=${input.source}; addressStatus=${input.addressStatus}; address=${input.address || "<leer>"}`,
      safeAction: "Bei fehlender oder mehrdeutiger Adresse nicht raten, welcher Datensatz gemeint ist.",
    },
    {
      id: "addressing.identity",
      label: "Identität und Zusammenhang des Falls sind bestätigt",
      passed: identityConfirmed,
      observed: `recordId=${input.recordId || "<leer>"}; correlationId=${input.correlationId || "<leer>"}`,
      expected: "bestätigte Record- und Correlation-ID",
      evidence: `source=${input.source}; identityStatus=${input.identityStatus}; recordId=${input.recordId || "<leer>"}; correlationId=${input.correlationId || "<leer>"}`,
      safeAction: "Identität nicht mit Bedeutung verwechseln und unklare Zuordnung nicht automatisch zusammenführen.",
    },
  ];

  const failedCheckIds = checks.filter(({ passed }) => !passed).map(({ id }) => id);

  return {
    checks,
    addressingReady: failedCheckIds.length === 0,
    failedCheckIds,
    sourcePolicy: "preserve",
    releaseAuthority: "none",
    principle: "representation_compare_sequence_address_identity",
  };
}
