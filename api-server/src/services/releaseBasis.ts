/** Positive release is bound to one reviewed validation and one source snapshot. */
export function releaseBasisBlockers(input: {
  validation: { id?: string; resolution_record_id?: string } | null;
  review: {
    complete?: boolean;
    decision?: string | null;
    reviewer_authorized?: boolean | null;
    validation_result_id?: string | null;
    resolution_id?: string | null;
    evidence_reference_ids?: string[];
  } | null;
  snapshotId: string | null;
}): string[] {
  const { validation, review, snapshotId } = input;
  const blockers: string[] = [];
  if (!review?.complete || review.decision !== 'approved' || review.reviewer_authorized !== true) {
    blockers.push('Ein vollständiges, berechtigtes Review ist erforderlich.');
  }
  if (!validation?.id || review?.validation_result_id !== validation.id) {
    blockers.push('Die Validierung hat sich geändert. Bitte die aktuelle Prüfung erneut reviewen.');
  }
  if (!validation?.resolution_record_id || review?.resolution_id !== validation.resolution_record_id) {
    blockers.push('Das Review gehört nicht zur aktuellen Auflösung.');
  }
  if (!snapshotId || !review?.evidence_reference_ids?.includes(`ingestion:${snapshotId}`)) {
    blockers.push('Dem Review fehlt der Bezug zum aktuellen Quell-Snapshot.');
  }
  return blockers;
}
