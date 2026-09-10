export type IngressAuthStatus = "verified" | "unverified" | "not_applicable";
export type IngressConnectionStatus = "connected" | "failed" | "timeout";
export type IngressFreshnessStatus = "current" | "stale" | "unknown";
export type IngressVerificationStatus = "verified" | "unverified" | "failed";

export type IngressContextInput = {
  authStatus: IngressAuthStatus;
  connectionStatus: IngressConnectionStatus;
  freshnessStatus: IngressFreshnessStatus;
  contentType: string;
  expectedContentTypes: readonly string[];
  verificationStatus: IngressVerificationStatus;
  observedAt: string;
  source: string;
};

export type IngressContextCheckId =
  | "ingress.auth"
  | "ingress.connection"
  | "ingress.freshness"
  | "ingress.content_type"
  | "ingress.verification";

export type IngressContextCheck = {
  id: IngressContextCheckId;
  label: string;
  passed: boolean;
  observed: string;
  expected: string;
  evidence: string;
  safeAction: string;
};

export type IngressContextAssessment = {
  checks: IngressContextCheck[];
  contextTrusted: boolean;
  failedCheckIds: IngressContextCheckId[];
  sourcePolicy: "preserve";
  interpretationPolicy: "do_not_interpret_until_context_trusted";
};

function normalizeContentType(value: string): string {
  return value.split(";", 1)[0]?.trim().toLowerCase() ?? "";
}

export function assessIngressContext(input: IngressContextInput): IngressContextAssessment {
  const observedContentType = normalizeContentType(input.contentType);
  const expectedContentTypes = input.expectedContentTypes.map(normalizeContentType);

  const checks: IngressContextCheck[] = [
    {
      id: "ingress.auth",
      label: "Zugriffskontext ist bestätigt",
      passed: input.authStatus === "verified" || input.authStatus === "not_applicable",
      observed: input.authStatus,
      expected: "verified oder not_applicable",
      evidence: `source=${input.source}; auth=${input.authStatus}`,
      safeAction: "Unbestätigte Identität oder Berechtigung nicht als vertrauenswürdigen Eingang behandeln.",
    },
    {
      id: "ingress.connection",
      label: "Verbindung ist technisch zustande gekommen",
      passed: input.connectionStatus === "connected",
      observed: input.connectionStatus,
      expected: "connected",
      evidence: `source=${input.source}; connection=${input.connectionStatus}; observedAt=${input.observedAt}`,
      safeAction: "Bei Timeout oder Verbindungsfehler keine fachliche Interpretation aus einem unvollständigen Eingang ableiten.",
    },
    {
      id: "ingress.freshness",
      label: "Beobachteter Zustand ist aktuell",
      passed: input.freshnessStatus === "current",
      observed: input.freshnessStatus,
      expected: "current",
      evidence: `source=${input.source}; freshness=${input.freshnessStatus}; observedAt=${input.observedAt}`,
      safeAction: "Veraltete oder zeitlich unklare Kopien nicht als aktuellen Quellzustand ausgeben.",
    },
    {
      id: "ingress.content_type",
      label: "Inhaltstyp entspricht dem erwarteten Eingang",
      passed: observedContentType.length > 0 && expectedContentTypes.includes(observedContentType),
      observed: observedContentType || "<leer>",
      expected: expectedContentTypes.join(" | "),
      evidence: `source=${input.source}; contentType=${input.contentType || "<leer>"}`,
      safeAction: "Unerwarteten Inhaltstyp nicht stillschweigend als erwartetes Datenformat parsen.",
    },
    {
      id: "ingress.verification",
      label: "Technisch prüfbare Angaben sind verifiziert",
      passed: input.verificationStatus === "verified",
      observed: input.verificationStatus,
      expected: "verified",
      evidence: `source=${input.source}; verification=${input.verificationStatus}`,
      safeAction: "Formale Plausibilität nicht mit bestätigter technischer Verifikation verwechseln.",
    },
  ];

  const failedCheckIds = checks.filter(({ passed }) => !passed).map(({ id }) => id);

  return {
    checks,
    contextTrusted: failedCheckIds.length === 0,
    failedCheckIds,
    sourcePolicy: "preserve",
    interpretationPolicy: "do_not_interpret_until_context_trusted",
  };
}
