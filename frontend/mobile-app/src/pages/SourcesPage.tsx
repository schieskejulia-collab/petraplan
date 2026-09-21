import { useEffect, useState } from 'react';
import { useLocation } from 'wouter';
import { buildCapabilityProfile } from '@/lib/bridge-capability-profile';
import { checkNorthwindSource, listSources, type PetraPlanSource, type SourceHealthResponse } from '@/lib/source-client';

function StateBadge({ children }: { children: React.ReactNode }) {
  return <span className="rounded-full border px-2 py-1 text-[10px] font-semibold">{children}</span>;
}

export default function SourcesPage() {
  const [, setLocation] = useLocation();
  const [source, setSource] = useState<PetraPlanSource | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [health, setHealth] = useState<SourceHealthResponse | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const result = await listSources();
        setSource(result.sources.find((item) => item.id === 'northwind-830') ?? null);
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : 'Quellen konnten nicht geladen werden.');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const runCheck = async () => {
    setChecking(true);
    setError(null);
    try {
      setHealth(await checkNorthwindSource());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Lesetest fehlgeschlagen.');
    } finally {
      setChecking(false);
    }
  };

  const profile = source ? buildCapabilityProfile({
    connectionId: source.id,
    identity: source.identity,
    structure: source.structure,
    capabilities: source.capabilities,
    limits: source.limits,
  }) : null;

  return <main className="min-h-screen bg-background text-foreground">
    <div className="mx-auto max-w-3xl space-y-4 px-4 py-5 pb-16">
      <header className="flex items-start justify-between gap-3">
        <div><p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">PetraPlan · Quellen</p><h1 className="mt-1 text-2xl font-semibold">Quellenverwaltung</h1><p className="mt-1 text-sm text-muted-foreground">Was diese Bridge wirklich lesen kann – und was nicht.</p></div>
        <button className="rounded-lg border px-3 py-2 text-sm" onClick={() => setLocation('/translator')}>Aufträge</button>
      </header>

      {loading && <p className="text-sm text-muted-foreground">Lade Quellenprofil…</p>}
      {error && <p className="rounded-xl border p-3 text-sm">{error}</p>}
      {!loading && !source && !error && <p className="rounded-xl border p-3 text-sm">Keine Quelle eingerichtet.</p>}

      {source && <>
        <section className="rounded-2xl border bg-card p-4 shadow-sm">
          <div className="flex items-start justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Eingerichtete Quelle</p><h2 className="mt-1 text-xl font-semibold">{source.name}</h2></div><StateBadge>READ ONLY · BEREIT</StateBadge></div>
          <p className="mt-3 text-sm text-muted-foreground">{source.description}</p>
          <div className="mt-3 grid grid-cols-2 gap-2 text-xs"><div className="rounded-lg border p-2"><span className="text-muted-foreground">Herkunft</span><strong className="block break-all">{source.origin.label}</strong></div><div className="rounded-lg border p-2"><span className="text-muted-foreground">Revision</span><strong className="block break-all">{source.origin.revision.slice(0, 12)}</strong></div><div className="rounded-lg border p-2"><span className="text-muted-foreground">Datenmodus</span><strong className="block">fest eingebetteter Snapshot</strong></div><div className="rounded-lg border p-2"><span className="text-muted-foreground">Schreibzugriff</span><strong className="block">nicht möglich</strong></div></div>
          <button className="mt-4 w-full rounded-xl border px-4 py-3 text-sm font-semibold" onClick={() => void runCheck()} disabled={checking}>{checking ? 'Prüfe lesenden Zugriff…' : 'Lesetest jetzt starten'}</button>
          <p className="mt-2 text-xs text-muted-foreground">Der Test liest die laufende Northwind-Quelle. Er verbindet sich ausdrücklich nicht mit einer externen Datenbank.</p>
        </section>

        {health && <section className="rounded-2xl border bg-card p-4 shadow-sm"><div className="flex items-start justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Lesetest</p><h2 className="mt-1 text-lg font-semibold">Quelle antwortet</h2></div><StateBadge>{health.durationMs} ms</StateBadge></div><p className="mt-2 text-xs text-muted-foreground">{new Date(health.checkedAt).toLocaleString('de-DE')}</p><div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs"><div className="rounded-lg border p-2"><strong className="block text-base">{health.summary.orders}</strong>Aufträge</div><div className="rounded-lg border p-2"><strong className="block text-base">{health.summary.orderDetails}</strong>Positionen</div><div className="rounded-lg border p-2"><strong className="block text-base">{health.summary.customers}</strong>Kunden</div></div><div className="mt-3 overflow-hidden rounded-xl border">{health.sample.map((item) => <button key={item.orderId} className="block w-full border-t px-3 py-2 text-left text-xs first:border-t-0" onClick={() => setLocation('/translator')}><strong>{item.recordId} · {item.customerId}</strong><span className="block text-muted-foreground">{item.companyName} · in Aufträgen öffnen</span></button>)}</div></section>}

        {profile && <section className="rounded-2xl border bg-card p-4 shadow-sm"><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Fähigkeiten und Grenzen</p><h2 className="mt-1 text-lg font-semibold">Technisches Quellenprofil</h2><div className="mt-3 space-y-2">{source.capabilities.map((capability) => <div key={capability.capability} className="rounded-lg border p-3 text-xs"><div className="flex items-start justify-between gap-3"><strong>{capability.capability}</strong><StateBadge>{capability.support === 'supported' ? 'BESTÄTIGT' : 'NICHT VORHANDEN'}</StateBadge></div><p className="mt-1 text-muted-foreground">{capability.evidence.reference}</p></div>)}</div><p className="mt-3 text-xs text-muted-foreground">{profile.usableForOperationChecks ? 'Profil vollständig für die belegten Leseoperationen.' : 'Profil enthält offene technische Fragen.'}</p></section>}

        <section className="rounded-2xl border bg-card p-4 shadow-sm"><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Nächste echte Ausbaustufe</p><h2 className="mt-1 text-lg font-semibold">Externe Quelle anschließen</h2><p className="mt-2 text-sm text-muted-foreground">Für Oracle, DB2 oder andere Altsysteme braucht diese Seite später eine konkrete, sichere Serververbindung und einen echten Metadaten-Lesetest. Erst dann dürfen Treiberfähigkeiten als bestätigt gelten.</p></section>
      </>}
    </div>
  </main>;
}
