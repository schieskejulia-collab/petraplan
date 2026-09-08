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

export type ConstraintResult = {
  id: string;
  category: ConstraintCategory;
  field: keyof RawRecord | null;
  label: string;
  passed: boolean;
  severity: ConstraintSeverity;
  rule: string;
  evidence: string;
  safeAction: string;
  resolutionProposal: string;
};

export type ConstraintDecision = {
  releaseAllowed: boolean;
  blockingIssues: number;
  failedConstraintIds: string[];
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

export function evaluateConstraintSet(input: ConstraintInput): ConstraintResult[] {
  const statusTargets = input.valueMap
    .filter(([field]) => field === "STATUS")
    .map(([, source, target]) => `${source} → ${target}`)
    .join(", ");
  const failedSchema = input.schema.filter(({ present, typeOk, formatOk }) => !present || !typeOk || !formatOk);

  return [
    {
      id: "transport.received",
      category: "transport",
      field: null,
      label: "Nachricht wurde sicher empfangen",
      passed: input.ingress.transportStatus === "received",
      severity: "blocking",
      rule: "Transportstatus muss received sein",
      evidence: `transport=${input.ingress.transport}; status=${input.ingress.transportStatus}; messageId=${input.ingress.messageId}`,
      safeAction: "Originalnachricht und Transportkontext unverändert festhalten.",
      resolutionProposal: input.ingress.transportStatus === "received"
        ? "Keine Transportauflösung nötig."
        : "Transportweg prüfen und erst nach bestätigtem Eingang erneut bewerten.",
    },
    {
      id: "contract.version",
      category: "contract",
      field: null,
      label: "Schnittstellenvertrag ist bestätigt",
      passed: input.ingress.contract === input.contract.name,
      severity: "blocking",
      rule: `Vertragsversion muss ${input.contract.name} entsprechen`,
      evidence: `gesendet=${input.ingress.contract}; bestätigt=${input.contract.name}`,
      safeAction: "Keine unbekannte Vertragsversion stillschweigend übernehmen.",
      resolutionProposal: input.ingress.contract === input.contract.name
        ? "Keine Vertragsauflösung nötig."
        : `Vertragsversion ${input.ingress.contract} bestätigen oder eine dokumentierte Zuordnung zu ${input.contract.name} anlegen.`,
    },
    {
      id: "contract.schema",
      category: "contract",
      field: null,
      label: "Nachricht entspricht dem bestätigten Schema",
      passed: failedSchema.length === 0,
      severity: "blocking",
      rule: "Alle Pflichtfelder müssen vorhanden sein und dem bestätigten Typ/Format entsprechen",
      evidence: failedSchema.length === 0
        ? "schemaFehler=0"
        : `schemaFehler=${failedSchema.length}; felder=${failedSchema.map(({ field }) => field).join(",")}`,
      safeAction: "Abweichende Struktur nicht stillschweigend als gültigen Vertrag behandeln.",
      resolutionProposal: failedSchema.length === 0
        ? "Keine Schemaauflösung nötig."
        : `Abweichende Felder (${failedSchema.map(({ field }) => field).join(", ")}) gegen ${input.contract.name} prüfen und Vertrag oder Nachricht eindeutig angleichen.`,
    },
    {
      id: "customer.required",
      category: "data",
      field: "KUNDEN_NR",
      label: "Kundenkennung ist vorhanden",
      passed: input.checks.find(({ field }) => field === "KUNDEN_NR")?.ok ?? false,
      severity: "blocking",
      rule: "KUNDEN_NR ist ein Pflichtfeld",
      evidence: `KUNDEN_NR=${input.raw.KUNDEN_NR || "<leer>"}`,
      safeAction: "Fehlende Kundenkennung nicht erfinden.",
      resolutionProposal: "Kundenkennung an der Quelle ergänzen oder die Pflichtregel fachlich neu bestätigen.",
    },
    {
      id: "order.demo_reference",
      category: "data",
      field: "AUFTRAGS_NR",
      label: "Auftragsnummer entspricht dem Demo-Referenzfall",
      passed: input.checks.find(({ field }) => field === "AUFTRAGS_NR")?.ok ?? false,
      severity: "warning",
      rule: "Demo-Referenz ist A-10027",
      evidence: `AUFTRAGS_NR=${input.raw.AUFTRAGS_NR}`,
      safeAction: "Abweichende Auftragsnummer dokumentieren; sie blockiert die fachliche Freigabe nicht.",
      resolutionProposal: "Nur für den Demo-Vergleich prüfen, ob die erwartete Referenz A-10027 verwendet werden sollte.",
    },
    {
      id: "status.value_map",
      category: "semantics",
      field: "STATUS",
      label: "Statuswert hat eine bestätigte Bedeutung",
      passed: input.mapped.status !== null,
      severity: "blocking",
      rule: `STATUS muss einer bestätigten Value-Map entsprechen: ${statusTargets}`,
      evidence: `STATUS=${input.raw.STATUS}; mapped=${input.mapped.status ?? "nicht zugeordnet"}`,
      safeAction: "Originalwert erhalten und keine Bedeutung erfinden.",
      resolutionProposal: input.mapped.status !== null
        ? `Bestätigte Zuordnung verwenden: ${input.raw.STATUS} → ${input.mapped.status}.`
        : `Neue Value-Map für STATUS=${input.raw.STATUS} fachlich bestätigen. Mögliche Zielwerte sind open, closed oder in_progress; die Bridge wählt keinen davon eigenmächtig.`,
    },
    {
      id: "quantity.positive",
      category: "data",
      field: "MENGE",
      label: "Menge erfüllt die bestätigte Fachregel",
      passed: input.checks.find(({ field }) => field === "MENGE")?.ok ?? false,
      severity: "blocking",
      rule: "MENGE muss numerisch und größer als 0 sein",
      evidence: `MENGE=${input.raw.MENGE}; canonical=${Number.isFinite(input.mapped.quantity) ? input.mapped.quantity : "ungültig"}`,
      safeAction: "Negativen oder ungültigen Mengenwert nicht automatisch korrigieren.",
      resolutionProposal: "Entweder einen gültigen positiven Wert aus der Quelle übernehmen oder die Regel > 0 bewusst ändern und neu bestätigen.",
    },
    {
      id: "date.canonical",
      category: "data",
      field: "DATUM",
      label: "Datum ist eindeutig normalisiert",
      passed: input.checks.find(({ field }) => field === "DATUM")?.ok ?? false,
      severity: "blocking",
      rule: "Nach bestätigter Transformation muss YYYY-MM-DD vorliegen",
      evidence: `DATUM=${input.raw.DATUM}; canonical=${input.mapped.orderDate}`,
      safeAction: "Unbekanntes Datumsformat nicht stillschweigend übernehmen.",
      resolutionProposal: "Datumsformat bestätigen oder eine eindeutige Transformationsregel hinterlegen.",
    },
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
  return results.filter(({ passed, severity }) => !passed && severity === "blocking");
}

export function decideFromConstraints(results: ConstraintResult[]): ConstraintDecision {
  const failures = blockingConstraintFailures(results);
  return {
    releaseAllowed: failures.length === 0,
    blockingIssues: failures.length,
    failedConstraintIds: failures.map(({ id }) => id),
    resolutionProposals: [...new Set(failures.map(({ resolutionProposal }) => resolutionProposal))],
  };
}
