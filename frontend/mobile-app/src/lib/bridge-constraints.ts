import type { BridgeEvaluation, RawRecord } from "./bridge-pipeline";

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

export function evaluateBridgeConstraints(evaluation: BridgeEvaluation): ConstraintResult[] {
  const statusTargets = evaluation.valueMap
    .filter(([field]) => field === "STATUS")
    .map(([, source, target]) => `${source} → ${target}`)
    .join(", ");

  return [
    {
      id: "transport.received",
      category: "transport",
      field: null,
      label: "Nachricht wurde sicher empfangen",
      passed: evaluation.ingress.transportStatus === "received",
      severity: "blocking",
      rule: "Transportstatus muss received sein",
      evidence: `transport=${evaluation.ingress.transport}; status=${evaluation.ingress.transportStatus}; messageId=${evaluation.ingress.messageId}`,
      safeAction: "Originalnachricht und Transportkontext unverändert festhalten.",
      resolutionProposal: evaluation.ingress.transportStatus === "received"
        ? "Keine Transportauflösung nötig."
        : "Transportweg prüfen und erst nach bestätigtem Eingang erneut bewerten.",
    },
    {
      id: "contract.confirmed",
      category: "contract",
      field: null,
      label: "Schnittstellenvertrag ist bestätigt",
      passed: evaluation.ingress.contract === evaluation.contract.name && evaluation.schema.every(({ present, typeOk, formatOk }) => present && typeOk && formatOk),
      severity: "blocking",
      rule: `Vertrag muss ${evaluation.contract.name} entsprechen und alle Felder müssen Schema/Format erfüllen`,
      evidence: `gesendet=${evaluation.ingress.contract}; bestätigt=${evaluation.contract.name}; schemaFehler=${evaluation.schema.filter(({ present, typeOk, formatOk }) => !present || !typeOk || !formatOk).length}`,
      safeAction: "Keine unbekannte Vertragsversion stillschweigend übernehmen.",
      resolutionProposal: evaluation.ingress.contract === evaluation.contract.name
        ? "Abweichende Felder gezielt gegen den bestätigten Vertrag prüfen."
        : `Vertragsversion ${evaluation.ingress.contract} bestätigen oder eine dokumentierte Zuordnung zu ${evaluation.contract.name} anlegen.`,
    },
    {
      id: "customer.required",
      category: "data",
      field: "KUNDEN_NR",
      label: "Kundenkennung ist vorhanden",
      passed: evaluation.checks.find(({ field }) => field === "KUNDEN_NR")?.ok ?? false,
      severity: "blocking",
      rule: "KUNDEN_NR ist ein Pflichtfeld",
      evidence: `KUNDEN_NR=${evaluation.raw.KUNDEN_NR || "<leer>"}`,
      safeAction: "Fehlende Kundenkennung nicht erfinden.",
      resolutionProposal: "Kundenkennung an der Quelle ergänzen oder die Pflichtregel fachlich neu bestätigen.",
    },
    {
      id: "status.value_map",
      category: "semantics",
      field: "STATUS",
      label: "Statuswert hat eine bestätigte Bedeutung",
      passed: evaluation.mapped.status !== null,
      severity: "blocking",
      rule: `STATUS muss einer bestätigten Value-Map entsprechen: ${statusTargets}`,
      evidence: `STATUS=${evaluation.raw.STATUS}; mapped=${evaluation.mapped.status ?? "nicht zugeordnet"}`,
      safeAction: "Originalwert erhalten und keine Bedeutung erfinden.",
      resolutionProposal: evaluation.mapped.status !== null
        ? `Bestätigte Zuordnung verwenden: ${evaluation.raw.STATUS} → ${evaluation.mapped.status}.`
        : `Neue Value-Map für STATUS=${evaluation.raw.STATUS} fachlich bestätigen. Mögliche Zielwerte sind open, closed oder in_progress; die Bridge wählt keinen davon eigenmächtig.`,
    },
    {
      id: "quantity.positive",
      category: "data",
      field: "MENGE",
      label: "Menge erfüllt die bestätigte Fachregel",
      passed: evaluation.checks.find(({ field }) => field === "MENGE")?.ok ?? false,
      severity: "blocking",
      rule: "MENGE muss numerisch und größer als 0 sein",
      evidence: `MENGE=${evaluation.raw.MENGE}; canonical=${Number.isFinite(evaluation.mapped.quantity) ? evaluation.mapped.quantity : "ungültig"}`,
      safeAction: "Negativen oder ungültigen Mengenwert nicht automatisch korrigieren.",
      resolutionProposal: "Entweder einen gültigen positiven Wert aus der Quelle übernehmen oder die Regel > 0 bewusst ändern und neu bestätigen.",
    },
    {
      id: "date.canonical",
      category: "data",
      field: "DATUM",
      label: "Datum ist eindeutig normalisiert",
      passed: evaluation.checks.find(({ field }) => field === "DATUM")?.ok ?? false,
      severity: "blocking",
      rule: "Nach bestätigter Transformation muss YYYY-MM-DD vorliegen",
      evidence: `DATUM=${evaluation.raw.DATUM}; canonical=${evaluation.mapped.orderDate}`,
      safeAction: "Unbekanntes Datumsformat nicht stillschweigend übernehmen.",
      resolutionProposal: "Datumsformat bestätigen oder eine eindeutige Transformationsregel hinterlegen.",
    },
  ];
}

export function blockingConstraintFailures(results: ConstraintResult[]): ConstraintResult[] {
  return results.filter(({ passed, severity }) => !passed && severity === "blocking");
}
