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

export type SchemaCheck = {
  field: keyof RawRecord;
  present: boolean;
  typeOk: boolean;
  formatOk: boolean;
  expected: string;
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
  mode: "read_only";
  overallStatus: "valid" | "needs_review";
  conflicts: string[];
};

export type BridgeEvaluation = {
  raw: RawRecord;
  snapshot: {
    capturedAt: string;
    source: string;
    sourceRecord: string;
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
    { field: "KUNDEN_NR", present: "KUNDEN_NR" in raw, typeOk: typeof raw.KUNDEN_NR === "string", formatOk: raw.KUNDEN_NR.length > 0, expected: "nichtleerer Text" },
    { field: "AUFTRAGS_NR", present: "AUFTRAGS_NR" in raw, typeOk: typeof raw.AUFTRAGS_NR === "string", formatOk: /^A-\d+$/.test(raw.AUFTRAGS_NR), expected: "A-<Ziffern>" },
    { field: "STATUS", present: "STATUS" in raw, typeOk: typeof raw.STATUS === "string", formatOk: /^[A-Z_]+$/.test(raw.STATUS), expected: "Großbuchstaben / Unterstrich" },
    { field: "MENGE", present: "MENGE" in raw, typeOk: typeof raw.MENGE === "string", formatOk: /^-?\d+(\.\d+)?$/.test(raw.MENGE), expected: "numerischer Text" },
    { field: "DATUM", present: "DATUM" in raw, typeOk: typeof raw.DATUM === "string", formatOk: /^\d{4}-\d{2}-\d{2}$/.test(raw.DATUM) || /^\d{2}\.\d{2}\.\d{4}$/.test(raw.DATUM), expected: "YYYY-MM-DD oder DD.MM.YYYY" },
  ];
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

export function evaluateRecord(raw: RawRecord, capturedAt: string): BridgeEvaluation {
  const schema = buildSchemaChecks(raw);
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

  const issues: ValidationIssue[] = checks.filter(({ ok }) => !ok).map((check) => ({ field: check.field, issue: check.issueCode, sourceValue: raw[check.field], rule: check.rule, severity: check.severity, message: issueMessage(check, raw) }));
  const blockingIssues = issues.filter(({ severity }) => severity === "blocking").length;
  const releaseAllowed = blockingIssues === 0;
  const passed = issues.length === 0;
  const source = "system_a";
  const sourceRecord = raw.AUFTRAGS_NR;
  const report = {
    confirmedMappings: fieldMap.map(([from, to]) => `${from} → ${to}`),
    openPoints: issues.filter(({ severity }) => severity === "warning").map(({ message }) => message),
    errors: issues.filter(({ severity }) => severity === "blocking").map(({ message }) => message),
    nextStep: releaseAllowed ? "Freigabe dokumentieren und Ausgabe übergeben." : "BLOCKING-Issues fachlich klären; Quelle bleibt unverändert.",
  };

  return {
    raw,
    snapshot: { capturedAt, source, sourceRecord, values: { ...raw } },
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
      reason: releaseAllowed ? (issues.length > 0 ? "Keine BLOCKING-Issues vorhanden; Hinweise bleiben dokumentiert." : "Alle bestätigten Regeln bestanden.") : `${blockingIssues} BLOCKING-Issue${blockingIssues === 1 ? "" : "s"} vorhanden. Freigabe blockiert.`,
    },
    provenance: { source, sourceRecord, capturedAt, mode: "read_only", overallStatus: passed ? "valid" : "needs_review", conflicts: issues.map(({ message }) => message) },
    report,
  };
}
