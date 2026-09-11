export type ReadScopeStatus = "confirmed" | "candidate" | "unresolved";
export type ReadMode = "targeted" | "expand_on_demand";
export type ReadPlanStatus = "ready" | "needs_confirmation" | "blocked";

export type AddressableReadRequest = {
  source: string;
  rootAddress: string;
  rootIdentity: string;
  requestedFields: string[];
  requestedRelations: string[];
  knownAddresses: Record<string, string>;
  scopeStatus: ReadScopeStatus;
  readOnlyConfirmed: boolean;
  maxRelationDepth?: number;
  evidence: string[];
};

export type AddressableReadTarget = {
  kind: "root" | "relation";
  name: string;
  address: string | null;
  status: ReadScopeStatus;
  reason: string;
};

export type AddressableReadPlan = {
  status: ReadPlanStatus;
  mode: ReadMode;
  rootAddress: string | null;
  requestedFields: string[];
  targets: AddressableReadTarget[];
  maxRelationDepth: number;
  blockers: string[];
  evidence: string[];
  sourcePolicy: "preserve";
  writePolicy: "forbidden";
  loadingPolicy: "read_only_expand_on_demand";
  note: string;
};

function normalizedUnique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

/**
 * Builds a conservative, read-only plan for addressable knowledge retrieval.
 *
 * The plan starts from one confirmed root address and only includes explicitly
 * requested fields/relations. Related data is expanded on demand and only when
 * a concrete address/locator is known. Missing relation addresses are not
 * guessed. The plan never authorizes source writes and does not turn retrieval
 * convenience into semantic truth.
 */
export function buildAddressableReadPlan(
  request: AddressableReadRequest,
): AddressableReadPlan {
  const requestedFields = normalizedUnique(request.requestedFields);
  const requestedRelations = normalizedUnique(request.requestedRelations);
  const rootAddress = request.rootAddress.trim();
  const rootIdentity = request.rootIdentity.trim();
  const maxRelationDepth = Math.max(0, Math.min(request.maxRelationDepth ?? 1, 5));

  const blockers: string[] = [];
  if (!request.readOnlyConfirmed) {
    blockers.push("Der Zugriff ist nicht als read-only bestätigt.");
  }
  if (!rootAddress) {
    blockers.push("Die Root-Adresse ist nicht bestätigt.");
  }
  if (!rootIdentity) {
    blockers.push("Die Root-Identität ist nicht bestätigt.");
  }
  if (request.scopeStatus === "unresolved") {
    blockers.push("Der angeforderte Lesebereich ist nicht bestätigt.");
  }

  const targets: AddressableReadTarget[] = [
    {
      kind: "root",
      name: rootIdentity || "root",
      address: rootAddress || null,
      status: rootAddress && rootIdentity ? "confirmed" : "unresolved",
      reason: "Der konkrete Ausgangsdatensatz wird direkt adressiert; es wird kein Vollbestand geladen.",
    },
  ];

  for (const relation of requestedRelations) {
    const address = request.knownAddresses[relation]?.trim() || "";
    const status: ReadScopeStatus = address ? request.scopeStatus : "unresolved";
    if (!address) {
      blockers.push(`Für die angeforderte Beziehung ${relation} ist keine bestätigte Adresse vorhanden.`);
    }
    targets.push({
      kind: "relation",
      name: relation,
      address: address || null,
      status,
      reason: address
        ? "Die Beziehung wird nur bei Bedarf über ihren bekannten Locator gelesen."
        : "Ohne bekannten Locator wird die Beziehung nicht auf Verdacht geladen.",
    });
  }

  let status: ReadPlanStatus = "ready";
  if (!request.readOnlyConfirmed || !rootAddress || !rootIdentity) {
    status = "blocked";
  } else if (request.scopeStatus !== "confirmed" || targets.some(({ status: targetStatus }) => targetStatus !== "confirmed")) {
    status = "needs_confirmation";
  }

  return {
    status,
    mode: requestedRelations.length > 0 ? "expand_on_demand" : "targeted",
    rootAddress: rootAddress || null,
    requestedFields,
    targets,
    maxRelationDepth,
    blockers,
    evidence: [...request.evidence],
    sourcePolicy: "preserve",
    writePolicy: "forbidden",
    loadingPolicy: "read_only_expand_on_demand",
    note: status === "ready"
      ? "Der Lesepfad ist auf den konkret adressierten Bedarf begrenzt. Weitere Beziehungen werden nur über bestätigte Adressen und nur bei Bedarf geöffnet."
      : status === "needs_confirmation"
        ? "Der Root-Datensatz ist sicher adressierbar, aber mindestens ein angeforderter Teilbereich braucht noch Bestätigung."
        : "Ohne bestätigte Root-Identität, Root-Adresse und read-only Zugriff wird kein Lesepfad freigegeben.",
  };
}
