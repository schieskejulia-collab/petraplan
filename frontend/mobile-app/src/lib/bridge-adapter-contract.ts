export type AdapterKind =
  | "sql_odbc"
  | "rest"
  | "xml"
  | "csv"
  | "sap"
  | "filesystem"
  | "other";

export type KnownUnknown = "supported" | "unsupported" | "unknown";
export type AccessMode = "read_only" | "write_capable" | "unknown";
export type ResultSemanticsStatus = "explicit" | "ambiguous" | "unknown";
export type PortabilityStatus = "portable" | "driver_specific" | "unknown";

export type SourceSelfDescription = {
  tablesOrCollections: KnownUnknown;
  fields: KnownUnknown;
  dataTypes: KnownUnknown;
  nullability: KnownUnknown;
  precisionAndScale: KnownUnknown;
};

export type AdapterContractInput = {
  sourceAddress: string;
  sourceIdentity: string;
  sourceIdentityVerified: boolean;
  adapterKind: AdapterKind;
  adapterName: string;
  adapterVersion: string;
  accessMode: AccessMode;
  metadataDiscovery: KnownUnknown;
  capabilityDiscovery: KnownUnknown;
  errorSemantics: ResultSemanticsStatus;
  emptyResultSemantics: ResultSemanticsStatus;
  portability: PortabilityStatus;
  selfDescription: SourceSelfDescription;
  evidenceReferences: readonly string[];
};

export type AdapterContractCheckId =
  | "adapter.identity"
  | "adapter.access_path"
  | "adapter.read_only"
  | "adapter.introspection"
  | "adapter.result_semantics"
  | "adapter.evidence";

export type AdapterContractCheck = {
  id: AdapterContractCheckId;
  label: string;
  passed: boolean;
  observed: string;
  expected: string;
  safeAction: string;
};

export type AdapterContractAssessment = {
  checks: AdapterContractCheck[];
  readyForReadIntrospection: boolean;
  failedCheckIds: AdapterContractCheckId[];
  sourceSelfDescription: SourceSelfDescription;
  portability: PortabilityStatus;
  sourcePolicy: "preserve";
  writePolicy: "forbidden";
  releaseAuthority: "none";
  semanticPolicy: "metadata_describes_structure_not_business_meaning";
  principle: "identify_access_path_verify_read_only_introspect_then_compare";
};

function hasText(value: string): boolean {
  return value.trim().length > 0;
}

function hasEvidence(refs: readonly string[]): boolean {
  return refs.some((reference) => hasText(reference));
}

function introspectionIsUsable(input: AdapterContractInput): boolean {
  if (input.metadataDiscovery !== "supported") return false;

  const description = input.selfDescription;
  return (
    description.fields === "supported" &&
    description.dataTypes === "supported" &&
    description.nullability !== "unknown"
  );
}

/**
 * Internal contract for the technical access path before PetraPlan reads source data.
 *
 * The adapter has to identify itself, prove a read-only path, expose enough metadata
 * for source introspection, and distinguish an error from a legitimate empty result.
 * Driver-specific behavior is allowed when it is explicit; "unknown" is preserved as
 * unknown instead of being coerced into support.
 *
 * Metadata can describe structure, but it never creates business semantics by itself.
 * This assessment has no release authority and cannot authorize source writes.
 */
export function assessAdapterContract(
  input: AdapterContractInput,
): AdapterContractAssessment {
  const identityReady =
    input.sourceIdentityVerified &&
    hasText(input.sourceAddress) &&
    hasText(input.sourceIdentity);

  const accessPathReady =
    hasText(input.adapterName) &&
    hasText(input.adapterVersion) &&
    hasText(input.adapterKind);

  const readOnlyGuaranteed = input.accessMode === "read_only";
  const introspectionReady = introspectionIsUsable(input);

  const resultSemanticsReady =
    input.errorSemantics === "explicit" &&
    input.emptyResultSemantics === "explicit";

  const evidenceReady = hasEvidence(input.evidenceReferences);

  const checks: AdapterContractCheck[] = [
    {
      id: "adapter.identity",
      label: "Quelle ist eindeutig identifiziert",
      passed: identityReady,
      observed: `address=${input.sourceAddress || "<leer>"}; identity=${input.sourceIdentity || "<leer>"}; verified=${input.sourceIdentityVerified}`,
      expected: "eindeutige, verifizierte Quellidentität",
      safeAction: "Keine Daten lesen, solange unklar ist, welche konkrete Quelle adressiert wurde.",
    },
    {
      id: "adapter.access_path",
      label: "Zugriffsweg und Adapter sind explizit",
      passed: accessPathReady,
      observed: `kind=${input.adapterKind}; adapter=${input.adapterName || "<leer>"}; version=${input.adapterVersion || "<leer>"}; portability=${input.portability}`,
      expected: "konkreter Adaptertyp, Name und Version",
      safeAction: "Nicht aus einer Datenbankfamilie ableiten, welcher Zugriffsweg tatsächlich verwendet wird.",
    },
    {
      id: "adapter.read_only",
      label: "Zugriff ist für den aktuellen Bridge-Modus nachweislich nur lesend",
      passed: readOnlyGuaranteed,
      observed: input.accessMode,
      expected: "read_only",
      safeAction: "Write-fähige oder unbekannte Zugriffe nicht verwenden, solange PetraPlan im Read-only-Modus arbeitet.",
    },
    {
      id: "adapter.introspection",
      label: "Quelle kann ihre Struktur ausreichend beschreiben",
      passed: introspectionReady,
      observed: `metadata=${input.metadataDiscovery}; fields=${input.selfDescription.fields}; types=${input.selfDescription.dataTypes}; nullability=${input.selfDescription.nullability}; precisionScale=${input.selfDescription.precisionAndScale}`,
      expected: "Metadatenzugriff sowie Feld-/Typinformationen; Unbekanntes bleibt explizit unbekannt",
      safeAction: "Struktur nicht erraten. Fehlende Metadaten als offene Contract-Frage behandeln.",
    },
    {
      id: "adapter.result_semantics",
      label: "Fehler und leeres Ergebnis sind unterscheidbar",
      passed: resultSemanticsReady,
      observed: `error=${input.errorSemantics}; empty=${input.emptyResultSemantics}`,
      expected: "explizite Fehler- und Empty-Result-Semantik",
      safeAction: "Ein technisches Problem nicht als 'keine Daten gefunden' interpretieren.",
    },
    {
      id: "adapter.evidence",
      label: "Adaptervertrag besitzt mindestens einen nachvollziehbaren Beleg",
      passed: evidenceReady,
      observed: input.evidenceReferences.filter(hasText).join(" | ") || "<kein Beleg>",
      expected: "Metadaten-, Treiber- oder Dokumentationsreferenz",
      safeAction: "Adaptereigenschaften nicht allein aus Erfahrung oder Erinnerung übernehmen.",
    },
  ];

  const failedCheckIds = checks.filter(({ passed }) => !passed).map(({ id }) => id);

  return {
    checks,
    readyForReadIntrospection: failedCheckIds.length === 0,
    failedCheckIds,
    sourceSelfDescription: { ...input.selfDescription },
    portability: input.portability,
    sourcePolicy: "preserve",
    writePolicy: "forbidden",
    releaseAuthority: "none",
    semanticPolicy: "metadata_describes_structure_not_business_meaning",
    principle: "identify_access_path_verify_read_only_introspect_then_compare",
  };
}
