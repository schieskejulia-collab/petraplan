import { buildStinoDinoProofBundle } from './stinodino-proof-bundle.mjs';

/**
 * Isolated immutable T0/T1 comparison, not a database release invalidation.
 * A change invalidates reliance on T0 observations, never historical T0 bytes.
 */
export function compareStinoDinoRevisions(t0Raw, t1Raw, options = {}) {
  const t0 = buildStinoDinoProofBundle(t0Raw, options);
  const t1 = buildStinoDinoProofBundle(t1Raw, options);
  const sourceChanged = t0.snapshot.ref !== t1.snapshot.ref;
  const t0History = Object.freeze({
    snapshotRef: t0.snapshot.ref,
    raw: t0.handoff.source.raw,
    observations: t0.handoff.candidates.map(c => ({
      locator: c.sourceLocator, value: c.rawValue, unit: c.rawUnit,
      qualifier: c.qualifier, lineId: c.lineId, snapshotRef: c.snapshotRef,
    })),
  });
  const t1History = Object.freeze({
    snapshotRef: t1.snapshot.ref,
    raw: t1.handoff.source.raw,
    observations: t1.handoff.candidates.map(c => ({
      locator: c.sourceLocator, value: c.rawValue, unit: c.rawUnit, snapshotRef: c.snapshotRef,
    })),
  });
  const blocked = t0.handoff.ingestionState === 'BLOCKED' || t1.handoff.ingestionState === 'BLOCKED';
  return {
    schemaVersion: 'stinodino-revision-comparison-v1',
    t0: t0History, t1: t1History,
    sourceChanged,
    assessment: blocked ? 'BLOCKED_INVALID_INPUT'
      : sourceChanged ? 'BLOCKED_REVALIDATION_REQUIRED' : 'UNCHANGED_UNCONFIRMED',
    oldEvidenceUsableForCurrentSource: !sourceChanged && !blocked,
    oldApprovalStatus: 'NOT_CREATED_IN_THIS_PROOF',
    releaseAllowed: false,
    persisted: false,
    actualReleaseRevoked: false,
    limitation: 'No live approvals, durable snapshots, or database revocation tested',
  };
}
