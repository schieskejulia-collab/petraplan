export type IssueSeverity = 'INFO' | 'WARNING' | 'BLOCKING';

export type FieldType = 'string' | 'decimal' | 'date';

export type FieldRule = {
  type: FieldType;
  semanticRole: string;
  required?: boolean;
  allowedValues?: readonly unknown[];
  min?: number;
  format?: string;
};

export type MappingEngineConfig = {
  schema: Record<string, FieldRule>;
  semantics: {
    fields: Record<string, string>;
    values?: Record<string, Record<string, string>>;
  };
  fieldMap: Record<string, string>;
  valueMap?: Record<string, Record<string, unknown>>;
  missingMap?: Record<string, readonly unknown[]>;
};

export type ValidationIssue = {
  field: string;
  canonicalField?: string;
  issueType: string;
  severity: IssueSeverity;
  sourceValue: unknown;
  rule: string;
  message: string;
};

export type TraceEntry = {
  sourceField: string;
  sourceValue: unknown;
  sourceMeaning?: string;
  canonicalField?: string;
  canonicalValue: unknown;
  validation: 'PASS' | 'FAIL';
  issueTypes?: string[];
};

export type MappingResult = {
  sourceSnapshot: {
    sourceSystem: string;
    recordId?: string;
    capturedAt: string;
    readOnly: true;
    raw: Record<string, unknown>;
  };
  canonical: Record<string, unknown>;
  validation: {
    valid: boolean;
    releaseAllowed: boolean;
    issues: ValidationIssue[];
  };
  trace: TraceEntry[];
};

export const bridgeV01Config: MappingEngineConfig = {
  schema: {
    KNR: {
      type: 'string',
      semanticRole: 'identifier',
      required: true,
    },
    STAT: {
      type: 'string',
      semanticRole: 'status',
      required: true,
      allowedValues: ['F', 'O', 'G'],
    },
    BETR: {
      type: 'decimal',
      semanticRole: 'money',
      required: true,
      min: 0,
    },
    DATUM: {
      type: 'date',
      semanticRole: 'date',
      required: true,
      format: 'DD.MM.YYYY',
    },
  },
  semantics: {
    fields: {
      KNR: 'Kundennummer',
      STAT: 'Auftragsstatus',
      BETR: 'Auftragsbetrag',
      DATUM: 'Auftragsdatum',
    },
    values: {
      STAT: {
        F: 'freigegeben',
        O: 'offen',
        G: 'gesperrt',
      },
    },
  },
  fieldMap: {
    KNR: 'customerId',
    STAT: 'status',
    BETR: 'amount',
    DATUM: 'orderDate',
  },
  valueMap: {
    STAT: {
      F: 'approved',
      O: 'open',
      G: 'blocked',
    },
  },
  missingMap: {
    KNR: [null, ''],
    STAT: [null, ''],
    BETR: [null, ''],
    DATUM: [null, ''],
  },
};

function valuesEqual(left: unknown, right: unknown): boolean {
  return Object.is(left, right);
}

function isMissingValue(
  sourceField: string,
  sourceValue: unknown,
  config: MappingEngineConfig,
): boolean {
  if (sourceValue === undefined) {
    return true;
  }

  return (config.missingMap?.[sourceField] ?? []).some((missingValue) =>
    valuesEqual(missingValue, sourceValue),
  );
}

function normalizeGermanDate(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const match = value.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (!match) {
    return null;
  }

  const [, dayText, monthText, yearText] = match;
  const day = Number(dayText);
  const month = Number(monthText);
  const year = Number(yearText);
  const date = new Date(Date.UTC(year, month - 1, day));

  const isValid =
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day;

  if (!isValid) {
    return null;
  }

  return `${yearText}-${monthText}-${dayText}`;
}

function sourceMeaningFor(
  sourceField: string,
  sourceValue: unknown,
  config: MappingEngineConfig,
): string | undefined {
  const valueMeaning =
    config.semantics.values?.[sourceField]?.[String(sourceValue)];

  return valueMeaning ?? config.semantics.fields[sourceField];
}

function issuesForField(
  sourceField: string,
  issues: readonly ValidationIssue[],
): ValidationIssue[] {
  return issues.filter((issue) => issue.field === sourceField);
}

export function processRecord(
  raw: Readonly<Record<string, unknown>>,
  options: {
    sourceSystem?: string;
    recordId?: string;
    capturedAt?: string;
    config?: MappingEngineConfig;
  } = {},
): MappingResult {
  const config = options.config ?? bridgeV01Config;
  const sourceSystem = options.sourceSystem ?? 'System_A';
  const issues: ValidationIssue[] = [];
  const trace: TraceEntry[] = [];
  const canonical: Record<string, unknown> = {};

  const snapshot = {
    sourceSystem,
    ...(options.recordId ? { recordId: options.recordId } : {}),
    capturedAt: options.capturedAt ?? new Date().toISOString(),
    readOnly: true as const,
    raw: structuredClone(raw) as Record<string, unknown>,
  };

  for (const [sourceField, rules] of Object.entries(config.schema)) {
    const sourceValue = raw[sourceField];
    const canonicalField = config.fieldMap[sourceField];
    const fieldIssuesBefore = issues.length;

    if (!canonicalField) {
      issues.push({
        field: sourceField,
        issueType: 'MISSING_FIELD_MAPPING',
        severity: 'BLOCKING',
        sourceValue,
        rule: 'fieldMap must define a canonical field',
        message: `Für ${sourceField} ist kein bestätigtes Feld-Mapping vorhanden.`,
      });
    }

    if (isMissingValue(sourceField, sourceValue, config)) {
      if (rules.required) {
        issues.push({
          field: sourceField,
          canonicalField,
          issueType: 'MISSING_REQUIRED_VALUE',
          severity: 'BLOCKING',
          sourceValue,
          rule: 'required = true',
          message: `${sourceField} ist ein Pflichtfeld, aber kein Wert wurde geliefert.`,
        });
      }

      const fieldIssues = issuesForField(sourceField, issues);
      trace.push({
        sourceField,
        sourceValue,
        sourceMeaning: config.semantics.fields[sourceField],
        canonicalField,
        canonicalValue: null,
        validation: fieldIssues.some((issue) => issue.severity === 'BLOCKING')
          ? 'FAIL'
          : 'PASS',
        ...(fieldIssues.length
          ? { issueTypes: fieldIssues.map((issue) => issue.issueType) }
          : {}),
      });
      continue;
    }

    let canonicalValue: unknown = sourceValue;

    if (rules.type === 'string' && typeof sourceValue !== 'string') {
      issues.push({
        field: sourceField,
        canonicalField,
        issueType: 'INVALID_TYPE',
        severity: 'BLOCKING',
        sourceValue,
        rule: 'type = string',
        message: `${sourceField} konnte nicht als Textwert gelesen werden.`,
      });
    }

    if (
      rules.allowedValues &&
      !rules.allowedValues.some((allowedValue) =>
        valuesEqual(allowedValue, sourceValue),
      )
    ) {
      issues.push({
        field: sourceField,
        canonicalField,
        issueType: 'UNKNOWN_VALUE',
        severity: 'BLOCKING',
        sourceValue,
        rule: `allowedValues = ${rules.allowedValues.join(', ')}`,
        message: `Für ${sourceField} ist der Wert ${String(sourceValue)} nicht bestätigt.`,
      });
    }

    if (rules.type === 'decimal') {
      const parsed =
        typeof sourceValue === 'number' ? sourceValue : Number(sourceValue);

      if (!Number.isFinite(parsed)) {
        issues.push({
          field: sourceField,
          canonicalField,
          issueType: 'INVALID_TYPE',
          severity: 'BLOCKING',
          sourceValue,
          rule: 'type = decimal',
          message: `${sourceField} konnte nicht als Dezimalzahl gelesen werden.`,
        });
        canonicalValue = null;
      } else {
        canonicalValue = parsed;

        if (rules.min !== undefined && parsed < rules.min) {
          issues.push({
            field: sourceField,
            canonicalField,
            issueType: 'NEGATIVE_VALUE',
            severity: 'BLOCKING',
            sourceValue,
            rule: `min >= ${rules.min}`,
            message: `${sourceField} unterschreitet den erlaubten Mindestwert.`,
          });
        }
      }
    }

    if (rules.type === 'date') {
      const normalized = normalizeGermanDate(sourceValue);

      if (!normalized) {
        issues.push({
          field: sourceField,
          canonicalField,
          issueType: 'INVALID_DATE',
          severity: 'BLOCKING',
          sourceValue,
          rule: `format = ${rules.format ?? 'DD.MM.YYYY'}`,
          message: `${sourceField} entspricht keinem gültigen Datum im erwarteten Format.`,
        });
        canonicalValue = null;
      } else {
        canonicalValue = normalized;
      }
    }

    const valueMap = config.valueMap?.[sourceField];
    if (
      valueMap &&
      Object.prototype.hasOwnProperty.call(valueMap, String(sourceValue))
    ) {
      canonicalValue = valueMap[String(sourceValue)];
    }

    const fieldIssues = issues.slice(fieldIssuesBefore);
    const hasBlockingIssue = fieldIssues.some(
      (issue) => issue.field === sourceField && issue.severity === 'BLOCKING',
    );

    if (canonicalField && !hasBlockingIssue) {
      canonical[canonicalField] = canonicalValue;
    }

    const relevantIssues = issuesForField(sourceField, issues);
    trace.push({
      sourceField,
      sourceValue,
      sourceMeaning: sourceMeaningFor(sourceField, sourceValue, config),
      canonicalField,
      canonicalValue: hasBlockingIssue ? null : canonicalValue,
      validation: hasBlockingIssue ? 'FAIL' : 'PASS',
      ...(relevantIssues.length
        ? { issueTypes: relevantIssues.map((issue) => issue.issueType) }
        : {}),
    });
  }

  const blockingIssues = issues.filter(
    (issue) => issue.severity === 'BLOCKING',
  );

  return {
    sourceSnapshot: snapshot,
    canonical,
    validation: {
      valid: blockingIssues.length === 0,
      releaseAllowed: blockingIssues.length === 0,
      issues,
    },
    trace,
  };
}
