function timestamp(value?: string | null): number {
  if (!value) return NaN;
  return Date.parse(value);
}

export interface CertificateRef { id: string; certified_at?: string | null; }
export function selectLatestCertificate<T extends CertificateRef>(items: T[]): { certificate: T | null; ambiguous: boolean } {
  if (items.length === 0) return { certificate: null, ambiguous: false };
  const sorted = [...items].sort((a, b) => (Number.isFinite(timestamp(b.certified_at)) ? timestamp(b.certified_at) : -Infinity) - (Number.isFinite(timestamp(a.certified_at)) ? timestamp(a.certified_at) : -Infinity));
  const latest = sorted[0];
  if (!Number.isFinite(timestamp(latest.certified_at)) || sorted.filter(x => timestamp(x.certified_at) === timestamp(latest.certified_at)).length !== 1) {
    return { certificate: null, ambiguous: true };
  }
  return { certificate: latest, ambiguous: false };
}

export interface ReleaseHistoryRef {
  release_certificate_id?: string | null;
  created_at?: string | null;
  new_status?: string | null;
}

export function selectLatestReleaseHistory<T extends ReleaseHistoryRef>(
  items: T[],
): { entry: T | null; ambiguous: boolean } {
  if (items.length === 0) return { entry: null, ambiguous: false };
  const sorted = [...items].sort((a, b) => (Number.isFinite(timestamp(b.created_at)) ? timestamp(b.created_at) : -Infinity) - (Number.isFinite(timestamp(a.created_at)) ? timestamp(a.created_at) : -Infinity));
  const latest = sorted[0];
  const tied = sorted.filter(x => timestamp(x.created_at) === timestamp(latest.created_at));
  if (!Number.isFinite(timestamp(latest.created_at)) || tied.length !== 1) return { entry: null, ambiguous: true };
  return { entry: latest, ambiguous: false };
}
