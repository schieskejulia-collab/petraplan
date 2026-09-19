export type SchemaValueType = "string" | "number" | "boolean" | "object" | "array" | "null";

export type SchemaPathRule = {
  path: string;
  expectedTypes: SchemaValueType[];
  required: boolean;
};

export type SchemaDriftCode = "MISSING_PATH" | "TYPE_CHANGED";

export type SchemaDriftIssue = {
  path: string;
  code: SchemaDriftCode;
  expected: string;
  observed: string;
  severity: "blocking";
  message: string;
};

export type SchemaDriftAssessment = {
  compatible: boolean;
  contractName: string;
  checkedPaths: string[];
  issues: SchemaDriftIssue[];
  sourcePolicy: "preserve";
  interpretationPolicy: "do_not_guess";
};

type ResolvedPath = {
  present: boolean;
  values: unknown[];
};

function valueType(value: unknown): SchemaValueType {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value as SchemaValueType;
}

function resolvePath(source: unknown, path: string): ResolvedPath {
  const segments = path.split(".");
  let values: unknown[] = [source];

  for (const segment of segments) {
    const arraySegment = segment.endsWith("[]");
    const key = arraySegment ? segment.slice(0, -2) : segment;
    const next: unknown[] = [];
    let foundAny = false;
    let foundForEveryParent = true;

    for (const current of values) {
      if (!current || typeof current !== "object" || Array.isArray(current)) {
        foundForEveryParent = false;
        continue;
      }
      const record = current as Record<string, unknown>;
      if (!Object.prototype.hasOwnProperty.call(record, key)) {
        foundForEveryParent = false;
        continue;
      }
      foundAny = true;
      const child = record[key];

      if (arraySegment) {
        if (Array.isArray(child)) next.push(...child);
        else next.push(child);
      } else {
        next.push(child);
      }
    }

    if (!foundAny || !foundForEveryParent) return { present: false, values: [] };
    values = next;

    // An empty array is a present container. Item-level rules are intentionally
    // not treated as missing when there are no items; cardinality belongs to
    // semantic/data validation, not schema drift.
    if (arraySegment && values.length === 0) return { present: true, values: [] };
  }

  return { present: true, values };
}

/**
 * Compares a foreign source snapshot with an explicit runtime schema contract.
 * It never mutates or repairs the source and never guesses renamed fields.
 */
export function assessSchemaDrift(
  source: unknown,
  contractName: string,
  rules: SchemaPathRule[],
): SchemaDriftAssessment {
  const issues: SchemaDriftIssue[] = [];

  for (const rule of rules) {
    const resolved = resolvePath(source, rule.path);

    if (!resolved.present) {
      if (rule.required) {
        issues.push({
          path: rule.path,
          code: "MISSING_PATH",
          expected: rule.expectedTypes.join(" | "),
          observed: "missing",
          severity: "blocking",
          message: `Erwarteter Quellpfad '${rule.path}' fehlt. Keine automatische Umdeutung oder Feldsuche.`,
        });
      }
      continue;
    }

    for (const value of resolved.values) {
      const observedType = valueType(value);
      if (!rule.expectedTypes.includes(observedType)) {
        issues.push({
          path: rule.path,
          code: "TYPE_CHANGED",
          expected: rule.expectedTypes.join(" | "),
          observed: observedType,
          severity: "blocking",
          message: `Quellpfad '${rule.path}' hat Typ '${observedType}', erwartet '${rule.expectedTypes.join(" | ")}'.`,
        });
      }
    }
  }

  return {
    compatible: issues.length === 0,
    contractName,
    checkedPaths: rules.map(({ path }) => path),
    issues,
    sourcePolicy: "preserve",
    interpretationPolicy: "do_not_guess",
  };
}
