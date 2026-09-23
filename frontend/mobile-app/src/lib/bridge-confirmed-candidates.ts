import type { AdapterConflict } from './bridge-conflict-truth.js';
import type { RawRecord } from './bridge-pipeline.js';

export type PersistedConversionCandidate = {
  id: string;
  candidate_key?: string | null;
  snapshot_id?: string | null;
  state?: string | null;
  source_path?: string | null;
  conversion_kind?: string | null;
  proposed_value?: unknown;
};

export type AppliedCandidateDecision = {
  candidate_id: string;
  candidate_key: string;
  field: 'STATUS' | 'MENGE';
  value: string;
};

function statusFromProposal(value: unknown): string | null {
  const match = String(value ?? '').match(/^STATUS=(OFFEN|GESCHLOSSEN|IN_BEARBEITUNG)$/);
  return match?.[1] ?? null;
}

function quantityFromProposal(value: unknown): string | null {
  const match = String(value ?? '').match(/^MENGE=(-?\d+(?:\.\d+)?)$/);
  return match?.[1] ?? null;
}

/**
 * Applies only already-confirmed semantic decisions to a fresh Bridge input.
 *
 * The supplied source/raw objects are cloned. Candidate confirmation therefore
 * never changes Source Truth or the original snapshot; it merely becomes
 * authority evidence for a later validation run.
 */
export function applyConfirmedNorthwindCandidates(input: {
  raw: RawRecord;
  candidates: PersistedConversionCandidate[];
  adapterConflicts?: AdapterConflict[];
  snapshotId?: string | null;
}) {
  const raw: RawRecord = structuredClone(input.raw);
  const applied: AppliedCandidateDecision[] = [];

  for (const candidate of input.candidates) {
    if (String(candidate.state) !== 'confirmed') continue;
    if (input.snapshotId && candidate.snapshot_id && candidate.snapshot_id !== input.snapshotId) continue;

    const key = String(candidate.candidate_key ?? '');
    const sourcePath = String(candidate.source_path ?? '');

    if (key.endsWith(':STATUS-DERIVATION') && sourcePath === 'order.ShippedDate') {
      const status = statusFromProposal(candidate.proposed_value);
      if (!status) continue;
      raw.STATUS = status;
      applied.push({ candidate_id: candidate.id, candidate_key: key, field: 'STATUS', value: status });
      continue;
    }

    if (key.endsWith(':QUANTITY-AGGREGATION') && sourcePath === 'orderDetails[].Quantity') {
      const quantity = quantityFromProposal(candidate.proposed_value);
      if (!quantity) continue;
      raw.MENGE = quantity;
      applied.push({ candidate_id: candidate.id, candidate_key: key, field: 'MENGE', value: quantity });
    }
  }

  const resolvedFields = new Set(applied.map(({ field }) => field));
  const adapterConflicts = (input.adapterConflicts ?? []).filter((conflict) =>
    !(conflict.code === 'NO_CONFIRMED_SEMANTIC_MAPPING' && resolvedFields.has(conflict.field as 'STATUS' | 'MENGE')),
  );

  return { raw, applied, adapterConflicts };
}
