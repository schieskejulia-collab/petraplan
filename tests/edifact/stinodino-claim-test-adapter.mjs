import { compareStinoDinoRevisions } from './stinodino-revision-comparison.mjs';

/**
 * Explicit test-only bridge into the existing PetraPlan claim trigger.
 * Caller supplies an isolated PGlite database and EXISTING fixture IDs.
 * This does not create a source identity, verify semantic meaning, or release.
 */
export async function submitStinoDinoRevisionObservation({
  db, t0Raw, t1Raw, recordId, snapshotId, producer = 'stinodino-isolated-proof',
}) {
  if (!db || !recordId || !snapshotId) throw new Error('EXISTING_CASE_BINDING_REQUIRED');
  const comparison = compareStinoDinoRevisions(t0Raw, t1Raw);
  if (comparison.assessment === 'BLOCKED_INVALID_INPUT') throw new Error('INVALID_EDIFACT_INPUT');
  if (!comparison.sourceChanged) return { comparison, submitted: false, claimId: null };
  const changed = comparison.t1.observations.filter((item, index) => {
    const prior = comparison.t0.observations[index];
    return !prior || prior.value !== item.value || prior.unit !== item.unit || prior.locator !== item.locator;
  });
  const details = JSON.stringify({
    source: 'stinodino-edifact', t0: comparison.t0.snapshotRef, t1: comparison.t1.snapshotRef,
    changedObservations: changed, assessment: comparison.assessment,
    provenance: 'unverified_synthetic_test', semanticAuthority: 'none',
  });
  const result = await db.query(`insert into claims
    (claim_family_id,claim_type,subject_address,predicate,statement,status,
     scope_type,record_id,snapshot_id,created_by,created_at)
    values (gen_random_uuid(),'SEMANTIC_MAPPING','order.QTY','observed',
      $4,'UNPROVEN','CASE_ONLY',$1,$2,$3,now()) returning id`,
    [recordId, snapshotId, producer, details]);
  return { comparison, submitted: true, claimId: result.rows[0].id };
}
