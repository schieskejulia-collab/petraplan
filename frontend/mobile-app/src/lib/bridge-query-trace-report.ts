import type {
  CanonicalReadQuery,
  DialectBinding,
  QueryTranslationPlan,
} from "./bridge-query-abstraction";
import type { QueryReadGateDecision } from "./bridge-query-read-gate";
import type { ReadAccessDecision } from "./bridge-read-access-decision";

export type QueryTraceStep = {
  step: "canonical_intent" | "mapping" | "dialect" | "read_access" | "execution_gate";
  status: "confirmed" | "needs_confirmation" | "blocked" | "refresh_required";
  summary: string;
  evidence: string[];
};

export type QueryTraceReport = {
  canonicalIntent: {
    subject: string;
    fields: string[];
    predicates: string[];
    semanticStatus: CanonicalReadQuery["semanticStatus"];
  };
  translation: {
    status: QueryTranslationPlan["status"];
    dialect: QueryTranslationPlan["dialect"];
    mappedSubject: string | null;
    fieldMappings: string[];
    translatedRepresentation: string | null;
    parameterNames: string[];
  };
  access: {
    status: ReadAccessDecision["status"];
    readAllowed: boolean;
    refreshRequired: boolean;
  };
  execution: {
    status: QueryReadGateDecision["status"];
    executable: boolean;
    releasedQueryText: string | null;
  };
  trace: QueryTraceStep[];
  blockers: string[];
  evidence: string[];
  sourcePolicy: "preserve";
  writePolicy: "forbidden";
  reportPolicy: "explain_query_without_inventing_semantics";
  conclusion: string;
};

function predicateLabel(predicate: CanonicalReadQuery["predicates"][number]): string {
  return `${predicate.field} ${predicate.operator} :${predicate.parameter}`;
}

function statusFromQueryPlan(status: QueryTranslationPlan["status"]): QueryTraceStep["status"] {
  if (status === "ready") return "confirmed";
  if (status === "blocked") return "blocked";
  return "needs_confirmation";
}

/**
 * Builds a human-readable, evidence-preserving report for one query decision.
 *
 * The report keeps the canonical business read intent separate from technical
 * mapping/dialect representation and from the final execution gate. A translated
 * query may therefore appear in the trace as a known representation while still
 * being explicitly marked as not released for execution (for example when a
 * snapshot refresh is required). Parameter names are reported, never parameter
 * values. The report has no release authority and never writes to the source.
 */
export function buildQueryTraceReport(input: {
  canonicalQuery: CanonicalReadQuery;
  binding: DialectBinding;
  queryPlan: QueryTranslationPlan;
  readAccess: ReadAccessDecision;
  queryGate: QueryReadGateDecision;
}): QueryTraceReport {
  const { canonicalQuery, binding, queryPlan, readAccess, queryGate } = input;

  const fieldMappings = [...new Set([
    ...canonicalQuery.fields,
    ...canonicalQuery.predicates.map(({ field }) => field),
  ])].map((field) => {
    const mapped = binding.fieldMap[field]?.trim();
    return `${field} -> ${mapped || "<unbestaetigt>"}`;
  });

  const blockers = [...new Set([
    ...queryPlan.blockers,
    ...readAccess.blockers,
    ...queryGate.blockers,
  ])];

  const evidence = [...new Set([
    ...canonicalQuery.evidence,
    ...binding.evidence,
    ...queryPlan.evidence,
    ...readAccess.evidence,
    ...queryGate.evidence,
  ])];

  const trace: QueryTraceStep[] = [
    {
      step: "canonical_intent",
      status: canonicalQuery.semanticStatus === "confirmed" ? "confirmed" : "needs_confirmation",
      summary: `Fachliche Leseabsicht: ${canonicalQuery.subject}; Felder=${canonicalQuery.fields.join(", ") || "<keine>"}; Filter=${canonicalQuery.predicates.map(predicateLabel).join(" AND ") || "<keine>"}.`,
      evidence: [...canonicalQuery.evidence],
    },
    {
      step: "mapping",
      status: binding.fieldMapStatus === "confirmed" && binding.subjectAddressStatus === "confirmed"
        ? "confirmed"
        : "needs_confirmation",
      summary: `Technisches Ziel=${binding.subjectAddress || "<unbestaetigt>"}; Mapping=${fieldMappings.join("; ")}.`,
      evidence: [...binding.evidence],
    },
    {
      step: "dialect",
      status: statusFromQueryPlan(queryPlan.status),
      summary: `Dialekt=${queryPlan.dialect}; Uebersetzung=${queryPlan.status}; technische Repraesentation=${queryPlan.queryText ?? "<nicht erzeugt>"}.`,
      evidence: [...queryPlan.evidence],
    },
    {
      step: "read_access",
      status: readAccess.status === "ready"
        ? "confirmed"
        : readAccess.status,
      summary: `Read-Access=${readAccess.status}; readAllowed=${readAccess.readAllowed}; refreshRequired=${readAccess.refreshRequired}.`,
      evidence: [...readAccess.evidence],
    },
    {
      step: "execution_gate",
      status: queryGate.status === "ready"
        ? "confirmed"
        : queryGate.status,
      summary: queryGate.executable
        ? "Die technische Query wurde fuer read-only Nutzung freigegeben."
        : "Die technische Query wurde nicht zur Ausfuehrung freigegeben.",
      evidence: [...queryGate.evidence],
    },
  ];

  const conclusion = queryGate.executable
    ? `Freigegeben: Die bestaetigte fachliche Leseabsicht wurde ueber ${queryPlan.dialect} mit bestaetigtem Mapping in eine read-only Query uebersetzt und hat den Read-Access-Gate passiert.`
    : queryGate.status === "refresh_required"
      ? "Nicht freigegeben: Mapping und Dialekt koennen bereits bekannt sein, aber der Lesestand muss zuerst ueber den bestaetigten read-only Pfad aktualisiert werden."
      : queryGate.status === "needs_confirmation"
        ? "Nicht freigegeben: Mindestens ein Beleg fuer Lesezugriff, fachliche Absicht, Mapping oder Dialekt fehlt noch."
        : "Blockiert: Quelle, Lesepfad oder Query-Uebersetzung erlaubt keine sichere read-only Nutzung.";

  return {
    canonicalIntent: {
      subject: canonicalQuery.subject,
      fields: [...canonicalQuery.fields],
      predicates: canonicalQuery.predicates.map(predicateLabel),
      semanticStatus: canonicalQuery.semanticStatus,
    },
    translation: {
      status: queryPlan.status,
      dialect: queryPlan.dialect,
      mappedSubject: queryPlan.mappedSubject,
      fieldMappings,
      translatedRepresentation: queryPlan.queryText,
      parameterNames: [...queryPlan.parameters],
    },
    access: {
      status: readAccess.status,
      readAllowed: readAccess.readAllowed,
      refreshRequired: readAccess.refreshRequired,
    },
    execution: {
      status: queryGate.status,
      executable: queryGate.executable,
      releasedQueryText: queryGate.executableQueryText,
    },
    trace,
    blockers,
    evidence,
    sourcePolicy: "preserve",
    writePolicy: "forbidden",
    reportPolicy: "explain_query_without_inventing_semantics",
    conclusion,
  };
}
