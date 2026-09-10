import type {
  BridgeEvaluation,
  IngressContext,
  InterfaceContract,
  MappedRecord,
  RawRecord,
  SchemaCheck,
  ValidationCheck,
} from "./bridge-pipeline";

export type ConstraintCategory = "transport" | "contract" | "semantics" | "data";
export type ConstraintSeverity = "blocking" | "warning";
export type ConstraintOperator =
  | "equals"
  | "strict_equals"
  | "not_missing"
  | "in"
  | "greater_than"
  | "matches"
  | "schema_matches";

export type ConstraintScope = {
  contract: string;
  field: keyof RawRecord | null;
};

export type ConstraintComparison = {
  operator: ConstraintOperator;
  expected: string;
  observed: string;
  observedType: string;
};

export type ConstraintResult = {
  id: string;
  sequence: number;
  category: ConstraintCategory;
  field: keyof RawRecord | null;
  scope: ConstraintScope;
  label: string;
  passed: boolean;
  severity: ConstraintSeverity;
  comparison: ConstraintComparison;
  rule: string;
  evidence: string;
  safeAction: string;
  resolutionProposal: string;
  sourcePolicy: "preserve";
  errorPolicy: "capture";
};

export type ConstraintDecision = {
  releaseAllowed: boolean;
  blockingIssues: number;
  failedConstraintIds: string[];
  evaluatedConstraintIds: string[];
  expression: string;
  resolutionProposals: string[];
};

export type ConstraintInput = {
  ingress: IngressContext;
  contract: InterfaceContract;
  schema: SchemaCheck[];
  raw: RawRecord;
  mapped: MappedRecord;
  checks: ValidationCheck[];
  valueMap: ReadonlyArray<readonly [string, string, string]>;
};

function result(
  input: ConstraintInput,
  value: Omit<ConstraintResult, "scope" | "sourcePolicy" | "errorPolicy">,
): ConstraintResult {
  return {
    ...value,
    scope: { contract: input.contract.name, field: value.field },
    sourcePolicy: "preserve",
    errorPolicy: "capture",
  };
}

function isRealCanonicalDate(value: string): boolean {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;

  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);

  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false;
  if (month < 1 || month > 12 || day < 1) return false;

  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return day <= daysInMonth;
}

export function evaluateConstraintSet(input: ConstraintInput): ConstraintResult[] {
  const statusEntries = input.valueMap.filter(([field]) => field === "STATUS");
  const statusTargets = statusEntries.map(([, source, target]) => `${source} → ${target}`).join(", ");
  const statusSources = statusEntries.map(([, source]) => source);
  const failedSchema = input.schema.filter(({ present, typeOk, formatOk }) => !present || !typeOk || !formatOk);
  const dateCheckPassed = input.checks.find(({ field }) => field === "DATUM")?.ok ?? false;
  const calendarDatePassed = isRealCanonicalDate(input.mapped.orderDate);

  return [
    result(input, {
      id: "transport.received",
      sequence: 1,
      category: "transport",
      field: null,
      label: "Nachricht wurde sicher empfangen",
      passed: input.ingress.transportStatus === "received",
      severity: "blocking",
      comparison: {
        operator: "strict_equals",
        expected: "received",
        observed: input.ingress.transportStatus,
        observedType: typeof input.ingress.transportStatus,
      },
      rule: "Transportstatus muss received sein",
      evidence: `transport=${input.ingress.transport}; status=${input.ingress.transportStatus}; messageId=${input.ingress.messageId}`,
      safeAction: "Originalnachricht und Transportkontext unverändert festhalten.",
      resolutionProposal: input.ingress.transportStatus === "received"
        ? "Keine Transportauflösung nötig."
        : "Transportweg prüfen und erst nach bestätigtem Eingang erneut bewerten.",
    }),
    result(input, {
      id: "contract.version",
      sequence: 2,
      category: "contract",
      field: null,
      label: "Schnittstellenvertrag ist bestätigt",
      passed: input.ingress.contract === input.contract.name,
      severity: "blocking",
      comparison: {
        operator: "strict_equals",
        expected: input.contract.name,
        observed: input.ingress.contract,
        observedType: typeof input.ingress.contract,
      },
      rule: `Vertragsversion muss ${input.contract.name} entsprechen`,
      evidence: `gesendet=${input.ingress.contract}; bestätigt=${input.contract.name}`,
      safeAction: "Keine unbekannte Vertragsversion stillschweigend übernehmen.",
      resolutionProposal: input.ingress.contract === input.contract.name
        ? "Keine Vertragsauflösung nötig."
        : `Vertragsversion ${input.ingress.contract} bestätigen oder eine dokumentierte Zuordnung zu ${input.contract.name} anlegen.`,
    }),
    result(input, {
      id: "contract.schema",
      sequence: 3,
      category: "contract",
      field: null,
      label: "Nachricht entspricht dem bestätigten Schema",
      passed: failedSchema.length === 0,
      severity: "blocking",
      comparison: {
        operator: "schema_matches",
        expected: `${input.contract.name}: Pflichtfelder + Typ + Format`,
        observed: failedSchema.length === 0 ? "schemaFehler=0" : failedSchema.map(({ field }) => field).join(","),
        observedType: "schema-result",
      },
      rule: "Alle Pflichtfelder müssen vorhanden sein und dem bestätigten Typ/Format entsprechen",
      evidence: failedSchema.length === 0
        ? "schemaFehler=0"
        : `schemaFehler=${failedSchema.length}; felder=${failedSchema.map(({ field }) => field).join(",")}`,
      safeAction: "Abweichende Struktur nicht stillschweigend als gültigen Vertrag behandeln.",
      resolutionProposal: failedSchema.length === 0
        ? "Keine Schemaauflösung nötig."
        : `Abweichende Felder (${failedSchema.map(({ field }) => field).join(", ")}) gegen ${input.contract.name} prüfen und Vertrag oder Nachricht eindeutig angleichen.`,
    }),
    result(input, {
      id: "customer.required",
      sequence: 4,
      category: "data",
      field: "KUNDEN_NR",
      label: "Kundenkennung ist vorhanden",
      passed: input.checks.find(({ field }) => field === "KUNDEN_NR")?.ok ?? false,
      severity: "blocking",
      comparison: {
        operator: "not_missing",
        expected: "nicht leer / nicht NULL / nicht N/A",
        observed: input.raw.KUNDEN_NR || "<leer>",
        observedType: typeof input.raw.KUNDEN_NR,
      },
      rule: "KUNDEN_NR ist ein Pflichtfeld",
      evidence: `KUNDEN_NR=${input.raw.KUNDEN_NR || "<leer>"}`,
      safeAction: "Fehlende Kundenkennung nicht erfinden.",
      resolutionProposal: "Kundenkennung an der Quelle ergänzen oder die Pflichtregel fachlich neu bestätigen.",
    }),
    result(input, {
      id: "order.demo_reference",
      sequence: 5,
      category: "data",
      field: "AUFTRAGS_NR",
      label: "Auftragsnummer entspricht dem Demo-Referenzfall",
      passed: input.checks.find(({ field }) => field === "AUFTRAGS_NR")?.ok ?? false,
      severity: "warning",
      comparison: {
        operator: "strict_equals",
        expected: "A-10027",
        observed: input.raw.AUFTRAGS_NR,
        observedType: typeof input.raw.AUFTRAGS_NR,
      },
      rule: "Demo-Referenz ist A-10027",
      evidence: `AUFTRAGS_NR=${input.raw.AUFTRAGS_NR}`,
      safeAction: "Abweichende Auftragsnummer dokumentieren; sie blockiert die fachliche Freigabe nicht.",
      resolutionProposal: "Nur für den Demo-Vergleich prüfen, ob die erwartete Referenz A-10027 verwendet werden sollte.",
    }),
    result(input, {
      id: "status.value_map",
      sequence: 6,
      category: "semantics",
      field: "STATUS",
      label: "Statuswert hat eine bestätigte Bedeutung",
      passed: input.mapped.status !== null,
      severity: "blocking",
      comparison: {
        operator: "in",
        expected: statusSources.join(" | "),
        observed: input.raw.STATUS,
        observedType: typeof input.raw.STATUS,
      },
      rule: `STATUS muss einer bestätigten Value-Map entsprechen: ${statusTargets}`,
      evidence: `STATUS=${input.raw.STATUS}; mapped=${input.mapped.status ?? "nicht zugeordnet"}`,
      safeAction: "Originalwert erhalten und keine Bedeutung erfinden.",
      resolutionProposal: input.mapped.status !== null
        ? `Bestätigte Zuordnung verwenden: ${input.raw.STATUS} → ${input.mapped.status}.`
        : `Neue Value-Map für STATUS=${input.raw.STATUS} fachlich bestätigen. Mögliche Zielwerte sind open, closed oder in_progress; die Bridge wählt keinen davon eigenmächtig.`,
    }),
    result(input, {
      id: "quantity.positive",
      sequence: 7,
      category: "data",
      field: "MENGE",
      label: "Menge erfüllt die bestätigte Fachregel",
      passed: input.checks.find(({ field }) => field === "MENGE")?.ok ?? false,
      severity: "blocking",
      comparison: {
        operator: "greater_than",
        expected: "0",
        observed: Number.isFinite(input.mapped.quantity) ? String(input.mapped.quantity) : input.raw.MENGE,
        observedType: Number.isFinite(input.mapped.quantity) ? typeof input.mapped.quantity : typeof input.raw.MENGE,
      },
      rule: "MENGE muss numerisch und größer als 0 sein",
      evidence: `source=${input.raw.MENGE}; sourceType=${typeof input.raw.MENGE}; canonical=${Number.isFinite(input.mapped.quantity) ? input.mapped.quantity : "ungültig"}; canonicalType=${Number.isFinite(input.mapped.quantity) ? typeof input.mapped.quantity : "invalid"}`,
      safeAction: "Negativen oder ungültigen Mengenwert nicht automatisch korrigieren; Quellwert bleibt erhalten.",
      resolutionProposal: "Entweder einen gültigen positiven Wert aus der Quelle übernehmen oder die Regel > 0 bewusst ändern und neu bestätigen.",
    }),
    result(input, {
      id: "date.canonical",
      sequence: 8,
      category: "data",
      field: "DATUM",
      label: "Datum ist eindeutig normalisiert und kalendergültig",
      passed: dateCheckPassed && calendarDatePassed,
      severity: "blocking",
      comparison: {
        operator: "matches",
        expected: "existierendes Kalenderdatum im Format YYYY-MM-DD",
        observed: input.mapped.orderDate,
        observedType: typeof input.mapped.orderDate,
      },
      rule: "Nach bestätigter Transformation muss ein reales Kalenderdatum in YYYY-MM-DD vorliegen",
      evidence: `source=${input.raw.DATUM}; sourceType=${typeof input.raw.DATUM}; canonical=${input.mapped.orderDate}; formatOk=${dateCheckPassed}; calendarOk=${calendarDatePassed}; canonicalType=${typeof input.mapped.orderDate}`,
      safeAction: "Unbekanntes oder unmögliches Datum nicht stillschweigend übernehmen; Quellwert bleibt erhalten.",
      resolutionProposal: dateCheckPassed && calendarDatePassed
        ? "Keine Datumsauflösung nötig."
        : "Datumsformat und tatsächliche Kalendergültigkeit an der Quelle prüfen; keinen unmöglichen Tag oder Monat automatisch korrigieren.",
    }),
  ];
}

export function evaluateBridgeConstraints(evaluation: BridgeEvaluation): ConstraintResult[] {
  return evaluateConstraintSet({
    ingress: evaluation.ingress,
    contract: evaluation.contract,
    schema: evaluation.schema,
    raw: evaluation.raw,
    mapped: evaluation.mapped,
    checks: evaluation.checks,
    valueMap: evaluation.valueMap,
  });
}

export function blockingConstraintFailures(results: ConstraintResult[]): ConstraintResult[] {
  return results
    .filter(({ passed, severity }) => !passed && severity === "blocking")
    .sort((a, b) => a.sequence - b.sequence);
}

export function decideFromConstraints(results: ConstraintResult[]): ConstraintDecision {
  const ordered = [...results].sort((a, b) => a.sequence - b.sequence);
  const blocking = ordered.filter(({ severity }) => severity === "blocking");
  const failures = blockingConstraintFailures(ordered);
  return {
    releaseAllowed: failures.length === 0,
    blockingIssues: failures.length,
    failedConstraintIds: failures.map(({ id }) => id),
    evaluatedConstraintIds: ordered.map(({ id }) => id),
    expression: blocking.map(({ id, passed }) => `${id}=${passed ? "TRUE" : "FALSE"}`).join(" AND "),
    resolutionProposals: [...new Set(failures.map(({ resolutionProposal }) => resolutionProposal))],
  };
}
