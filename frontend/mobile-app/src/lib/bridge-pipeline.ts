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
  label: string;
  ok: boolean;
  rule: string;
  observed: string;
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
  mapped: MappedRecord;
  checks: ValidationCheck[];
  passed: boolean;
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

export function evaluateRecord(raw: RawRecord, capturedAt: string): BridgeEvaluation {
  const mapped = mapRecord(raw);
  const checks: ValidationCheck[] = [
    { label: "Kunden-ID vorhanden", ok: Boolean(raw.KUNDEN_NR), rule: "Pflichtfeld", observed: `KUNDEN_NR: ${raw.KUNDEN_NR || "—"}` },
    { label: "Auftragsnummer eindeutig", ok: raw.AUFTRAGS_NR === "A-10027", rule: "Beispielprüfung", observed: `AUFTRAGS_NR: ${raw.AUFTRAGS_NR}` },
    { label: "Status erlaubt", ok: mapped.status !== null, rule: "OFFEN / GESCHLOSSEN / IN_BEARBEITUNG", observed: `STATUS: ${raw.STATUS} → ${mapped.status ?? "nicht zugeordnet"}` },
    { label: "Menge größer als 0", ok: Number.isFinite(mapped.quantity) && mapped.quantity > 0, rule: "Zahl > 0", observed: `MENGE: ${Number.isFinite(mapped.quantity) ? mapped.quantity : raw.MENGE}` },
    { label: "Datum gültig", ok: /^\d{4}-\d{2}-\d{2}$/.test(raw.DATUM), rule: "YYYY-MM-DD", observed: `DATUM: ${raw.DATUM}` },
  ];
  const passed = checks.every(({ ok }) => ok);

  return {
    raw,
    mapped,
    checks,
    passed,
    provenance: {
      source: "system_a",
      sourceRecord: raw.AUFTRAGS_NR,
      capturedAt,
      mode: "read_only",
      overallStatus: passed ? "valid" : "needs_review",
      conflicts: checks.filter(({ ok }) => !ok).map(({ label }) => label),
    },
  };
}
