import type { SupabaseClient } from '@supabase/supabase-js';
import {
  decideReleaseGate,
  selectAuthoritativeValidation,
  type ReleaseStatus,
} from './releaseGate.js';
import { selectLatestCertificate, selectLatestReleaseHistory } from './certificateAuthority.js';

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
  promise: PromiseLike<{ data: T[] | null; error: { message: string } | null; count?: number | null }>,
): Promise<T[]> {
  const { data, error, count } = await promise;
  if (error) throw new Error(error.message);
  if (typeof count === 'number' && count > (data?.length ?? 0)) throw new Error('Incomplete decision-basis query result; release authority cannot be established.');
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
 * Lists production-facing cases.
 *
 * E2E fixtures remain stored for audit/test evidence but are intentionally
 * omitted from the product case list. A conflicts row may also be a
 * non-conflicting validation anchor (`conflict=false`); such anchors take part
 * in validation selection but are never counted as user-visible conflicts.
 */
export async function listCases(
  supabase: SupabaseClient,
  limit: number,
  offset: number,
): Promise<CaseListItem[]> {
  const fetched = await rows<any>(
    supabase
      .from('records')
      .select('id, created_at, title, category, status, source_system, metadata')
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1),
  );
  const records = fetched.filter((record) => record?.metadata?.e2e_test !== true);

  if (records.length === 0) return [];

  const recordIds = records.map((record) => record.id);

  const [conflicts, certificates] = await Promise.all([
    rows<any>(
      supabase
        .from('conflicts')
        .select('id, record_id, conflict', { count: 'exact' })
        .in('record_id', recordIds),
    ),
    rows<any>(
      supabase
        .from('release_certificates')
        .select('id, record_id, release_status, validation_result_id, certified_at', { count: 'exact' })
        .in('record_id', recordIds)
        .order('certified_at', { ascending: true }),
    ),
  ]);

  const conflictsByRecord = groupBy(conflicts, (item) => String(item.record_id));
  const conflictIds = conflicts.map((item) => item.id);

  const certificatesByRecord = groupBy(certificates, (item) => String(item.record_id));
  const selectionsByRecord = new Map(
    records.map((record) => [String(record.id), selectLatestCertificate(certificatesByRecord.get(String(record.id)) ?? [])]),
  );
  const latestCertificateIds = [...selectionsByRecord.values()].flatMap((item) => item.certificate ? [item.certificate.id] : []);

  const [validations, releaseStatusHistory] = await Promise.all([
    conflictIds.length
      ? rows<any>(
          supabase
            .from('validation_results')
            .select('id, conflict_id, status, created_at', { count: 'exact' })
            .in('conflict_id', conflictIds)
            .order('created_at', { ascending: true }),
        )
      : Promise.resolve([]),
    latestCertificateIds.length
      ? rows<any>(
          supabase
            .from('release_status_history')
            .select('release_certificate_id, new_status, created_at', { count: 'exact' })
            .in('release_certificate_id', latestCertificateIds)
            .order('created_at', { ascending: true }),
        )
      : Promise.resolve([]),
  ]);

  const validationsByConflict = groupBy(validations, (item) => String(item.conflict_id));
  const historyByCertificate = groupBy(releaseStatusHistory, (item) => String(item.release_certificate_id));

  return records.map(({ metadata: _metadata, ...record }) => {
    const recordAnchors = conflictsByRecord.get(String(record.id)) ?? [];
    const recordValidations = recordAnchors.flatMap(
      (anchor) => validationsByConflict.get(String(anchor.id)) ?? [],
    );

    const selection = selectionsByRecord.get(String(record.id))!;
    const certificate = selection.certificate;
    const history = selectLatestReleaseHistory(certificate ? historyByCertificate.get(String(certificate.id)) ?? [] : []);
    const releaseStatus: ReleaseStatus =
      history.entry?.new_status ?? certificate?.release_status ?? null;

    const authoritativeValidation = selectAuthoritativeValidation(
      recordValidations,
      certificate,
    );
    const validationUnavailable = (Boolean(certificate) || recordValidations.length > 0) && !authoritativeValidation;
    const gate = authoritativeValidation
      ? decideReleaseGate({
          latestValidationStatus: authoritativeValidation.status,
          latestValidationId: authoritativeValidation.id,
          certificateValidationId: certificate?.validation_result_id,
          existingReleaseStatus: releaseStatus,
          hasReleaseCertificate: Boolean(certificate),
        })
      : null;

    return {
      ...record,
      conflict_count: recordAnchors.filter((item) => item.conflict === true).length,
      release_status: selection.ambiguous || history.ambiguous || validationUnavailable ? 'blocked' : (gate?.effectiveStatus ?? releaseStatus),
    } as CaseListItem;
  });
}
