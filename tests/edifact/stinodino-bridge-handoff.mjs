import { inspectEdifactOrders } from './stinodino-entry.mjs';

/**
 * Read-only EDIFACT -> PetraPlan handoff candidate.
 * No DB writes, no fabricated authority, no release and no claim persistence.
 * This is NOT the production claim/evidence lifecycle.
 */
export function proposeStinoDinoBridgeHandoff(raw, { sourceId = 'synthetic:stinodino-001' } = {}) {
  const inspected = inspectEdifactOrders(raw);
  const source = {
    id: sourceId,
    format: 'EDIFACT',
    messageType: 'ORDERS:D:96A:UN',
    authenticity: 'unverified_synthetic_fixture',
    raw: inspected.rawSource,
    mutationPolicy: 'read_only',
  };
  const candidates = inspected.lines.flatMap(line =>
    line.quantities.map(q => ({
      address: `${sourceId}#segment-${q.sourceSegment}`,
      lineId: line.lineId,
      rawValue: q.rawValue,
      parsedNumber: q.value,
      rawUnit: q.unit,
      qualifier: q.qualifier,
      meaning: 'unconfirmed',
      evidence: [{ sourceId, segmentIndex: q.sourceSegment, kind: 'source_observation' }],
      claimStatus: 'candidate_only',
    }))
  );
  const blocked = inspected.state === 'BLOCKED';
  return {
    source,
    candidates,
    findings: inspected.findings,
    ingestionState: inspected.state,
    nextStep: blocked ? 'BLOCKED' : 'NEEDS_SEMANTIC_REVIEW',
    allowedActions: ['inspect_read_only'],
    releaseAllowed: false,
    releaseAuthority: 'none',
    persisted: false,
    connectedToClaimLifecycle: false,
    orderTotal: null,
  };
}
