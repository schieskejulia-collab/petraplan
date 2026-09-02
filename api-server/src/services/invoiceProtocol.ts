export type InvoiceProtocolStatus = 'received' | 'checked' | 'blocked' | 'released';

export type InvoiceProtocolInput = {
  invoiceId: string;
  sourceSystem: string;
  postingPeriod: string;
  caseId?: string;
  orderReference?: string;
  amount?: number;
  currency?: string;
  status?: InvoiceProtocolStatus;
  correlationId?: string;
  recordedAt?: string;
};

export type InvoiceProtocol = {
  protocolId: string;
  invoiceId: string;
  sourceSystem: string;
  postingPeriod: string;
  caseId?: string;
  orderReference?: string;
  amount?: number;
  currency?: string;
  status: InvoiceProtocolStatus;
  correlationId: string;
  recordedAt?: string;
};

export type InvoiceProtocolTraceLink = {
  caseId: string;
  postingPeriod: string;
  protocolIds: string[];
  sourceSystems: string[];
  statuses: InvoiceProtocolStatus[];
};

const PERIOD_PATTERN = /^([0-9]{4})-(0[1-9]|1[0-2])$/;

function assertPeriod(period: string): void {
  if (!PERIOD_PATTERN.test(period)) {
    throw new Error('postingPeriod must use YYYY-MM');
  }
}

export function shiftPeriod(period: string, monthOffset: number): string {
  assertPeriod(period);

  if (!Number.isInteger(monthOffset)) {
    throw new Error('monthOffset must be an integer');
  }

  const [, year, month] = PERIOD_PATTERN.exec(period) ?? [];
  const shifted = new Date(Date.UTC(Number(year), Number(month) - 1 + monthOffset, 1));
  const shiftedYear = shifted.getUTCFullYear();
  const shiftedMonth = String(shifted.getUTCMonth() + 1).padStart(2, '0');

  return [shiftedYear, shiftedMonth].join('-');
}

export function createInvoiceProtocol(input: InvoiceProtocolInput): InvoiceProtocol {
  if (!input.invoiceId.trim()) {
    throw new Error('invoiceId is required');
  }

  if (!input.sourceSystem.trim()) {
    throw new Error('sourceSystem is required');
  }

  if (input.caseId !== undefined && !input.caseId.trim()) {
    throw new Error('caseId must not be empty');
  }

  assertPeriod(input.postingPeriod);

  const protocolIdentity = [
    'invoice-protocol',
    ...(input.caseId ? [input.caseId] : []),
    input.sourceSystem,
    input.invoiceId,
    input.postingPeriod,
  ].join(':');

  return {
    protocolId: protocolIdentity,
    invoiceId: input.invoiceId,
    sourceSystem: input.sourceSystem,
    postingPeriod: input.postingPeriod,
    ...(input.caseId ? { caseId: input.caseId } : {}),
    ...(input.orderReference ? { orderReference: input.orderReference } : {}),
    ...(input.amount === undefined ? {} : { amount: input.amount }),
    ...(input.currency ? { currency: input.currency } : {}),
    status: input.status ?? 'received',
    correlationId:
      input.correlationId ??
      ['invoice', input.sourceSystem, input.invoiceId].join(':'),
    ...(input.recordedAt ? { recordedAt: input.recordedAt } : {}),
  };
}

/**
 * Read-only period navigation. It selects existing protocol records; it
 * neither creates nor changes records and does not grant historical access.
 */
export function readInvoiceProtocolsAtPeriod(
  protocols: ReadonlyArray<InvoiceProtocol>,
  anchorPeriod: string,
  monthOffset = 0,
): InvoiceProtocol[] {
  const targetPeriod = shiftPeriod(anchorPeriod, monthOffset);

  return protocols
    .filter((protocol) => protocol.postingPeriod === targetPeriod)
    .slice()
    .sort((left, right) => left.protocolId.localeCompare(right.protocolId));
}

/**
 * Links only explicitly case-scoped protocols into a trace summary.
 * Unscoped protocols are intentionally excluded.
 */
export function buildInvoiceProtocolTraceLink(
  caseId: string,
  protocols: ReadonlyArray<InvoiceProtocol>,
  anchorPeriod: string,
  monthOffset = 0,
): InvoiceProtocolTraceLink {
  if (!caseId.trim()) {
    throw new Error('caseId is required');
  }

  const selected = readInvoiceProtocolsAtPeriod(protocols, anchorPeriod, monthOffset)
    .filter((protocol) => protocol.caseId === caseId);

  return {
    caseId,
    postingPeriod: shiftPeriod(anchorPeriod, monthOffset),
    protocolIds: selected.map((protocol) => protocol.protocolId),
    sourceSystems: [...new Set(selected.map((protocol) => protocol.sourceSystem))],
    statuses: [...new Set(selected.map((protocol) => protocol.status))],
  };
}
