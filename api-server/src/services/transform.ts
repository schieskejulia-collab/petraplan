const typeMapping: Record<string, string> = {
  DECIMAL: 'numeric',
  NUMERIC: 'numeric',
  INTEGER: 'integer',
  INT: 'integer',
  TIMESTAMP: 'timestamp',
  TIMESTAMPTZ: 'timestamptz',
  DATE: 'date',
  BOOLEAN: 'boolean',
  CHAR: 'text',
  VARCHAR: 'text',
  STRING: 'text',
  NUMC: 'text',
};

export function normalizeNumeric(value: unknown): number {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`Invalid numeric value: ${value}`);
    return value;
  }

  if (typeof value !== 'string') throw new Error(`Invalid numeric value: ${String(value)}`);

  const input = value.trim();
  if (!input) throw new Error('Invalid numeric value: empty string');

  const hasComma = input.includes(',');
  const hasDot = input.includes('.');

  if (hasComma && hasDot) {
    if (!/^[-+]?\d{1,3}(\.\d{3})*,\d+$/.test(input)) {
      throw new Error(`ambiguous_numeric_format: ${value}`);
    }
    const normalized = input.replace(/\./g, '').replace(',', '.');
    const result = Number(normalized);
    if (!Number.isFinite(result)) throw new Error(`Invalid numeric value: ${value}`);
    return result;
  }

  if (hasComma) {
    if (!/^[-+]?\d+,\d+$/.test(input)) {
      throw new Error(`ambiguous_numeric_format: ${value}`);
    }
    const result = Number(input.replace(',', '.'));
    if (!Number.isFinite(result)) throw new Error(`Invalid numeric value: ${value}`);
    return result;
  }

  if (hasDot && /^[-+]?\d{1,3}(\.\d{3})+$/.test(input)) {
    throw new Error(`ambiguous_numeric_format: ${value}`);
  }

  const result = Number(input);
  if (!Number.isFinite(result)) throw new Error(`Invalid numeric value: ${value}`);
  return result;
}

export function normalizeInteger(value: unknown): number {
  const result = normalizeNumeric(value);
  if (!Number.isInteger(result)) throw new Error(`Invalid integer value: ${String(value)}`);
  return result;
}

export function normalizeBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  const normalized = String(value).trim().toLowerCase();
  if (['true', '1', 'x', 'yes'].includes(normalized)) return true;
  if (['false', '0', '', 'no'].includes(normalized)) return false;
  throw new Error(`ambiguous_boolean_value: ${String(value)}`);
}

export function normalizeDate(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
    throw new Error(`Invalid date value: ${String(value)}`);
  }

  const input = value.trim();
  const date = new Date(`${input}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== input) {
    throw new Error(`Invalid date value: ${String(value)}`);
  }
  return input;
}

export function normalizeTimestamp(value: unknown, withTimezone: boolean): string {
  if (typeof value !== 'string') throw new Error(`Invalid timestamp value: ${String(value)}`);
  const input = value.trim();

  if (withTimezone) {
    if (!/(Z|[+-]\d{2}:?\d{2})$/i.test(input)) {
      throw new Error(`ambiguous_timestamp_timezone: ${value}`);
    }
    const date = new Date(input);
    if (Number.isNaN(date.getTime())) throw new Error(`Invalid timestamp value: ${value}`);
    return date.toISOString();
  }

  if (!/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d+)?$/.test(input)) {
    throw new Error(`Invalid timestamp value: ${value}`);
  }
  return input.replace(' ', 'T');
}

export function transformValue(value: unknown, legacyType?: string): unknown {
  if (value === null || value === undefined) return null;

  const targetType = typeMapping[String(legacyType ?? '').toUpperCase()];

  switch (targetType) {
    case 'numeric': return normalizeNumeric(value);
    case 'integer': return normalizeInteger(value);
    case 'boolean': return normalizeBoolean(value);
    case 'date': return normalizeDate(value);
    case 'timestamp': return normalizeTimestamp(value, false);
    case 'timestamptz': return normalizeTimestamp(value, true);
    default: return value;
  }
}

export function transformPayload(
  rawPayload: Record<string, unknown>,
  fieldMapping: Record<string, string>,
  fieldTypes: Record<string, string>,
): Record<string, unknown> {
  const mappedPayload: Record<string, unknown> = {};

  for (const [legacyField, value] of Object.entries(rawPayload)) {
    const modernField = fieldMapping[legacyField] ?? legacyField.toLowerCase();
    mappedPayload[modernField] = transformValue(value, fieldTypes[legacyField]);
  }

  return mappedPayload;
}
