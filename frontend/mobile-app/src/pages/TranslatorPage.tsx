import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'wouter';
import { evaluateRecord, parseRawRecord, type RawRecord } from '@/lib/bridge-pipeline';
import { bridgeAuth, currentAccessToken } from '@/lib/bridge-auth';
import { persistPinnedNorthwindCase, persistTranslatorCase } from '@/lib/bridge-ingest-client';
import { getNorthwindOrder, listNorthwindOrders, type NorthwindDetail, type NorthwindListResponse, type NorthwindSummary } from '@/lib/northwind-client';

const EMPTY_RECORD: RawRecord = { KUNDEN_NR: '', AUFTRAGS_NR: '', STATUS: '', MENGE: '', DATUM: '' };
const MAPPING_ROWS = [
  ['KUNDEN_NR', 'customerId'],
  ['AUFTRAGS_NR', 'orderId'],
  ['STATUS', 'status'],
  ['MENGE', 'quantity'],
  ['DATUM', 'orderDate'],
] as const;

function MappingTable({ source, target }: { source: Record<string, unknown>; target: Record<string, unknown> }) {
  return (
    <div className="overflow-hidden rounded-xl border">
      <div className="grid grid-cols-[1.15fr_1fr_1fr] bg-muted/60 px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        <span>Brücke</span><span>Quelle</span><span>Ziel</span>
      </div>
      {MAPPING_ROWS.map(([from, to]) => (
        <div key={from} className="grid grid-cols-[1.15fr_1fr_1fr] gap-2 border-t px-3 py-2 text-xs">
          <span className="font-medium">{from} → {to}</span>
          <span className="break-all text-muted-foreground">{String(source[from] ?? '—') || '—'}</span>
          <span className="break-all">{String(target[to] ?? '—') || '—'}</span>
        </div>
      ))}
    </div>
  );
}

function NorthwindSourceDetails({ detail }: { detail: NorthwindDetail }) {
  const { order, customer, orderDetails } = detail.envelope;
  const sourceFields = [
    ['OrderID', order.OrderID],
    ['CustomerID', order.CustomerID],
    ['Firma', customer.CompanyName],
    ['OrderDate', order.OrderDate],
    ['ShippedDate', order.ShippedDate],
  ] as const;

  return (
    <section className="rounded-2xl border bg-card p-4 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Originalquelle</p>
      <h2 className="mt-1 text-lg font-semibold">Northwind-Auftrag</h2>
      <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
        {sourceFields.map(([label, value]) => <div key={label} className="rounded-lg border p-2"><span className="text-muted-foreground">{label}</span><strong className="block break-all">{value ?? '—'}</strong></div>)}
      </div>
      <div className="mt-3 overflow-hidden rounded-xl border">
        <div className="grid grid-cols-[0.8fr_1fr_1fr_0.8fr] gap-2 bg-muted/60 px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground"><span>Produkt</span><span>Menge</span><span>Preis</span><span>Rabatt</span></div>
        {orderDetails.map((item: { OrderID: number; ProductID: number; Quantity: number; UnitPrice: number; Discount: number }) => <div key={`${item.OrderID}-${item.ProductID}`} className="grid grid-cols-[0.8fr_1fr_1fr_0.8fr] gap-2 border-t px-3 py-2 text-xs"><span>{item.ProductID}</span><strong>{item.Quantity}</strong><span>{item.UnitPrice}</span><span>{item.Discount}</span></div>)}
      </div>
      <p className="mt-2 text-xs text-muted-foreground">Die Quellwerte bleiben unverändert. Erst darunter wird sichtbar, wie die Bridge sie übersetzt.</p>
    </section>
  );
}

function StateBadge({ state }: { state: string }) {
  const label = state === 'NEEDS_CONFIRMATION' ? 'BESTÄTIGUNG NÖTIG' : state;
  return <span className="rounded-full border px-2 py-1 text-[10px] font-semibold">{label}</span>;
}

export default function TranslatorPage() {
  const [, setLocation] = useLocation();
  const [mode, setMode] = useState<'northwind' | 'manual'>('northwind');
  const [email, setEmail] = useState('');
  const [authMessage, setAuthMessage] = useState<string | null>(null);
  const [persistError, setPersistError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [northwind, setNorthwind] = useState<NorthwindListResponse | null>(null);
  const [northwindLoading, setNorthwindLoading] = useState(true);
  const [northwindError, setNorthwindError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [stateFilter, setStateFilter] = useState('');
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<NorthwindDetail | null>(null);
  const [selectedLoading, setSelectedLoading] = useState(false);
  const selectedDetailRef = useRef<HTMLDivElement | null>(null);

  const [rawInput, setRawInput] = useState(JSON.stringify(EMPTY_RECORD, null, 2));
  const [raw, setRaw] = useState<RawRecord>(EMPTY_RECORD);
  const [capturedAt, setCapturedAt] = useState(() => new Date().toISOString());
  const [sourceSystem, setSourceSystem] = useState('live-translator');
  const [inputError, setInputError] = useState<string | null>(null);

  const manualEvaluation = useMemo(
    () => evaluateRecord(raw, capturedAt, { source: sourceSystem || 'live-translator' }),
    [raw, capturedAt, sourceSystem],
  );

  const loadNorthwind = async (nextOffset = offset, nextQuery = query, nextState = stateFilter) => {
    setNorthwindLoading(true);
    setNorthwindError(null);
    try {
      const result = await listNorthwindOrders({ q: nextQuery, state: nextState, offset: nextOffset, limit: 25 });
      setNorthwind(result);
    } catch (error) {
      setNorthwindError(error instanceof Error ? error.message : 'Northwind-Testdaten konnten nicht geladen werden.');
    } finally {
      setNorthwindLoading(false);
    }
  };

  useEffect(() => { void loadNorthwind(0, '', ''); }, []);

  useEffect(() => {
    if (!selected) return;
    requestAnimationFrame(() => selectedDetailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }, [selected]);

  const chooseOrder = async (item: NorthwindSummary) => {
    setSelectedLoading(true);
    setPersistError(null);
    try {
      setSelected(await getNorthwindOrder(item.orderId));
    } catch (error) {
      setNorthwindError(error instanceof Error ? error.message : 'Northwind-Auftrag konnte nicht geladen werden.');
    } finally {
      setSelectedLoading(false);
    }
  };

  const search = () => {
    setOffset(0);
    setSelected(null);
    void loadNorthwind(0, query, stateFilter);
  };

  const paginate = (next: number) => {
    const value = Math.max(0, next);
    setOffset(value);
    setSelected(null);
    void loadNorthwind(value, query, stateFilter);
  };

  const sendMagicLink = async () => {
    const normalized = email.trim();
    if (!normalized) return setAuthMessage('E-Mail-Adresse eingeben.');
    const { error } = await bridgeAuth.auth.signInWithOtp({ email: normalized, options: { emailRedirectTo: window.location.href.split('#')[0] } });
    setAuthMessage(error ? error.message : 'Anmeldelink wurde gesendet. Öffne ihn auf diesem Gerät.');
  };

  const persistNorthwind = async () => {
    if (!selected) return;
    const token = await currentAccessToken();
    if (!token) return setPersistError('Bitte zuerst anmelden.');
    setBusy(true);
    setPersistError(null);
    try {
      const result = await persistPinnedNorthwindCase({ token, orderId: selected.orderId });
      setLocation(`/bridge/${result.record_id}`);
    } catch (error) {
      setPersistError(error instanceof Error ? error.message : 'Northwind-Fall konnte nicht übernommen werden.');
    } finally {
      setBusy(false);
    }
  };

  const translateManual = () => {
    try {
      setRaw(parseRawRecord(JSON.parse(rawInput)));
      setCapturedAt(new Date().toISOString());
      setInputError(null);
    } catch (error) {
      setInputError(error instanceof Error ? error.message : 'Ungültige Eingabe.');
    }
  };

  const persistManual = async () => {
    const token = await currentAccessToken();
    if (!token) return setPersistError('Bitte zuerst anmelden.');
    setBusy(true);
    setPersistError(null);
    try {
      const result = await persistTranslatorCase({ token, rawRecord: raw, capturedAt, ingress: { source: sourceSystem || 'live-translator' }, title: raw.AUFTRAGS_NR ? `Auftrag ${raw.AUFTRAGS_NR}` : undefined });
      setLocation(`/bridge/${result.record_id}`);
    } catch (error) {
      setPersistError(error instanceof Error ? error.message : 'Live-Fall konnte nicht gespeichert werden.');
    } finally {
      setBusy(false);
    }
  };

  const authBox = (
    <div className="mt-3 flex gap-2">
      <input className="min-w-0 flex-1 rounded-lg border bg-background px-3 py-2 text-sm" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="E-Mail für Anmeldung" />
      <button className="rounded-lg border px-3 py-2 text-sm font-semibold" onClick={() => void sendMagicLink()}>Link senden</button>
    </div>
  );

  const selectedEvaluation = selected?.evaluation;
  const selectedRaw = selected?.adaptation?.raw ?? {};
  const selectedBlocking = selectedEvaluation?.constraints.filter((item: any) => item.severity === 'blocking' && !item.passed) ?? [];
  const manualBlocking = manualEvaluation.constraints.filter((item) => item.severity === 'blocking' && !item.passed);

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-3xl space-y-4 px-4 py-5 pb-16">
        <header className="flex items-start justify-between gap-3">
          <div><p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">PetraPlan · Bridge</p><h1 className="mt-1 text-2xl font-semibold">Aufträge übersetzen</h1><p className="mt-1 text-sm text-muted-foreground">Quelle auswählen, Zielwerte prüfen und übernehmen.</p></div>
          <div className="flex gap-2"><button className="rounded-lg border px-3 py-2 text-sm" onClick={() => setLocation('/sources')}>Quellen</button><button className="rounded-lg border px-3 py-2 text-sm" onClick={() => setLocation('/cases')}>Fälle</button></div>
        </header>

        <div className="grid grid-cols-2 gap-2 rounded-xl border p-1">
          <button className={`rounded-lg px-3 py-2 text-sm font-semibold ${mode === 'northwind' ? 'bg-muted' : ''}`} onClick={() => setMode('northwind')}>Northwind 830</button>
          <button className={`rounded-lg px-3 py-2 text-sm font-semibold ${mode === 'manual' ? 'bg-muted' : ''}`} onClick={() => setMode('manual')}>Manuell</button>
        </div>

        {mode === 'northwind' && <>
          <section className="rounded-2xl border bg-card p-4 shadow-sm">
            <div className="flex items-start justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Northwind</p><h2 className="mt-1 text-xl font-semibold">Aufträge</h2></div>{northwind && <StateBadge state="READ ONLY SOURCE" />}</div>
            {northwind && <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs"><div className="rounded-lg border p-2"><strong className="block text-base">{northwind.summary.orders}</strong>Orders</div><div className="rounded-lg border p-2"><strong className="block text-base">{northwind.summary.orderDetails}</strong>Details</div><div className="rounded-lg border p-2"><strong className="block text-base">{northwind.summary.customers}</strong>Kunden</div></div>}
            {northwind && <p className="mt-3 text-xs text-muted-foreground">{northwind.summary.stateCounts.VALID ?? 0} bereit · {northwind.summary.stateCounts.BLOCKED ?? 0} blockiert · {northwind.summary.orders} insgesamt</p>}
          </section>

          <section className="rounded-2xl border bg-card p-4 shadow-sm">
            <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
              <input className="rounded-lg border bg-background px-3 py-2 text-sm" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="A-10248, VINET, Firmenname…" />
              <button className="rounded-lg border px-3 py-2 text-sm font-semibold" onClick={search}>Suchen</button>
            </div>
            <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
              {['', 'VALID', 'BLOCKED'].map((value) => <button key={value || 'ALL'} className={`rounded-lg border px-2 py-2 ${stateFilter === value ? 'bg-muted font-semibold' : ''}`} onClick={() => { setStateFilter(value); setOffset(0); setSelected(null); void loadNorthwind(0, query, value); }}>{value === 'VALID' ? 'BEREIT' : value || 'ALLE'}</button>)}
            </div>
            {northwindLoading && <p className="mt-3 text-sm text-muted-foreground">Lade aktuelle Testdaten…</p>}
            {northwindError && <p className="mt-3 text-sm">{northwindError}</p>}
            {northwind && <div className="mt-3 divide-y overflow-hidden rounded-xl border">
              {northwind.items.map((item) => <button key={item.orderId} className="grid w-full grid-cols-[1fr_auto] gap-3 px-3 py-3 text-left" onClick={() => void chooseOrder(item)}><div><strong className="text-sm">{item.recordId} · {item.customerId}</strong><p className="mt-1 text-xs text-muted-foreground">{item.companyName} · {item.detailCount} Detail{item.detailCount === 1 ? '' : 's'}</p><p className="mt-1 text-[10px] text-muted-foreground">Struktur {item.evidence.structure.customerRelation.status} · STATUS {item.evidence.values.status.status} · MENGE {item.evidence.values.quantity.status}</p></div><div className="text-right"><StateBadge state={item.bridgeState} /><p className="mt-1 text-[10px] text-muted-foreground">{item.blockingIssues} Blocker</p></div></button>)}
            </div>}
            {northwind && <div className="mt-3 flex items-center justify-between text-xs"><button className="rounded-lg border px-3 py-2 disabled:opacity-40" disabled={offset === 0} onClick={() => paginate(offset - 25)}>← zurück</button><span>{northwind.total ? `${offset + 1}–${Math.min(offset + 25, northwind.total)} von ${northwind.total}` : '0 Treffer'}</span><button className="rounded-lg border px-3 py-2 disabled:opacity-40" disabled={offset + 25 >= northwind.total} onClick={() => paginate(offset + 25)}>weiter →</button></div>}
          </section>

          {selectedLoading && <p className="text-sm text-muted-foreground">Lade vollständige Spur…</p>}
          {selected && selectedEvaluation && <>
            <section className="rounded-2xl border bg-card p-4 shadow-sm">
              <div className="flex items-start justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Ausgewählter Testfall</p><h2 className="mt-1 text-xl font-semibold">A-{selected.orderId} · {selected.envelope.customer.CompanyName}</h2></div><StateBadge state={selectedEvaluation.state.state} /></div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-xs"><div className="rounded-lg border p-2"><span className="text-muted-foreground">Customer</span><strong className="block">{selected.envelope.customer.CustomerID}</strong></div><div className="rounded-lg border p-2"><span className="text-muted-foreground">OrderDate</span><strong className="block">{selected.envelope.order.OrderDate ?? '—'}</strong></div><div className="rounded-lg border p-2"><span className="text-muted-foreground">Details</span><strong className="block">{selected.envelope.orderDetails.length}</strong></div><div className="rounded-lg border p-2"><span className="text-muted-foreground">Mengen</span><strong className="block">{selected.envelope.orderDetails.map((item: any) => item.Quantity).join(' | ') || '—'}</strong></div></div>
            </section>

            <div ref={selectedDetailRef}><NorthwindSourceDetails detail={selected} /></div>

            <section className="rounded-2xl border bg-card p-4 shadow-sm"><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Quelle → Ziel</p><h2 className="mt-1 mb-3 text-lg font-semibold">Übersetztes Ergebnis</h2><MappingTable source={selectedRaw} target={selectedEvaluation.mapped} /><p className="mt-3 text-xs text-muted-foreground">ShippedDate und mehrere Positionsmengen bleiben ungeklärt, bis ihre fachliche Bedeutung ausdrücklich bestätigt ist.</p></section>

            <section className="rounded-2xl border bg-card p-4 shadow-sm"><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Prüfspur</p><h2 className="mt-1 mb-3 text-lg font-semibold">Warum dieser Auftrag {selectedEvaluation.state.state} ist</h2><div className="space-y-2">{selectedEvaluation.constraints.map((item: any) => <div key={item.id} className="rounded-lg border p-3 text-xs"><div className="flex items-start justify-between gap-2"><strong>{item.label}</strong><StateBadge state={item.passed ? 'CONFIRMED' : item.severity === 'blocking' ? 'BLOCKED' : 'HINWEIS'} /></div><p className="mt-1 text-muted-foreground">{item.evidence}</p></div>)}</div></section>

            {selectedBlocking.length > 0 && <section className="rounded-2xl border bg-card p-4 shadow-sm"><div className="flex items-center justify-between"><h2 className="text-lg font-semibold">Nicht bereit</h2><span className="rounded-full border px-2 py-1 text-[10px] font-semibold">{selectedBlocking.length}</span></div><div className="mt-3 space-y-1">{selectedBlocking.map((item: any) => <p key={item.id} className="text-xs text-muted-foreground">{item.label}</p>)}</div></section>}

            <section className="rounded-2xl border bg-card p-4 shadow-sm"><h2 className="text-lg font-semibold">Auftrag übernehmen</h2><p className="mt-1 text-sm text-muted-foreground">Der ausgewählte Auftrag wird als Live-Fall gespeichert.</p>{authBox}{authMessage && <p className="mt-2 text-xs text-muted-foreground">{authMessage}</p>}{persistError && <p className="mt-2 text-sm">{persistError}</p>}<button disabled={busy} className="mt-3 w-full rounded-xl border px-4 py-3 text-sm font-semibold disabled:opacity-50" onClick={() => void persistNorthwind()}>{busy ? 'Übernehme…' : `A-${selected.orderId} übernehmen`}</button></section>
          </>}
        </>}

        {mode === 'manual' && <>
          <section className="rounded-2xl border bg-card p-4 shadow-sm"><label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Quellsystem</label><input className="mt-2 w-full rounded-xl border bg-background px-3 py-2 text-sm" value={sourceSystem} onChange={(e) => setSourceSystem(e.target.value)} /><label className="mt-4 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">Rohdatensatz</label><textarea className="mt-2 w-full rounded-xl border bg-background p-3 font-mono text-xs" rows={11} value={rawInput} onChange={(e) => setRawInput(e.target.value)} />{inputError && <p className="mt-2 text-sm">{inputError}</p>}<button className="mt-3 w-full rounded-xl border px-4 py-3 text-sm font-semibold" onClick={translateManual}>Übersetzen & prüfen</button></section>
          <section className="rounded-2xl border bg-card p-4 shadow-sm"><div className="flex items-start justify-between"><div><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Ergebnis</p><h2 className="mt-1 text-xl font-semibold">{manualEvaluation.state.state}</h2></div><span className="text-xs text-muted-foreground">{manualBlocking.length} Blocker</span></div><p className="mt-3 text-sm">{manualEvaluation.release.reason}</p></section>
          <section className="rounded-2xl border bg-card p-4 shadow-sm"><h2 className="mb-3 text-lg font-semibold">Quelle → Ziel</h2><MappingTable source={raw} target={manualEvaluation.mapped as Record<string, unknown>} /></section>
          <section className="rounded-2xl border bg-card p-4 shadow-sm"><h2 className="text-lg font-semibold">In die Live Bridge übernehmen</h2>{authBox}{authMessage && <p className="mt-2 text-xs text-muted-foreground">{authMessage}</p>}{persistError && <p className="mt-2 text-sm">{persistError}</p>}<button disabled={busy} className="mt-3 w-full rounded-xl border px-4 py-3 text-sm font-semibold disabled:opacity-50" onClick={() => void persistManual()}>{busy ? 'Speichere…' : 'Als echten Live-Fall speichern'}</button></section>
        </>}
      </div>
    </main>
  );
}
