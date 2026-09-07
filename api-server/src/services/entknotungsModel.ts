export type Severity = 'INFO' | 'WARNING' | 'BLOCKING';
export type Primitive = string | number | boolean | null;

export interface SourceMeta {
  source: string;
  recordId: string;
  receivedAt: string;
}

export interface RawRecord {
  meta: SourceMeta;
  values: Record<string, Primitive>;
}

export interface Snapshot extends RawRecord {
  snapshotAt: string;
}

export interface SchemaRule {
  sourceField: string;
  required?: boolean;
  expectedType?: 'string' | 'number' | 'boolean' | 'date';
  expectedFormat?: RegExp;
}

export interface MissingRule {
  sourceField: string;
  missingValues: Primitive[];
}

export interface FieldMapRule {
  sourceField: string;
  canonicalField: string;
  meaning: string;
}

export interface ValueMapRule {
  sourceField: string;
  sourceValue: Primitive;
  canonicalValue: Primitive;
  meaning: string;
}

export interface TransformRule {
  sourceField: string;
  canonicalField: string;
  transform: (value: Primitive) => Primitive;
  description: string;
}

export interface ValidationRule {
  field: string;
  code: string;
  severity: Severity;
  validate: (value: Primitive, record: CanonicalRecord) => boolean;
  message: string;
}

export interface CanonicalRecord {
  source: SourceMeta;
  values: Record<string, Primitive>;
}

export interface Issue {
  field: string;
  issue: string;
  severity: Severity;
  sourceValue: Primitive;
  message: string;
}

export interface TraceEntry {
  sourceField: string;
  sourceValue: Primitive;
  meaning?: string;
  canonicalField?: string;
  mappedValue?: Primitive;
  transformedValue?: Primitive;
  canonicalValue?: Primitive;
  validation: 'NOT_CHECKED' | 'VALID' | 'INVALID';
}

export interface ValidationResult {
  valid: boolean;
  releaseAllowed: boolean;
  issues: Issue[];
}

export interface EntknotungsReport {
  snapshot: Snapshot;
  canonical: CanonicalRecord;
  trace: TraceEntry[];
  validation: ValidationResult;
  nextStep: string;
}

export interface BridgeConfig {
  schema: SchemaRule[];
  missing: MissingRule[];
  fieldMap: FieldMapRule[];
  valueMap: ValueMapRule[];
  transforms: TransformRule[];
  validation: ValidationRule[];
}
