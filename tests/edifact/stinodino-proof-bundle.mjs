import { createHash } from 'node:crypto';
import { proposeStinoDinoBridgeHandoff } from './stinodino-bridge-handoff.mjs';

/**
 * Portable, read-only proof bundle. Content hash identifies bytes, not source authenticity.
 * It is deliberately not a PetraPlan DB snapshot, confirmation or release certificate.
 */
export function buildStinoDinoProofBundle(raw, options = {}) {
  const handoff = proposeStinoDinoBridgeHandoff(raw, options);
  const sha256 = createHash('sha256').update(Buffer.from(raw, 'utf8')).digest('hex');
  const snapshotRef = `sha256:${sha256}`;
  const observations = handoff.candidates.map((candidate) => ({
    ...candidate,
    snapshotRef,
    sourceLocator: candidate.address,
    evidence: candidate.evidence.map(e => ({
      ...e, snapshotRef, evidenceKind: 'unverified_raw_source_observation',
    })),
  }));
  return {
    schemaVersion: 'stinodino-readonly-proof-v1',
    snapshot: { ref: snapshotRef, algorithm: 'sha256', bytes: Buffer.byteLength(raw, 'utf8'),
      persistence: 'not_persisted', identityVerified: false },
    handoff: { ...handoff, candidates: observations },
    gate: {
      sourceIntegrity: 'hash_only_not_authenticated',
      sourceAddress: 'ephemeral_segment_locator',
      candidateConfirmation: 'not_confirmed',
      semanticEvidence: 'not_verified',
      claimDraft: 'not_created',
      decisionSnapshot: 'not_created',
      releaseAllowed: false,
    },
  };
}
