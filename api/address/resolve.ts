const NORTHWIND_ADDRESS = /^NW:A-(\d+)$/i;

function normalizeAddress(value: unknown) {
  return String(value ?? '').trim().toUpperCase();
}

function fieldAddress(root: string, field: string) {
  return `${root}#${field}`;
}

export default async function handler(req: any, res: any) {
  try {
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      return res.status(405).json({ error: 'Method not allowed' });
    }

    const requested = normalizeAddress(req.query?.ref);
    const match = NORTHWIND_ADDRESS.exec(requested);
    if (!match) {
      return res.status(400).json({
        error: 'Unregistered address',
        message: 'Der Prototyp kennt derzeit nur die explizite Form NW:A-<Auftragsnummer>, zum Beispiel NW:A-10248.',
        requested,
        supportedFormats: ['NW:A-<Auftragsnummer>'],
      });
    }

    const orderId = Number(match[1]);
    const { getPinnedNorthwindOrder, NORTHWIND_PROOF_CAPTURED_AT, NORTHWIND_UPSTREAM_COMMIT, NORTHWIND_UPSTREAM_REPO } = await import('../../api-server/src/services/pinnedNorthwind.js');
    const result = await getPinnedNorthwindOrder(orderId);
    if (!result || !result.evaluation || !result.adaptation) {
      return res.status(404).json({
        error: 'Address not resolved',
        address: `NW:A-${orderId}`,
        message: 'Die Adresse ist registriert, aber im festgeschriebenen Northwind-Snapshot nicht auflösbar.',
      });
    }

    const canonicalAddress = `NW:A-${orderId}`;
    const blockers = result.evaluation.constraints.filter((item: any) => item.severity === 'blocking' && !item.passed);
    const customerId = String(result.envelope.customer.CustomerID);
    const statusCandidateId = `NW:CC:A-${orderId}:STATUS-DERIVATION`;
    const quantityCandidateId = `NW:CC:A-${orderId}:QUANTITY-AGGREGATION`;
    const addressInventory = [
      { address: canonicalAddress, path: 'order', observedValue: orderId, kind: 'record', candidateIds: [statusCandidateId, quantityCandidateId] },
      { address: fieldAddress(canonicalAddress, 'OrderID'), path: 'order.OrderID', observedValue: result.envelope.order.OrderID, kind: 'source-field', candidateIds: [] },
      { address: fieldAddress(canonicalAddress, 'CustomerID'), path: 'order.CustomerID', observedValue: result.envelope.order.CustomerID, kind: 'source-field', candidateIds: [] },
      { address: fieldAddress(canonicalAddress, 'OrderDate'), path: 'order.OrderDate', observedValue: result.envelope.order.OrderDate, kind: 'source-field', candidateIds: [] },
      { address: fieldAddress(canonicalAddress, 'ShippedDate'), path: 'order.ShippedDate', observedValue: result.envelope.order.ShippedDate, kind: 'source-field', candidateIds: [statusCandidateId] },
      { address: fieldAddress(canonicalAddress, 'DetailQuantities'), path: 'orderDetails[].Quantity', observedValue: result.envelope.orderDetails.map(({ Quantity }: any) => Quantity), kind: 'source-field-collection', candidateIds: [quantityCandidateId] },
      { address: fieldAddress(canonicalAddress, 'STATUS'), path: 'bridge.STATUS', observedValue: result.adaptation.raw.STATUS || null, kind: 'bridge-target-field', candidateIds: [statusCandidateId] },
      { address: fieldAddress(canonicalAddress, 'MENGE'), path: 'bridge.MENGE', observedValue: result.adaptation.raw.MENGE || null, kind: 'bridge-target-field', candidateIds: [quantityCandidateId] },
    ];
    const candidates = [
      {
        id: statusCandidateId,
        sourceAddress: fieldAddress(canonicalAddress, 'ShippedDate'),
        sourcePath: 'order.ShippedDate',
        observedValue: result.envelope.order.ShippedDate,
        proposedValue: result.envelope.order.ShippedDate ? 'STATUS=GESCHLOSSEN' : 'STATUS=OFFEN',
        conversionKind: 'derive',
        evidence: 'ShippedDate ist als Quellwert beobachtet; eine fachlich bestätigte Northwind→Bridge-Statusregel fehlt.',
        confirmed: false,
        impactAddresses: [canonicalAddress, fieldAddress(canonicalAddress, 'STATUS')],
        state: 'candidate',
        stateHistory: [{ state: 'candidate', at: NORTHWIND_PROOF_CAPTURED_AT, by: 'system', reason: 'Beim read-only Snapshot erkannt; nicht angewendet.' }],
      },
      {
        id: quantityCandidateId,
        sourceAddress: fieldAddress(canonicalAddress, 'DetailQuantities'),
        sourcePath: 'orderDetails[].Quantity',
        observedValue: result.envelope.orderDetails.map(({ Quantity }: any) => Quantity),
        proposedValue: `MENGE=${result.envelope.orderDetails.reduce((sum: number, detail: any) => sum + Number(detail.Quantity), 0)}`,
        conversionKind: 'aggregate',
        evidence: 'Mehrere positionsbezogene Mengen sind beobachtet; eine Summierung zu Bridge-MENGE ist fachlich nicht bestätigt.',
        confirmed: false,
        impactAddresses: [canonicalAddress, fieldAddress(canonicalAddress, 'MENGE')],
        state: 'candidate',
        stateHistory: [{ state: 'candidate', at: NORTHWIND_PROOF_CAPTURED_AT, by: 'system', reason: 'Beim read-only Snapshot erkannt; nicht angewendet.' }],
      },
    ];

    return res.status(200).json({
      address: {
        requested,
        canonical: canonicalAddress,
        status: 'resolved',
        kind: 'northwind-order',
        sourceId: 'northwind-830-pinned',
      },
      legacy: {
        sourceSystem: 'Northwind reference snapshot',
        sourceReference: `${NORTHWIND_UPSTREAM_REPO}@${NORTHWIND_UPSTREAM_COMMIT}`,
        capturedAt: NORTHWIND_PROOF_CAPTURED_AT,
        access: 'read-only',
        writePolicy: 'forbidden',
      },
      connector: {
        schemaGate: result.sourceSchemaGate,
        sourceSchemaIssues: result.sourceSchemaIssues,
        sourceSnapshot: result.envelope,
        mapped: result.evaluation.mapped,
        mappingEvidence: result.adaptation.evidence,
      },
      links: [
        { relation: 'customer', address: `NW:CUSTOMER:${customerId}`, status: 'known_not_yet_resolvable', label: result.envelope.customer.CompanyName },
        { relation: 'source', address: 'SOURCE:NORTHWIND-830-PINNED', status: 'known_not_yet_resolvable', label: 'Versionierter Referenz-Snapshot' },
      ],
      addressInventory,
      candidates,
      truth: {
        state: result.evaluation.state,
        constraints: result.evaluation.constraints,
        trace: result.evaluation.trace,
        provenance: result.evaluation.provenance,
      },
      guardRails: {
        sourceWritesAllowed: false,
        releaseAllowed: result.evaluation.release.releaseAllowed,
        blockingConstraintIds: blockers.map((item: any) => item.id),
        policy: 'read_before_write__evidence_before_interpretation__confirmation_before_change',
      },
      decision: {
        state: result.evaluation.state.state,
        releaseAllowed: result.evaluation.release.releaseAllowed,
        reason: result.evaluation.release.reason,
        nextSafeStep: blockers.length
          ? 'Die angezeigten Bedeutungs- und Vertragsblocker fachlich belegen oder bestätigen; bis dahin bleibt jede Freigabe gesperrt.'
          : 'Den vollständig belegten Snapshot als Fall speichern und eine autorisierte Review starten.',
      },
      delivery: {
        prototypeStatus: 'read-only address resolution; no productive-system connection; no source mutation',
        persistedCase: 'not-created-by-resolution',
      },
    });
  } catch (error) {
    console.error('PetraPlan address resolver failed:', error);
    return res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown address resolver error' });
  }
}
