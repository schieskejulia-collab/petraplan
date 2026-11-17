import { databaseTimestamp } from './databaseTimestamp.js';

function uniqueLatest<T>(items: T[], value: (item: T) => string | null | undefined): { entry: T | null; ambiguous: boolean } {
  let entry: T | null = null;
  let latest: bigint | null = null;
  let tied = false;
  for (const item of items) {
    const time = databaseTimestamp(value(item));
    // An undated event could be newer than every dated event.
    if (time === null) return { entry: null, ambiguous: true };
    if (latest === null || time > latest) { entry = item; latest = time; tied = false; }
    else if (time === latest) tied = true;
  }
  return tied ? { entry: null, ambiguous: true } : { entry, ambiguous: false };
}

export interface CertificateRef { id: string; certified_at?: string | null; }
export function selectLatestCertificate<T extends CertificateRef>(items: T[]): { certificate: T | null; ambiguous: boolean } {
  const result = uniqueLatest(items, (item) => item.certified_at);
  return { certificate: result.entry, ambiguous: result.ambiguous };
}

export interface ReleaseHistoryRef {
  release_certificate_id?: string | null;
  created_at?: string | null;
  new_status?: string | null;
}

export function selectLatestReleaseHistory<T extends ReleaseHistoryRef>(
  items: T[],
): { entry: T | null; ambiguous: boolean } {
  const selected = uniqueLatest(items, (item) => item.created_at);
  // Legacy history may already contain an attempted terminal reactivation.
  if (selected.entry && items.some((item) =>
    (item.new_status === 'revoked' || item.new_status === 'superseded')
      && item.new_status !== selected.entry!.new_status)) return { entry: null, ambiguous: true };
  return selected;
}
