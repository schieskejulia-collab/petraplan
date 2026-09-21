import { buildAddressableNorthwindSnapshot } from '../../api-server/src/services/addressableNorthwind.js';

const NORTHWIND_ADDRESS = /^NW:A-(\d+)$/i;

function normalizeAddress(value: unknown) {
  return String(value ?? '').trim().toUpperCase();
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
    const addressable = buildAddressableNorthwindSnapshot({ orderId, envelope: result.envelope, adaptation: result.adaptation, capturedAt: NORTHWIND_PROOF_CAPTURED_AT });

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
      addressInventory: addressable.addressInventory,
      candidates: addressable.candidates,
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
