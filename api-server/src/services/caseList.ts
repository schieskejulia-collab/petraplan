import type { SupabaseClient } from '@supabase/supabase-js';
import {
  decideReleaseGate,
  selectAuthoritativeValidation,
  type ReleaseStatus,
} from './releaseGate.js';

export interface CaseListItem {
  id: string;
  created_at: string;
  title: string;
  category: string;
  status: string;
  source_system: string | null;
  conflict_count: number;
  release_status: ReleaseStatus;
}

async function rows<T>(
  promise: PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const { data, error } = await promise;
  if (error) throw new Error(error.message);
  return data ?? [];
}

function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const item of items) {
    const value = key(item);
    const bucket = grouped.get(value);
    if (bucket) bucket.push(item);
    else grouped.set(value, [item]);
  }
  return grouped;
}

/**
 * Lists cases without the previous N+1 query pattern.
 *
 * Query plan:
 * 1. records
 * 2. conflicts + release certificates in parallel
 * 3. validations + release status history in parallel
 *
 * The release-gate semantics stay unchanged; only data loading is batched.
 */
export async function listCases(
  supabase: SupabaseClient,
  limit: number,
  offset: number,
): Promise<CaseListItem[]> {
  const records = await rows<any>(
    supabase
      .from('records')
      .select('id, created_at, title, category, status, source_system')
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1),
  );

  if (records.length === 0) return [];

  const recordIds = records.map((record) => record.id);

  const [conflicts, certificates] = await Promise.all([
    rows<any>(
      supabase
        .from('conflicts')
        .select('id, record_id')
        .in('record_id', recordIds),
    ),
    rows<any>(
      supabase
        .from('release_certificates')
        .select('id, record_id, release_status, validation_result_id, certified_at')
        .in('record_id', recordIds)
        .order('certified_at', { ascending: true }),
    ),
  ]);

  const conflictsByRecord = groupBy(conflicts, (item) => String(item.record_id));
  const conflictIds = conflicts.map((item) => item.id);

  const latestCertificateByRecord = new Map<string, any>();
  for (const certificate of certificates) {
    latestCertificateByRecord.set(String(certificate.record_id), certificate);
  }
  const latestCertificateIds = [...latestCertificateByRecord.values()].map((item) => item.id);

  const [validations, releaseStatusHistory] = await Promise.all([
    conflictIds.length
      ? rows<any>(
          supabase
            .from('validation_results')
            .select('id, conflict_id, status, created_at')
            .in('conflict_id', conflictIds)
            .order('created_at', { ascending: true }),
        )
      : Promise.resolve([]),
    latestCertificateIds.length
      ? rows<any>(
          supabase
            .from('release_status_history')
            .select('release_certificate_id, new_status, created_at')
            .in('release_certificate_id', latestCertificateIds)
            .order('created_at', { ascending: true }),
        )
      : Promise.resolve([]),
  ]);

  const validationsByConflict = groupBy(validations, (item) => String(item.conflict_id));
  const latestStatusByCertificate = new Map<string, any>();
  for (const status of releaseStatusHistory) {
    latestStatusByCertificate.set(String(status.release_certificate_id), status);
  }

  return records.map((record) => {
    const recordConflicts = conflictsByRecord.get(String(record.id)) ?? [];
    const recordValidations = recordConflicts.flatMap(
      (conflict) => validationsByConflict.get(String(conflict.id)) ?? [],
    );

    const certificate = latestCertificateByRecord.get(String(record.id)) ?? null;
    const latestStatus = certificate
      ? latestStatusByCertificate.get(String(certificate.id)) ?? null
      : null;
    const releaseStatus: ReleaseStatus =
      latestStatus?.new_status ?? certificate?.release_status ?? null;

    const authoritativeValidation = selectAuthoritativeValidation(
      recordValidations,
      certificate,
    );
    const gate = authoritativeValidation
      ? decideReleaseGate({
          latestValidationStatus: authoritativeValidation.status,
          existingReleaseStatus: releaseStatus,
          hasReleaseCertificate: Boolean(certificate),
        })
      : null;

    return {
      ...record,
      conflict_count: recordConflicts.length,
      release_status: gate?.effectiveStatus ?? releaseStatus,
    } as CaseListItem;
  });
}
