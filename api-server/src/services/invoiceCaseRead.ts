type ObjectValue = Record<string, unknown>;

export interface InvoiceCaseSnapshot {
  snapshotId: string;
  validationId: string;
  createdAt: string;
  current: boolean;
  syntax: string | null;
  number: string | null;
  payable: { value: string; currency: string | null; path: string } | null;
  exception?: {
    requestId: string; requestedBy: string; reason: string; evidenceReference: string; purpose: string;
    status: "PENDING" | "APPROVED" | "REJECTED";
    decisionReason: string | null; decidedBy: string | null; validationId: string | null;
    usable: boolean;
  };
  pdfComparison: { status: string; sha256: string; candidates: Array<{ page: number; amount: string | null }> } | null;
  proof: {
    engine: string | null;
    scenario: string | null;
    accepted: boolean;
    validatorDecision: string | null;
    reportContractStatus: string | null;
    executionFailed: boolean;
    sourceSha256: string;
    reportSha256: string;
    messages: Array<{ code: string | null; level: string | null; text: string | null }>;
  } | null;
}

function object(value: unknown): ObjectValue | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as ObjectValue : undefined;
}

function string(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function observed(fields: ObjectValue | undefined, term: string) {
  const field = object(fields?.[term]);
  return field?.status === 'observed' && Array.isArray(field.values) && field.values.length === 1
    ? object(field.values[0])
    : undefined;
}

export function buildInvoiceCaseSnapshots(
  entries: ObjectValue[],
  currentSnapshotId: string | null,
  validations: ObjectValue[],
): InvoiceCaseSnapshot[] {
  const validationById = new Map(validations.map(validation => [validation.id, validation]));
  return entries.map(entry => {
    const snapshotId = String(entry.snapshot_id);
    const validationId = String(entry.validation_id);
    const ingestion = object(entry.ingestion);
    const schema = object(ingestion?.extracted_schema);
    const result = schema?.contract === 'en16931-invoice-v1' ? schema : undefined;
    const fields = object(result?.fields);
    const payable = observed(fields, 'BT-115');
    const amount = string(payable?.original);
    const path = string(payable?.path);
    const technical = object(result?.technicalEvidence);
    const validationEvidence = object(validationById.get(validationId)?.evidence);
    const sourceSha256 = string(ingestion?.source_hash);
    const reportSha256 = string(technical?.reportSha256);
    const proof = technical && sourceSha256 && reportSha256
      && validationEvidence?.source_snapshot_id === snapshotId
      && validationEvidence.source_hash === sourceSha256
      && validationEvidence.report_sha256 === reportSha256
      && technical.invoiceSha256 === sourceSha256
      && result?.sourceSha256 === sourceSha256
      ? {
          engine: string(technical.engine),
          scenario: string(technical.scenario),
          accepted: technical.accepted === true,
          validatorDecision: string(technical.validatorDecision),
          reportContractStatus: string(object(technical.reportContract)?.status),
          executionFailed: technical.executionFailed === true,
          sourceSha256,
          reportSha256,
          messages: (Array.isArray(technical.messages) ? technical.messages : []).flatMap(message => {
            const row = object(message);
            return row ? [{ code: string(row.code), level: string(row.level), text: string(row.text) }] : [];
          }),
        }
      : null;
    const comparison = object(result?.pdfComparison);
    const comparisonStatus = string(comparison?.status);
    const pdfSha256 = string(comparison?.pdfSha256);
    const pdfComparison = comparisonStatus && pdfSha256 && Array.isArray(comparison?.candidates) ? {
      sha256: pdfSha256,
      status: comparisonStatus,
      candidates: comparison.candidates.flatMap(candidate => {
        const row = object(candidate);
        return typeof row?.page === 'number' ? [{ page: row.page, amount: string(row.amount) }] : [];
      }),
    } : null;
    return {
      snapshotId,
      validationId,
      createdAt: String(entry.created_at),
      current: snapshotId === currentSnapshotId,
      syntax: string(result?.syntax),
      number: string(observed(fields, 'BT-1')?.original),
      payable: amount && path ? { value: amount, path, currency: string(object(payable?.currency)?.value) } : null,
      proof,
      pdfComparison,
    };
  });
}
