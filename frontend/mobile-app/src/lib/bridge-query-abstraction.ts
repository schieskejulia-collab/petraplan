export type QueryEvidenceStatus = "confirmed" | "candidate" | "unresolved";
export type QueryDialect = "sql_standard" | "postgresql" | "mysql" | "hql" | "native";
export type QueryPlanStatus = "ready" | "needs_confirmation" | "blocked";
export type ParameterStyle = "named" | "positional";

export type CanonicalPredicate = {
  field: string;
  operator: "eq" | "neq" | "gt" | "gte" | "lt" | "lte";
  parameter: string;
};

export type CanonicalReadQuery = {
  subject: string;
  fields: string[];
  predicates: CanonicalPredicate[];
  semanticStatus: QueryEvidenceStatus;
  evidence: string[];
};

export type DialectBinding = {
  dialect: QueryDialect;
  dialectStatus: QueryEvidenceStatus;
  subjectAddress: string;
  subjectAddressStatus: QueryEvidenceStatus;
  fieldMap: Record<string, string>;
  fieldMapStatus: QueryEvidenceStatus;
  parameterStyle: ParameterStyle;
  nativeTemplate?: string;
  nativeTemplateStatus?: QueryEvidenceStatus;
  evidence: string[];
};

export type QueryTranslationPlan = {
  status: QueryPlanStatus;
  dialect: QueryDialect;
  canonicalSubject: string;
  mappedSubject: string | null;
  canonicalFields: string[];
  mappedFields: string[];
  queryText: string | null;
  parameters: string[];
  blockers: string[];
  evidence: string[];
  sourcePolicy: "preserve";
  writePolicy: "forbidden";
  semanticPolicy: "canonical_intent_is_not_derived_from_native_syntax";
  note: string;
};

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function quoteIdentifier(identifier: string, dialect: QueryDialect): string {
  if (dialect === "mysql") return `\`${identifier.replace(/`/g, "``")}\``;
  if (dialect === "postgresql" || dialect === "sql_standard") {
    return `"${identifier.replace(/"/g, '""')}"`;
  }
  return identifier;
}

function parameterToken(name: string, index: number, style: ParameterStyle): string {
  return style === "named" ? `:${name}` : `?${index + 1}`;
}

function renderGenericRead(
  query: CanonicalReadQuery,
  binding: DialectBinding,
  mappedFields: string[],
): { queryText: string; parameters: string[] } {
  const selected = mappedFields.map((field) => quoteIdentifier(field, binding.dialect)).join(", ");
  const subject = binding.dialect === "hql"
    ? binding.subjectAddress
    : quoteIdentifier(binding.subjectAddress, binding.dialect);

  const parameters: string[] = [];
  const predicates = query.predicates.map((predicate, index) => {
    const mappedField = binding.fieldMap[predicate.field];
    const token = parameterToken(predicate.parameter, index, binding.parameterStyle);
    parameters.push(predicate.parameter);
    const operators: Record<CanonicalPredicate["operator"], string> = {
      eq: "=",
      neq: "<>",
      gt: ">",
      gte: ">=",
      lt: "<",
      lte: "<=",
    };
    return `${quoteIdentifier(mappedField, binding.dialect)} ${operators[predicate.operator]} ${token}`;
  });

  const prefix = binding.dialect === "hql" ? `select ${selected} from ${subject}` : `SELECT ${selected} FROM ${subject}`;
  const where = predicates.length > 0 ? ` WHERE ${predicates.join(" AND ")}` : "";
  return { queryText: `${prefix}${where}`, parameters };
}

/**
 * Translates one confirmed canonical read intent into a concrete query dialect.
 *
 * The canonical intent is the semantic reference. Dialect/native syntax is only
 * a transport representation and never establishes business meaning. Translation
 * is blocked or held for confirmation when semantic intent, target dialect,
 * subject address, or field mappings are not confirmed. Native queries require an
 * explicitly confirmed read-only template; PetraPlan does not invent vendor syntax.
 */
export function buildQueryTranslationPlan(
  query: CanonicalReadQuery,
  binding: DialectBinding,
): QueryTranslationPlan {
  const canonicalFields = unique(query.fields);
  const blockers: string[] = [];

  if (query.semanticStatus !== "confirmed") {
    blockers.push("Die fachliche Query-Absicht ist nicht bestätigt.");
  }
  if (binding.dialectStatus !== "confirmed") {
    blockers.push("Der technische Query-Dialekt ist nicht bestätigt.");
  }
  if (!binding.subjectAddress.trim() || binding.subjectAddressStatus !== "confirmed") {
    blockers.push("Die technische Zieladresse des Query-Subjekts ist nicht bestätigt.");
  }
  if (binding.fieldMapStatus !== "confirmed") {
    blockers.push("Das Field-Mapping für die Query-Übersetzung ist nicht bestätigt.");
  }

  const requiredCanonicalFields = unique([
    ...canonicalFields,
    ...query.predicates.map(({ field }) => field),
  ]);
  const missingMappings = requiredCanonicalFields.filter((field) => !binding.fieldMap[field]?.trim());
  if (missingMappings.length > 0) {
    blockers.push(`Für folgende kanonische Felder fehlt ein bestätigtes technisches Mapping: ${missingMappings.join(", ")}.`);
  }

  const mappedFields = canonicalFields
    .map((field) => binding.fieldMap[field]?.trim() || "")
    .filter(Boolean);

  const hardBlocked = !binding.subjectAddress.trim() || canonicalFields.length === 0;
  let status: QueryPlanStatus = hardBlocked ? "blocked" : blockers.length > 0 ? "needs_confirmation" : "ready";
  let queryText: string | null = null;
  let parameters: string[] = [];

  if (binding.dialect === "native") {
    const nativeTemplate = binding.nativeTemplate?.trim() || "";
    if (!nativeTemplate || binding.nativeTemplateStatus !== "confirmed") {
      blockers.push("Native Syntax wird nur mit einem explizit bestätigten read-only Template verwendet.");
      status = hardBlocked ? "blocked" : "needs_confirmation";
    } else if (status === "ready") {
      queryText = nativeTemplate;
      parameters = unique(query.predicates.map(({ parameter }) => parameter));
    }
  } else if (status === "ready") {
    const rendered = renderGenericRead(query, binding, mappedFields);
    queryText = rendered.queryText;
    parameters = rendered.parameters;
  }

  return {
    status,
    dialect: binding.dialect,
    canonicalSubject: query.subject,
    mappedSubject: binding.subjectAddress.trim() || null,
    canonicalFields,
    mappedFields,
    queryText,
    parameters,
    blockers,
    evidence: [...query.evidence, ...binding.evidence],
    sourcePolicy: "preserve",
    writePolicy: "forbidden",
    semanticPolicy: "canonical_intent_is_not_derived_from_native_syntax",
    note: status === "ready"
      ? "Die bestätigte fachliche Leseabsicht wurde in eine technische Query-Repräsentation übersetzt. Die technische Syntax bleibt Transport und wird nicht als fachliche Wahrheit behandelt."
      : status === "needs_confirmation"
        ? "Die fachliche Leseabsicht ist vorhanden, aber mindestens ein technischer Übersetzungsbaustein braucht noch Bestätigung. Es wird keine Query auf Verdacht erzeugt."
        : "Ohne eindeutig adressierbares Ziel und angeforderte Felder wird keine technische Query erzeugt.",
  };
}
