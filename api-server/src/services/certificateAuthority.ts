export interface CertificateRef { id: string; certified_at?: string | null; }
export function selectLatestCertificate<T extends CertificateRef>(items: T[]): { certificate: T | null; ambiguous: boolean } {
  if (items.length === 0) return { certificate: null, ambiguous: false };
  const sorted = [...items].sort((a, b) => String(b.certified_at ?? '').localeCompare(String(a.certified_at ?? '')));
  const latest = sorted[0];
  if (!latest.certified_at || sorted.filter(x => x.certified_at === latest.certified_at).length !== 1) {
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
  const sorted = [...items].sort((a, b) => String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')));
  const latest = sorted[0];
  const tied = sorted.filter(x => x.created_at === latest.created_at);
  if (!latest.created_at || tied.length !== 1) return { entry: null, ambiguous: true };
  return { entry: latest, ambiguous: false };
}
