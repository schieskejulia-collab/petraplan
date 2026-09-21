import { useState } from 'react';
import { useLocation } from 'wouter';
import { resolveAddress, type AddressResolution } from '@/lib/address-client';

function Badge({ children }: { children: React.ReactNode }) {
  return <span className="rounded-full border px-2 py-1 text-[10px] font-semibold">{children}</span>;
}

function JsonBlock({ value }: { value: unknown }) {
  return <pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-muted/50 p-3 text-[11px] leading-relaxed">{JSON.stringify(value, null, 2)}</pre>;
}

function CandidateCard({ candidate }: { candidate: AddressResolution['candidates'][number] }) {
  return <article className="rounded-xl border p-3 text-xs"><div className="flex items-start justify-between gap-2"><div><p className="font-mono text-[11px] font-semibold break-all">{candidate.id}</p><p className="mt-1 font-medium">{candidate.conversionKind === 'derive' ? 'Status ableiten' : 'Positionsmengen aggregieren'}</p></div><Badge>{candidate.state.toUpperCase()}</Badge></div>
    <dl className="mt-3 grid gap-2"><div><dt className="text-muted-foreground">Quelladresse</dt><dd className="mt-0.5 break-all font-mono">{candidate.sourceAddress}</dd></div><div><dt className="text-muted-foreground">Quellpfad</dt><dd className="mt-0.5 font-mono">{candidate.sourcePath}</dd></div><div><dt className="text-muted-foreground">Beobachtet → vorgeschlagen</dt><dd className="mt-0.5 break-words">{JSON.stringify(candidate.observedValue)} → {candidate.proposedValue}</dd></div><div><dt className="text-muted-foreground">Evidenz</dt><dd className="mt-0.5">{candidate.evidence}</dd></div><div><dt className="text-muted-foreground">Betroffene Adressen</dt><dd className="mt-0.5 space-y-1">{candidate.impactAddresses.map((address) => <p key={address} className="font-mono break-all">{address}</p>)}</dd></div></dl>
    <div className="mt-3 rounded-lg border p-2"><p className="font-semibold">Zustandshistorie</p>{candidate.stateHistory.map((entry, index) => <p key={`${entry.at}-${index}`} className="mt-1 text-muted-foreground"><strong>{entry.state}</strong> · {new Date(entry.at).toLocaleString('de-DE')} · {entry.by}<br />{entry.reason}</p>)}</div>
  </article>;
}

export default function AddressPage() {
  const [, setLocation] = useLocation();
  const [ref, setRef] = useState('NW:A-10248');
  const [data, setData] = useState<AddressResolution | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const open = async () => {
    setLoading(true); setError(null); setData(null);
    try { setData(await resolveAddress(ref)); }
    catch (err) { setError(err instanceof Error ? err.message : 'Adresse konnte nicht aufgelöst werden.'); }
    finally { setLoading(false); }
  };

  const blocking = data?.truth.constraints.filter((item: any) => item.severity === 'blocking' && !item.passed) ?? [];

  return <main className="min-h-screen bg-background text-foreground"><div className="mx-auto max-w-3xl space-y-4 px-4 py-5 pb-16">
    <header className="flex items-start justify-between gap-3"><div><p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">PetraPlan · Address Layer</p><h1 className="mt-1 text-2xl font-semibold">Direktzugriff</h1><p className="mt-1 text-sm text-muted-foreground">Eine bekannte Adresse öffnet nur ihren belegten, schreibgeschützten Lesepfad.</p></div><button className="shrink-0 rounded-lg border px-3 py-2 text-sm" onClick={() => setLocation('/translator')}>Übersetzer</button></header>
    <section className="rounded-2xl border bg-card p-4 shadow-sm"><label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Adresse</label><div className="mt-2 flex gap-2"><input className="min-w-0 flex-1 rounded-xl border bg-background px-3 py-3 font-mono text-sm" value={ref} onChange={(event) => setRef(event.target.value)} placeholder="NW:A-10248"/><button className="rounded-xl border px-4 py-3 text-sm font-semibold disabled:opacity-50" disabled={loading} onClick={() => void open()}>{loading ? 'Öffne…' : 'Öffnen'}</button></div><p className="mt-2 text-xs text-muted-foreground">Registriert ist derzeit nur <strong>NW:A-&lt;Auftragsnummer&gt;</strong>. Andere Kürzel werden nicht geraten oder stillschweigend umgedeutet.</p>{error && <p className="mt-3 text-sm">{error}</p>}</section>
    {data && <>
      <section className="rounded-2xl border bg-card p-4 shadow-sm"><div className="flex items-start justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">1 · Legacy und Adresse</p><h2 className="mt-1 text-xl font-semibold">{data.address.canonical}</h2><p className="mt-1 text-sm text-muted-foreground">{data.legacy.sourceSystem} · Snapshot vom {new Date(data.legacy.capturedAt).toLocaleDateString('de-DE')}</p></div><Badge>READ ONLY</Badge></div><p className="mt-3 break-all text-xs text-muted-foreground">{data.legacy.sourceReference}</p></section>
      <section className="rounded-2xl border bg-card p-4 shadow-sm"><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">2 · Adressliste</p><h2 className="mt-1 text-lg font-semibold">Feldadressen von {data.address.canonical}</h2><p className="mt-1 text-xs text-muted-foreground">Jede Feldadresse kennt die Kandidaten, die auf sie zeigen.</p><div className="mt-3 divide-y overflow-hidden rounded-xl border">{data.addressInventory.map((item) => <div key={item.address} className="p-3 text-xs"><p className="font-mono break-all font-semibold">{item.address}</p><p className="mt-1 text-muted-foreground">{item.path} · {item.kind}</p><p className="mt-1 break-words">Beobachtet: {JSON.stringify(item.observedValue)}</p>{item.candidateIds.length > 0 && <p className="mt-1 text-muted-foreground">Kandidaten: {item.candidateIds.join(', ')}</p>}</div>)}</div></section>
      <section className="rounded-2xl border bg-card p-4 shadow-sm"><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">3 · Zwei Konvertierungskandidaten</p><h2 className="mt-1 text-lg font-semibold">Sichtbar, adressiert, nicht angewendet</h2><p className="mt-1 text-xs text-muted-foreground">Beide stehen auf candidate. Ihre erste Historie hält fest, wann und warum sie erkannt wurden.</p><div className="mt-3 space-y-3">{data.candidates.map((candidate) => <CandidateCard key={candidate.id} candidate={candidate} />)}</div></section>
      <section className="rounded-2xl border bg-card p-4 shadow-sm"><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">2 · Verbindung und Belege</p><h2 className="mt-1 text-lg font-semibold">Quelle bleibt sichtbar</h2><JsonBlock value={data.connector.sourceSnapshot}/><details className="mt-3"><summary className="cursor-pointer text-sm font-medium">Übersetzung und Evidenz anzeigen</summary><JsonBlock value={{ mapped: data.connector.mapped, evidence: data.connector.mappingEvidence }}/></details></section>
      <section className="rounded-2xl border bg-card p-4 shadow-sm"><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">3 · Verknüpfungen</p><div className="mt-3 space-y-2">{data.links.map((link) => <div key={link.address} className="rounded-xl border p-3 text-sm"><strong>{link.relation}</strong><p className="mt-1 font-mono text-xs">{link.address}</p><p className="mt-1 text-xs text-muted-foreground">{link.label} · {link.status === 'known_not_yet_resolvable' ? 'bekannt, aber noch nicht als eigener Lesepfad umgesetzt' : link.status}</p></div>)}</div></section>
      <section className="rounded-2xl border bg-card p-4 shadow-sm"><div className="flex items-start justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">4–6 · Wahrheit, Guard Rails, Entscheidung</p><h2 className="mt-1 text-lg font-semibold">{data.decision.state}</h2></div><Badge>{data.decision.releaseAllowed ? 'FREIGABEBAR' : 'GESPERRT'}</Badge></div><p className="mt-3 text-sm">{data.decision.reason}</p>{blocking.length > 0 && <div className="mt-3 space-y-2">{blocking.map((item: any) => <div key={item.id} className="rounded-xl border p-3 text-xs"><strong>{item.label}</strong><p className="mt-1 text-muted-foreground">{item.evidence}</p></div>)}</div>}<p className="mt-3 rounded-xl border p-3 text-sm"><strong>Nächster sicherer Schritt:</strong> {data.decision.nextSafeStep}</p></section>
      <section className="rounded-2xl border bg-card p-4 shadow-sm"><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">7 · Delivery-Grenze</p><p className="mt-1 text-sm">{data.delivery.prototypeStatus}</p><p className="mt-2 text-xs text-muted-foreground">Dieser Aufruf erzeugt bewusst keinen gespeicherten Fall und keine Änderung an einer Quelle.</p></section>
    </>}
  </div></main>;
}
