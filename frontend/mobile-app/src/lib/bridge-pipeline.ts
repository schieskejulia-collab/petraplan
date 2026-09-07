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
  mapped: MappedRecord;
  checks: ValidationCheck[];
  issues: ValidationIssue[];
  trace: TraceStep[];
  passed: boolean;
  release: ReleaseDecision;
  provenance: Provenance;
};

export const demoValidRecord: RawRecord = {
  KUNDEN_NR: "4711",
  AUFTRAGS_NR: "A-10027",
  STATUS: "OFFEN",
  MENGE: "12",
  DATUM: "2026-09-05",
};

export const demoConflictRecord: RawRecord = {
  ...demoValidRecord,
  STATUS: "UNBEKANNT",
  MENGE: "-4",
};

export const fieldMap = [
  ["KUNDEN_NR", "customerId", "unverändert"],
  ["AUFTRAGS_NR", "orderId", "eindeutig"],
  ["STATUS", "status", "OFFEN → open"],
  ["MENGE", "quantity", "Text → Zahl"],
  ["DATUM", "orderDate", "ISO-Format"],
] as const;

const statusMap: Record<string, MappedRecord["status"]> = {
  OFFEN: "open",
  GESCHLOSSEN: "closed",
  IN_BEARBEITUNG: "in_progress",
};

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

function mapRecord(source: RawRecord): MappedRecord {
  return {
    customerId: source.KUNDEN_NR,
    orderId: source.AUFTRAGS_NR,
    status: statusMap[source.STATUS] ?? null,
    quantity: Number(source.MENGE),
    orderDate: source.DATUM,
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
      return "Datum entspricht nicht dem bestätigten ISO-Format YYYY-MM-DD.";
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
    {
      sourceField: "KUNDEN_NR",
      sourceValue: raw.KUNDEN_NR,
      meaning: "Kundenkennung aus der Quelle",
      targetField: "customerId",
      mapping: "KUNDEN_NR → customerId",
      transformation: "keine",
      canonicalValue: mapped.customerId,
      validation: validationFor("KUNDEN_NR"),
    },
    {
      sourceField: "AUFTRAGS_NR",
      sourceValue: raw.AUFTRAGS_NR,
      meaning: "Auftragskennung aus der Quelle",
      targetField: "orderId",
      mapping: "AUFTRAGS_NR → orderId",
      transformation: "keine",
      canonicalValue: mapped.orderId,
      validation: validationFor("AUFTRAGS_NR"),
    },
    {
      sourceField: "STATUS",
      sourceValue: raw.STATUS,
      meaning: "Quellstatus des Auftrags",
      targetField: "status",
      mapping: "STATUS → status",
      transformation: mapped.status ? `${raw.STATUS} → ${mapped.status}` : "keine bestätigte Value-Map",
      canonicalValue: mapped.status,
      validation: validationFor("STATUS"),
    },
    {
      sourceField: "MENGE",
      sourceValue: raw.MENGE,
      meaning: "Menge des Auftrags",
      targetField: "quantity",
      mapping: "MENGE → quantity",
      transformation: "Text → Zahl",
      canonicalValue: Number.isFinite(mapped.quantity) ? mapped.quantity : null,
      validation: validationFor("MENGE"),
    },
    {
      sourceField: "DATUM",
      sourceValue: raw.DATUM,
      meaning: "Auftragsdatum",
      targetField: "orderDate",
      mapping: "DATUM → orderDate",
      transformation: "bestätigtes ISO-Format beibehalten",
      canonicalValue: mapped.orderDate,
      validation: validationFor("DATUM"),
    },
  ];
}

export function evaluateRecord(raw: RawRecord, capturedAt: string): BridgeEvaluation {
  const mapped = mapRecord(raw);
  const checks: ValidationCheck[] = [
    {
      field: "KUNDEN_NR",
      label: "Kunden-ID vorhanden",
      ok: Boolean(raw.KUNDEN_NR),
      rule: "Pflichtfeld",
      issueCode: "MISSING_REQUIRED_VALUE",
      severity: "blocking",
      observed: `KUNDEN_NR: ${raw.KUNDEN_NR || "—"}`,
    },
    {
      field: "AUFTRAGS_NR",
      label: "Auftragsnummer entspricht dem Demo-Prüffall",
      ok: raw.AUFTRAGS_NR === "A-10027",
      rule: "Demo-Referenz A-10027",
      issueCode: "UNEXPECTED_ORDER_ID",
      severity: "warning",
      observed: `AUFTRAGS_NR: ${raw.AUFTRAGS_NR}`,
    },
    {
      field: "STATUS",
      label: "Status erlaubt",
      ok: mapped.status !== null,
      rule: "OFFEN / GESCHLOSSEN / IN_BEARBEITUNG",
      issueCode: "UNKNOWN_STATUS",
      severity: "blocking",
      observed: `STATUS: ${raw.STATUS} → ${mapped.status ?? "nicht zugeordnet"}`,
    },
    {
      field: "MENGE",
      label: "Menge größer als 0",
      ok: Number.isFinite(mapped.quantity) && mapped.quantity > 0,
      rule: "Zahl > 0",
      issueCode: "NEGATIVE_VALUE",
      severity: "blocking",
      observed: `MENGE: ${Number.isFinite(mapped.quantity) ? mapped.quantity : raw.MENGE}`,
    },
    {
      field: "DATUM",
      label: "Datum gültig",
      ok: /^\d{4}-\d{2}-\d{2}$/.test(raw.DATUM),
      rule: "YYYY-MM-DD",
      issueCode: "INVALID_DATE_FORMAT",
      severity: "blocking",
      observed: `DATUM: ${raw.DATUM}`,
    },
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

  const blockingIssues = issues.filter(({ severity }) => severity === "blocking").length;
  const releaseAllowed = blockingIssues === 0;
  const passed = issues.length === 0;
  const source = "system_a";
  const sourceRecord = raw.AUFTRAGS_NR;

  return {
    raw,
    snapshot: {
      capturedAt,
      source,
      sourceRecord,
      values: { ...raw },
    },
    mapped,
    checks,
    issues,
    trace: buildTrace(raw, mapped, checks),
    passed,
    release: {
      releaseAllowed,
      blockingIssues,
      reason: releaseAllowed
        ? issues.length > 0
          ? "Keine BLOCKING-Issues vorhanden; Hinweise bleiben dokumentiert."
          : "Alle bestätigten Regeln bestanden."
        : `${blockingIssues} BLOCKING-Issue${blockingIssues === 1 ? "" : "s"} vorhanden. Freigabe blockiert.`,
    },
    provenance: {
      source,
      sourceRecord,
      capturedAt,
      mode: "read_only",
      overallStatus: passed ? "valid" : "needs_review",
      conflicts: issues.map(({ message }) => message),
    },
  };
}
