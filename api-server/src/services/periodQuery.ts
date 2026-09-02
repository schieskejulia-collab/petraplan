import {
  InvoiceProtocol,
  readInvoiceProtocolsAtPeriod,
  shiftPeriod,
} from './invoiceProtocol.js';

export type PeriodQueryRequest = {
  anchorPeriod: string;
  monthOffset?: number;
};

export type PeriodQueryResult = {
  anchorPeriod: string;
  monthOffset: number;
  targetPeriod: string;
  records: InvoiceProtocol[];
  recordCount: number;
  readOnly: true;
};

/**
 * Resolves a user-facing period request before reading any records.
 *
 * The resolver only calculates the target period. It never creates, updates,
 * or deletes protocol data.
 */
export function resolvePeriodQuery(
  request: PeriodQueryRequest,
): { anchorPeriod: string; monthOffset: number; targetPeriod: string } {
  const monthOffset = request.monthOffset ?? 0;

  return {
    anchorPeriod: request.anchorPeriod,
    monthOffset,
    targetPeriod: shiftPeriod(request.anchorPeriod, monthOffset),
  };
}

/**
 * Executes a read-only period query against the supplied protocol snapshot.
 *
 * The input is treated as immutable and the result explicitly carries the
 * resolved target period so callers can show what was actually read.
 */
export function queryInvoiceProtocolsByPeriod(
  protocols: ReadonlyArray<InvoiceProtocol>,
  request: PeriodQueryRequest,
): PeriodQueryResult {
  const query = resolvePeriodQuery(request);
  const records = readInvoiceProtocolsAtPeriod(
    protocols,
    query.anchorPeriod,
    query.monthOffset,
  );

  return {
    ...query,
    records,
    recordCount: records.length,
    readOnly: true,
  };
}
