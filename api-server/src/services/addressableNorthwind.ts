function fieldAddress(root: string, field: string) {
  return `${root}#${field}`;
}

/**
 * Addressable, read-only view of one Northwind order.
 *
 * This structure is stored inside the existing ingestion/record truth path.
 * It creates neither a source write nor a separate candidate database.
 */
export function buildAddressableNorthwindSnapshot(input: {
  orderId: number;
  envelope: any;
  adaptation: any;
  capturedAt: string;
}) {
  const { orderId, envelope, adaptation, capturedAt } = input;
  const root = `NW:A-${orderId}`;
  const statusCandidateId = `NW:CC:A-${orderId}:STATUS-DERIVATION`;
  const quantityCandidateId = `NW:CC:A-${orderId}:QUANTITY-AGGREGATION`;
  const quantities = envelope.orderDetails.map(({ Quantity }: any) => Quantity);
  const created = { state: 'candidate', at: capturedAt, by: 'system', reason: 'Beim read-only Snapshot erkannt; nicht angewendet.' };

  return {
    rootAddress: root,
    addressInventory: [
      { address: root, path: 'order', observedValue: orderId, kind: 'record', candidateIds: [statusCandidateId, quantityCandidateId] },
      { address: fieldAddress(root, 'OrderID'), path: 'order.OrderID', observedValue: envelope.order.OrderID, kind: 'source-field', candidateIds: [] },
      { address: fieldAddress(root, 'CustomerID'), path: 'order.CustomerID', observedValue: envelope.order.CustomerID, kind: 'source-field', candidateIds: [] },
      { address: fieldAddress(root, 'OrderDate'), path: 'order.OrderDate', observedValue: envelope.order.OrderDate, kind: 'source-field', candidateIds: [] },
      { address: fieldAddress(root, 'ShippedDate'), path: 'order.ShippedDate', observedValue: envelope.order.ShippedDate, kind: 'source-field', candidateIds: [statusCandidateId] },
      { address: fieldAddress(root, 'DetailQuantities'), path: 'orderDetails[].Quantity', observedValue: quantities, kind: 'source-field-collection', candidateIds: [quantityCandidateId] },
      { address: fieldAddress(root, 'STATUS'), path: 'bridge.STATUS', observedValue: adaptation.raw.STATUS || null, kind: 'bridge-target-field', candidateIds: [statusCandidateId] },
      { address: fieldAddress(root, 'MENGE'), path: 'bridge.MENGE', observedValue: adaptation.raw.MENGE || null, kind: 'bridge-target-field', candidateIds: [quantityCandidateId] },
    ],
    candidates: [
      {
        id: statusCandidateId,
        sourceAddress: fieldAddress(root, 'ShippedDate'),
        sourcePath: 'order.ShippedDate',
        observedValue: envelope.order.ShippedDate,
        proposedValue: envelope.order.ShippedDate ? 'STATUS=GESCHLOSSEN' : 'STATUS=OFFEN',
        conversionKind: 'derive',
        evidence: 'ShippedDate ist als Quellwert beobachtet; eine fachlich bestätigte Northwind→Bridge-Statusregel fehlt.',
        confirmed: false,
        impactAddresses: [root, fieldAddress(root, 'STATUS')],
        state: 'candidate',
        stateHistory: [created],
      },
      {
        id: quantityCandidateId,
        sourceAddress: fieldAddress(root, 'DetailQuantities'),
        sourcePath: 'orderDetails[].Quantity',
        observedValue: quantities,
        proposedValue: `MENGE=${quantities.reduce((sum: number, value: number) => sum + Number(value), 0)}`,
        conversionKind: 'aggregate',
        evidence: 'Mehrere positionsbezogene Mengen sind beobachtet; eine Summierung zu Bridge-MENGE ist fachlich nicht bestätigt.',
        confirmed: false,
        impactAddresses: [root, fieldAddress(root, 'MENGE')],
        state: 'candidate',
        stateHistory: [created],
      },
    ],
  };
}
