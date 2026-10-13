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
