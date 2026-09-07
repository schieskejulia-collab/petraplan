import type {
  BridgeConfig,
  CanonicalRecord,
  EntknotungsReport,
  Issue,
  Primitive,
  RawRecord,
  Snapshot,
  TraceEntry,
} from './entknotungsModel.js';

function isMissing(field: string, value: Primitive, config: BridgeConfig): boolean {
  const rule = config.missing.find((item) => item.sourceField === field);
  return Boolean(rule?.missingValues.some((candidate) => candidate === value));
}

function validateSchema(record: RawRecord, config: BridgeConfig): Issue[] {
  const issues: Issue[] = [];

  for (const rule of config.schema) {
    const exists = Object.prototype.hasOwnProperty.call(record.values, rule.sourceField);
    const value = record.values[rule.sourceField] ?? null;

    if (!exists && rule.required) {
      issues.push({
        field: rule.sourceField,
        issue: 'MISSING_FIELD',
        severity: 'BLOCKING',
        sourceValue: null,
        message: `Pflichtfeld ${rule.sourceField} fehlt.`,
      });
      continue;
    }

    if (!exists || isMissing(rule.sourceField, value, config)) continue;

    if (rule.expectedType && rule.expectedType !== 'date') {
      if (value === null || typeof value !== rule.expectedType) {
        issues.push({
          field: rule.sourceField,
          issue: 'WRONG_TYPE',
          severity: 'BLOCKING',
          sourceValue: value,
          message: `Feld ${rule.sourceField} hat nicht den erwarteten Datentyp ${rule.expectedType}.`,
        });
      }
    }

    if (rule.expectedFormat && typeof value === 'string' && !rule.expectedFormat.test(value)) {
      issues.push({
        field: rule.sourceField,
        issue: 'WRONG_FORMAT',
        severity: 'BLOCKING',
        sourceValue: value,
        message: `Feld ${rule.sourceField} entspricht nicht dem erwarteten Format.`,
      });
    }
  }

  return issues;
}

function mapToCanonical(record: RawRecord, config: BridgeConfig): {
  canonical: CanonicalRecord;
  trace: TraceEntry[];
} {
  const values: Record<string, Primitive> = {};
  const trace: TraceEntry[] = [];

  for (const mapping of config.fieldMap) {
    const sourceValue = record.values[mapping.sourceField] ?? null;
    const valueRule = config.valueMap.find(
      (rule) => rule.sourceField === mapping.sourceField && rule.sourceValue === sourceValue,
    );
    const mappedValue = valueRule ? valueRule.canonicalValue : sourceValue;
    const transformRule = config.transforms.find(
      (rule) => rule.sourceField === mapping.sourceField && rule.canonicalField === mapping.canonicalField,
    );
    const transformedValue = transformRule ? transformRule.transform(mappedValue) : mappedValue;

    values[mapping.canonicalField] = transformedValue;
    trace.push({
      sourceField: mapping.sourceField,
      sourceValue,
      meaning: valueRule?.meaning ?? mapping.meaning,
      canonicalField: mapping.canonicalField,
      mappedValue,
      transformedValue,
      canonicalValue: transformedValue,
      validation: 'NOT_CHECKED',
    });
  }

  return {
    canonical: { source: record.meta, values },
    trace,
  };
}

function runValidation(
  canonical: CanonicalRecord,
  trace: TraceEntry[],
  config: BridgeConfig,
): Issue[] {
  const issues: Issue[] = [];

  for (const rule of config.validation) {
    const value = canonical.values[rule.field] ?? null;
    const valid = rule.validate(value, canonical);
    const traceEntry = trace.find((item) => item.canonicalField === rule.field);
    if (traceEntry) traceEntry.validation = valid ? 'VALID' : 'INVALID';

    if (!valid) {
      issues.push({
        field: rule.field,
        issue: rule.code,
        severity: rule.severity,
        sourceValue: value,
        message: rule.message,
      });
    }
  }

  return issues;
}

export function runEntknotungsCheck(record: RawRecord, config: BridgeConfig): EntknotungsReport {
  // 1 SOURCE EMPFANGEN + 2 SNAPSHOT ERZEUGEN
  const snapshot: Snapshot = {
    meta: { ...record.meta },
    values: structuredClone(record.values),
    snapshotAt: new Date().toISOString(),
  };

  // 3 SCHEMA PRÜFEN + 4 MISSING-REGEL PRÜFEN
  const schemaIssues = validateSchema(record, config);

  // 5 SEMANTIK + 6 FIELD MAP + 7 VALUE MAP + 8 TRANSFORMATION + 9 CANONICAL MODEL
  const { canonical, trace } = mapToCanonical(record, config);

  // 10 VALIDIEREN + 11 ISSUE ERZEUGEN + 12 TRACE ERZEUGEN
  const validationIssues = runValidation(canonical, trace, config);
  const issues = [...schemaIssues, ...validationIssues];

  // 13 FREIGABE ENTSCHEIDEN
  const releaseAllowed = !issues.some((issue) => issue.severity === 'BLOCKING');

  // 14 REPORT ERZEUGEN
  return {
    snapshot,
    canonical,
    trace,
    validation: {
      valid: issues.length === 0,
      releaseAllowed,
      issues,
    },
    nextStep: releaseAllowed
      ? 'Freigabe möglich. Ergebnis und Trace prüfen.'
      : 'Freigabe blockiert. BLOCKING-Issues klären und erneut prüfen.',
  };
}
