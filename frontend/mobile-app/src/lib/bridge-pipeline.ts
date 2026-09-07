export type RawRecord = {
  KUNDEN_NR: string;
  AUFTRAGS_NR: string;
  STATUS: string;
  MENGE: string;
  DATUM: string;
};

export type MappedRecord = {
  customerId: string;
  orderId: string;
  status: "open" | "closed" | "in_progress" | null;
  quantity: number;
  orderDate: string;
};

export type IngressTransport = "demo" | "api" | "queue" | "file" | "manual" | "webservice";
export type InteractionMode = "request_reply" | "one_way" | "async";
export type TransportStatus = "received" | "failed" | "timeout";

export type IngressContext = {
  source: string;
  transport: IngressTransport;
  messageId: string;
  receivedAt: string;
  destination: string;
  service: string;
  operation: string;
  interactionMode: InteractionMode;
  correlationId: string;
  contract: string;
  transportStatus: TransportStatus;
};

export type InterfaceContract = {
  name: string;
  fields: Array<{
    field: keyof RawRecord;
    type: "string";
    required: true;
    format: string;
  }>;
};

export type SchemaCheck = {
  field: keyof RawRecord;
  present: boolean;
  typeOk: boolean;
  formatOk: boolean;
  expected: string;
  contract: string;
};

export type GatewayIssue = {
  scope: "transport" | "contract";
  issue: string;
  severity: "blocking";
  message: string;
};

export type MissingCheck = {
  field: keyof RawRecord;
  sourceValue: string;
  missing: boolean;
  rule: string;
};

export type SemanticEntry = {
  field: keyof RawRecord;
  fieldMeaning: string;
  valueMeaning: string;
};

export type ValidationCheck = {
  field: keyof RawRecord;
  label: string;
  ok: boolean;
  rule: string;
  issueCode: string;
  severity: "blocking" | "warning";
  observed: string;
};

export type ValidationIssue = {
  field: keyof RawRecord;
  issue: string;
  sourceValue: string;
  rule: string;
  severity: "blocking" | "warning";
  message: string;
};

export type TraceStep = {
  sourceField: keyof RawRecord;
  sourceValue: string;
  meaning: string;
  targetField: keyof MappedRecord;
  mapping: string;
  valueMap: string;
  transformation: string;
  canonicalValue: string | number | null;
  validation: "passed" | "failed";
};

export type ReleaseDecision = {
  releaseAllowed: boolean;
  reason: string;
  blockingIssues: number;
};

export type Provenance = {
  source: string;
  sourceRecord: string;
  capturedAt: string;
  transport: IngressTransport;
  messageId: string;
  destination: string;
  service: string;
  operation: string;
  interactionMode: InteractionMode;
  correlationId: string;
  contract: string;
  transportStatus: TransportStatus;
  mode: "read_only";
  overallStatus: "valid" | "needs_review";
  conflicts: string[];
};

export type BridgeEvaluation = {
  ingress: IngressContext;
  contract: InterfaceContract;
  gatewayIssues: GatewayIssue[];
  raw: RawRecord;
  snapshot: {
    capturedAt: string;
    source: string;
    sourceRecord: string;
    ingress: IngressContext;
    values: RawRecord;
  };
  schema: SchemaCheck[];
  missing: MissingCheck[];
  semantics: SemanticEntry[];
  fieldMap: typeof fieldMap;
  valueMap: typeof valueMap;
  transformations: Array<{ field: keyof RawRecord; before: string; after: string; rule: string }>;
  mapped: MappedRecord;
  checks: ValidationCheck[];
  issues: ValidationIssue[];
  trace: TraceStep[];
  passed: boolean;
  release: ReleaseDecision;
  provenance: Provenance;
  report: {
    confirmedMappings: string[];
    openPoints: string[];
    errors: string[];
    nextStep: string;
  };
};

export const demoValidRecord: RawRecord = {
  KUNDEN_NR: "4711",
  AUFTRAGS_NR: "A-10027",
  STATUS: "OFFEN",
  MENGE: "12",
  DATUM: "07.09.2026",
};

export const demoConflictRecord: RawRecord = {
  ...demoValidRecord,
  STATUS: "UNBEKANNT",
  MENGE: "-4",
};

export const orderContract: InterfaceContract = {
  name: "order-v1",
  fields: [
    { field: "KUNDEN_NR", type: "string", required: true, format: "nichtleerer Text" },
    { field: "AUFTRAGS_NR", type: "string", required: true, format: "A-<Ziffern>" },
    { field: "STATUS", type: "string", required: true, format: "Großbuchstaben / Unterstrich" },
    { field: "MENGE", type: "string", required: true, format: "numerischer Text" },
    { field: "DATUM", type: "string", required: true, format: "YYYY-MM-DD oder DD.MM.YYYY" },
  ],
};

export const fieldMap = [
  ["KUNDEN_NR", "customerId", "Quellfeld wird der neutralen Kundenkennung zugeordnet"],
  ["AUFTRAGS_NR", "orderId", "Quellfeld wird der neutralen Auftragskennung zugeordnet"],
  ["STATUS", "status", "Quellstatus wird dem neutralen Statusfeld zugeordnet"],
  ["MENGE", "quantity", "Quellmenge wird dem neutralen Mengenfeld zugeordnet"],
  ["DATUM", "orderDate", "Quelldatum wird dem neutralen Datumsfeld zugeordnet"],
] as const;

export const valueMap = [
  ["STATUS", "OFFEN", "open"],
  ["STATUS", "GESCHLOSSEN", "closed"],
  ["STATUS", "IN_BEARBEITUNG", "in_progress"],
] as const;

const statusMap: Record<string, MappedRecord["status"]> = {
  OFFEN: "open",
  GESCHLOSSEN: "closed",
  IN_BEARBEITUNG: "in_progress",
};

const missingMarkers = new Set(["", "NULL", "N/A"]);

function isMissing(value: string): boolean {
  return missingMarkers.has(value.trim().toUpperCase());
}

function normalizeDate(value: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const match = value.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (!match) return value;
  const [, day, month, year] = match;
  return `${year}-${month}-${day}`;
}

export function createIngressContext(
  raw: RawRecord,
  capturedAt: string,
  overrides: Partial<IngressContext> = {},
): IngressContext {
  const source = overrides.source ?? "system_a";
  const messageId = overrides.messageId ?? `msg:${source}:${raw.AUFTRAGS_NR}:${capturedAt}`;
  return {
    source,
    transport: overrides.transport ?? "demo",
    messageId,
    receivedAt: overrides.receivedAt ?? capturedAt,
    destination: overrides.destination ?? "bridge",
    service: overrides.service ?? "orders-service",
    operation: overrides.operation ?? "receiveOrder",
    interactionMode: overrides.interactionMode ?? "request_reply",
    correlationId: overrides.correlationId ?? `corr:${messageId}`,
    contract: overrides.contract ?? orderContract.name,
    transportStatus: overrides.transportStatus ?? "received",
  };
}

export function parseRawRecord(value: unknown): RawRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Der Datensatz muss ein JSON-Objekt sein.");
  }

  const source = value as Record<string, unknown>;
  const fields: Array<keyof RawRecord> = ["KUNDEN_NR", "AUFTRAGS_NR", "STATUS", "MENGE", "DATUM"];
  const missing = fields.filter((field) => typeof source[field] !== "string");

  if (missing.length > 0) {
    throw new Error(`Fehlende oder ungültige Felder: ${missing.join(", ")}`);
  }

  return {
    KUNDEN_NR: source.KUNDEN_NR as string,
    AUFTRAGS_NR: source.AUFTRAGS_NR as string,
    STATUS: source.STATUS as string,
    MENGE: source.MENGE as string,
    DATUM: source.DATUM as string,
  };
}

function buildSchemaChecks(raw: RawRecord): SchemaCheck[] {
  return [
    { field: "KUNDEN_NR", present: "KUNDEN_NR" in raw, typeOk: typeof raw.KUNDEN_NR === "string", formatOk: typeof raw.KUNDEN_NR === "string" && raw.KUNDEN_NR.length > 0, expected: "nichtleerer Text", contract: orderContract.name },
    { field: "AUFTRAGS_NR", present: "AUFTRAGS_NR" in raw, typeOk: typeof raw.AUFTRAGS_NR === "string", formatOk: typeof raw.AUFTRAGS_NR === "string" && /^A-\d+$/.test(raw.AUFTRAGS_NR), expected: "A-<Ziffern>", contract: orderContract.name },
    { field: "STATUS", present: "STATUS" in raw, typeOk: typeof raw.STATUS === "string", formatOk: typeof raw.STATUS === "string" && /^[A-Z_]+$/.test(raw.STATUS), expected: "Großbuchstaben / Unterstrich", contract: orderContract.name },
    { field: "MENGE", present: "MENGE" in raw, typeOk: typeof raw.MENGE === "string", formatOk: typeof raw.MENGE === "string" && /^-?\d+(\.\d+)?$/.test(raw.MENGE), expected: "numerischer Text", contract: orderContract.name },
    { field: "DATUM", present: "DATUM" in raw, typeOk: typeof raw.DATUM === "string", formatOk: typeof raw.DATUM === "string" && (/^\d{4}-\d{2}-\d{2}$/.test(raw.DATUM) || /^\d{2}\.\d{2}\.\d{4}$/.test(raw.DATUM)), expected: "YYYY-MM-DD oder DD.MM.YYYY", contract: orderContract.name },
  ];
}

function buildGatewayIssues(ingress: IngressContext, schema: SchemaCheck[]): GatewayIssue[] {
  const issues: GatewayIssue[] = [];

  if (ingress.transportStatus !== "received") {
    issues.push({
      scope: "transport",
      issue: ingress.transportStatus === "timeout" ? "TRANSPORT_TIMEOUT" : "TRANSPORT_FAILED",
      severity: "blocking",
      message: ingress.transportStatus === "timeout"
        ? "Transport hat das Zeitlimit überschritten. Datensatz darf nicht freigegeben werden."
        : "Transport ist fehlgeschlagen. Datensatz darf nicht freigegeben werden.",
    });
  }

  if (ingress.contract !== orderContract.name) {
    issues.push({
      scope: "contract",
      issue: "UNKNOWN_CONTRACT",
      severity: "blocking",
      message: `Schnittstellenvertrag '${ingress.contract}' ist nicht bestätigt. Erwartet: ${orderContract.name}.`,
    });
  }

  const failedSchema = schema.filter(({ present, typeOk, formatOk }) => !present || !typeOk || !formatOk);
  if (failedSchema.length > 0) {
    issues.push({
      scope: "contract",
      issue: "CONTRACT_MISMATCH",
      severity: "blocking",
      message: `${failedSchema.length} Feld${failedSchema.length === 1 ? "" : "er"} entsprechen nicht dem bestätigten Vertrag ${orderContract.name}.`,
    });
  }

  return issues;
}

function buildMissingChecks(raw: RawRecord): MissingCheck[] {
  return (Object.keys(raw) as Array<keyof RawRecord>).map((field) => ({
    field,
    sourceValue: raw[field],
    missing: isMissing(raw[field]),
    rule: "Nur bestätigte Marker gelten als fehlend: leer, NULL, N/A",
  }));
}

function buildSemantics(raw: RawRecord): SemanticEntry[] {
  return [
    { field: "KUNDEN_NR", fieldMeaning: "Kennung des Kunden in der Quelle", valueMeaning: raw.KUNDEN_NR ? `Kunde ${raw.KUNDEN_NR}` : "nicht bestimmt" },
    { field: "AUFTRAGS_NR", fieldMeaning: "Kennung des Auftrags in der Quelle", valueMeaning: raw.AUFTRAGS_NR ? `Auftrag ${raw.AUFTRAGS_NR}` : "nicht bestimmt" },
    { field: "STATUS", fieldMeaning: "Zustand des Auftrags", valueMeaning: statusMap[raw.STATUS] ? `${raw.STATUS} bedeutet ${statusMap[raw.STATUS]}` : "Bedeutung nicht bestätigt" },
    { field: "MENGE", fieldMeaning: "Mengenwert des Auftrags", valueMeaning: isMissing(raw.MENGE) ? "fehlender Wert" : `Quellwert ${raw.MENGE}` },
    { field: "DATUM", fieldMeaning: "Auftragsdatum", valueMeaning: `Quellformat ${raw.DATUM}` },
  ];
}

function mapRecord(source: RawRecord): MappedRecord {
  return {
    customerId: source.KUNDEN_NR,
    orderId: source.AUFTRAGS_NR,
    status: statusMap[source.STATUS] ?? null,
    quantity: Number(source.MENGE),
    orderDate: normalizeDate(source.DATUM),
  };
}

function issueMessage(check: ValidationCheck, raw: RawRecord): string {
  switch (check.issueCode) {
    case "MISSING_REQUIRED_VALUE":
      return "Pflichtwert fehlt. Prüfung blockiert.";
    case "UNKNOWN_STATUS":
      return `Status '${raw.STATUS}' ist nicht bestätigt. Prüfung blockiert.`;
    case "NEGATIVE_VALUE":
      return "Menge ist negativ oder null. Prüfung blockiert.";
    case "INVALID_DATE_FORMAT":
      return "Datum konnte nicht in das bestätigte ISO-Format YYYY-MM-DD überführt werden.";
    case "UNEXPECTED_ORDER_ID":
      return "Auftragsnummer weicht vom Demo-Prüffall ab.";
    default:
      return `${check.label} ist fehlgeschlagen.`;
  }
}

function buildTrace(raw: RawRecord, mapped: MappedRecord, checks: ValidationCheck[]): TraceStep[] {
  const validationFor = (field: keyof RawRecord) =>
    checks.some((check) => check.field === field && !check.ok) ? "failed" as const : "passed" as const;

  return [
    { sourceField: "KUNDEN_NR", sourceValue: raw.KUNDEN_NR, meaning: "Kundenkennung aus der Quelle", targetField: "customerId", mapping: "KUNDEN_NR → customerId", valueMap: "nicht erforderlich", transformation: "keine", canonicalValue: mapped.customerId, validation: validationFor("KUNDEN_NR") },
    { sourceField: "AUFTRAGS_NR", sourceValue: raw.AUFTRAGS_NR, meaning: "Auftragskennung aus der Quelle", targetField: "orderId", mapping: "AUFTRAGS_NR → orderId", valueMap: "nicht erforderlich", transformation: "keine", canonicalValue: mapped.orderId, validation: validationFor("AUFTRAGS_NR") },
    { sourceField: "STATUS", sourceValue: raw.STATUS, meaning: "Quellstatus des Auftrags", targetField: "status", mapping: "STATUS → status", valueMap: mapped.status ? `${raw.STATUS} → ${mapped.status}` : "keine bestätigte Value-Map", transformation: "keine", canonicalValue: mapped.status, validation: validationFor("STATUS") },
    { sourceField: "MENGE", sourceValue: raw.MENGE, meaning: "Menge des Auftrags", targetField: "quantity", mapping: "MENGE → quantity", valueMap: "nicht erforderlich", transformation: "Text → Zahl", canonicalValue: Number.isFinite(mapped.quantity) ? mapped.quantity : null, validation: validationFor("MENGE") },
    { sourceField: "DATUM", sourceValue: raw.DATUM, meaning: "Auftragsdatum", targetField: "orderDate", mapping: "DATUM → orderDate", valueMap: "nicht erforderlich", transformation: raw.DATUM === mapped.orderDate ? "keine" : `${raw.DATUM} → ${mapped.orderDate}`, canonicalValue: mapped.orderDate, validation: validationFor("DATUM") },
  ];
}

export function evaluateRecord(
  raw: RawRecord,
  capturedAt: string,
  ingressOverrides: Partial<IngressContext> = {},
): BridgeEvaluation {
  const ingress = createIngressContext(raw, capturedAt, ingressOverrides);
  const schema = buildSchemaChecks(raw);
  const gatewayIssues = buildGatewayIssues(ingress, schema);
  const missing = buildMissingChecks(raw);
  const semantics = buildSemantics(raw);
  const mapped = mapRecord(raw);
  const transformations = [
    { field: "MENGE" as const, before: raw.MENGE, after: Number.isFinite(mapped.quantity) ? String(mapped.quantity) : raw.MENGE, rule: "numerischen Text in Zahl überführen" },
    { field: "DATUM" as const, before: raw.DATUM, after: mapped.orderDate, rule: "bestätigtes Datumsformat nach YYYY-MM-DD normalisieren" },
  ];

  const checks: ValidationCheck[] = [
    { field: "KUNDEN_NR", label: "Kunden-ID vorhanden", ok: !isMissing(raw.KUNDEN_NR), rule: "Pflichtfeld", issueCode: "MISSING_REQUIRED_VALUE", severity: "blocking", observed: `KUNDEN_NR: ${raw.KUNDEN_NR || "—"}` },
    { field: "AUFTRAGS_NR", label: "Auftragsnummer entspricht dem Demo-Prüffall", ok: raw.AUFTRAGS_NR === "A-10027", rule: "Demo-Referenz A-10027", issueCode: "UNEXPECTED_ORDER_ID", severity: "warning", observed: `AUFTRAGS_NR: ${raw.AUFTRAGS_NR}` },
    { field: "STATUS", label: "Status erlaubt", ok: mapped.status !== null, rule: "OFFEN / GESCHLOSSEN / IN_BEARBEITUNG", issueCode: "UNKNOWN_STATUS", severity: "blocking", observed: `STATUS: ${raw.STATUS} → ${mapped.status ?? "nicht zugeordnet"}` },
    { field: "MENGE", label: "Menge größer als 0", ok: !isMissing(raw.MENGE) && Number.isFinite(mapped.quantity) && mapped.quantity > 0, rule: "Zahl > 0", issueCode: "NEGATIVE_VALUE", severity: "blocking", observed: `MENGE: ${Number.isFinite(mapped.quantity) ? mapped.quantity : raw.MENGE}` },
    { field: "DATUM", label: "Datum gültig", ok: /^\d{4}-\d{2}-\d{2}$/.test(mapped.orderDate), rule: "YYYY-MM-DD nach bestätigter Transformation", issueCode: "INVALID_DATE_FORMAT", severity: "blocking", observed: `DATUM: ${raw.DATUM} → ${mapped.orderDate}` },
  ];

  const issues: ValidationIssue[] = checks
    .filter(({ ok }) => !ok)
    .map((check) => ({
      field: check.field,
      issue: check.issueCode,
      sourceValue: raw[check.field],
      rule: check.rule,
      severity: check.severity,
      message: issueMessage(check, raw),
    }));

  const dataBlockingIssues = issues.filter(({ severity }) => severity === "blocking").length;
  const blockingIssues = dataBlockingIssues + gatewayIssues.length;
  const releaseAllowed = blockingIssues === 0;
  const passed = issues.length === 0 && gatewayIssues.length === 0;
  const sourceRecord = raw.AUFTRAGS_NR;
  const report = {
    confirmedMappings: fieldMap.map(([from, to]) => `${from} → ${to}`),
    openPoints: issues.filter(({ severity }) => severity === "warning").map(({ message }) => message),
    errors: [
      ...gatewayIssues.map(({ message }) => message),
      ...issues.filter(({ severity }) => severity === "blocking").map(({ message }) => message),
    ],
    nextStep: releaseAllowed
      ? "Freigabe dokumentieren und Ausgabe übergeben."
      : "BLOCKING-Issues klären; Transport-, Vertrags- und Datenfehler bleiben getrennt nachvollziehbar.",
  };

  return {
    ingress,
    contract: orderContract,
    gatewayIssues,
    raw,
    snapshot: {
      capturedAt,
      source: ingress.source,
      sourceRecord,
      ingress: { ...ingress },
      values: { ...raw },
    },
    schema,
    missing,
    semantics,
    fieldMap,
    valueMap,
    transformations,
    mapped,
    checks,
    issues,
    trace: buildTrace(raw, mapped, checks),
    passed,
    release: {
      releaseAllowed,
      blockingIssues,
      reason: releaseAllowed
        ? "Keine fehlgeschlagene BLOCKING-Regel vorhanden."
        : `${blockingIssues} BLOCKING-Issue${blockingIssues === 1 ? "" : "s"} aus Transport, Vertrag oder Datenprüfung vorhanden. Freigabe blockiert.`,
    },
    provenance: {
      source: ingress.source,
      sourceRecord,
      capturedAt,
      transport: ingress.transport,
      messageId: ingress.messageId,
      destination: ingress.destination,
      service: ingress.service,
      operation: ingress.operation,
      interactionMode: ingress.interactionMode,
      correlationId: ingress.correlationId,
      contract: ingress.contract,
      transportStatus: ingress.transportStatus,
      mode: "read_only",
      overallStatus: passed ? "valid" : "needs_review",
      conflicts: [
        ...gatewayIssues.map(({ message }) => message),
        ...issues.map(({ message }) => message),
      ],
    },
    report,
  };
}