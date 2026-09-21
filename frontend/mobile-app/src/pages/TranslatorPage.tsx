import { useEffect, useMemo, useState } from 'react';
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

function StateBadge({ state }: { state: string }) {
  const label = state === 'NEEDS_CONFIRMATION' ? 'BESTÄTIGUNG NÖTIG' : state;
  return <span className="rounded-full border px-2 py-1 text-[10px] font-semibold">{label}</span>;
}

function EvidenceBadge({ status }: { status: string }) {
  return <span className="rounded-full border px-2 py-1 text-[10px] font-semibold">{status}</span>;
}

function NorthwindEvidence({ selected }: { selected: NorthwindDetail }) {
  const evidence = selected.adaptation?.evidence;
  if (!evidence) return null;
  const relation = evidence.structure.customerRelation;
  const statusValue = evidence.values.status;
  const quantityValue = evidence.values.quantity;

  return (
    <section className="rounded-2xl border bg-card p-4 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Evidence</p>
      <h2 className="mt-1 text-lg font-semibold">Beziehung und Bedeutung getrennt</h2>
      <p className="mt-1 text-xs text-muted-foreground">Eine bestätigte Beziehung erzeugt keine Bedeutung für andere Werte.</p>
      <div className="mt-3 space-y-2">
        <div className="rounded-xl border p-3">
          <div className="flex items-start justify-between gap-3">
            <div><p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Struktur-Evidenz</p><strong className="text-sm">Order.CustomerID → Customer.CustomerID</strong></div>
            <EvidenceBadge status={relation.status} />
          </div>
          <p className="mt-2 text-xs text-muted-foreground">{relation.reason}</p>
          <p className="mt-1 text-[10px] text-muted-foreground">Beleg: {relation.sourceReference ?? 'kein bestätigter Strukturbeleg'}</p>
        </div>
        <div className="rounded-xl border p-3">
          <div className="flex items-start justify-between gap-3">
            <div><p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Wert-Evidenz</p><strong className="text-sm">STATUS</strong></div>
            <EvidenceBadge status={statusValue.status} />
          </div>
          <p className="mt-2 text-xs text-muted-foreground">{statusValue.reason}</p>
          <p className="mt-1 text-[10px] text-muted-foreground">Zielwert: {String(statusValue.canonicalValue ?? '—')}</p>
        </div>
        <div className="rounded-xl border p-3">
          <div className="flex items-start justify-between gap-3">
            <div><p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Wert-Evidenz</p><strong className="text-sm">MENGE</strong></div>
            <EvidenceBadge status={quantityValue.status} />
          </div>
          <p className="mt-2 text-xs text-muted-foreground">{quantityValue.reason}</p>
          <p className="mt-1 text-[10px] text-muted-foreground">Quelle: {Array.isArray(quantityValue.sourceValue) ? quantityValue.sourceValue.join(' | ') : String(quantityValue.sourceValue ?? '—')} · Ziel: {String(quantityValue.canonicalValue ?? '—')}</p>
        </div>
      </div>
    </section>
  );
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
          <div><p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">PetraPlan · Übersetzer</p><h1 className="mt-1 text-2xl font-semibold">Bridge steuern</h1><p className="mt-1 text-sm text-muted-foreground">Aktuelle Testdaten prüfen, einen Fall auswählen und bewusst in die Live Truth Chain übernehmen.</p></div>
          <button className="rounded-lg border px-3 py-2 text-sm" onClick={() => setLocation('/cases')}>Fälle</button>
        </header>

        <div className="grid grid-cols-2 gap-2 rounded-xl border p-1">
          <button className={`rounded-lg px-3 py-2 text-sm font-semibold ${mode === 'northwind' ? 'bg-muted' : ''}`} onClick={() => setMode('northwind')}>Northwind 830</button>
          <button className={`rounded-lg px-3 py-2 text-sm font-semibold ${mode === 'manual' ? 'bg-muted' : ''}`} onClick={() => setMode('manual')}>Manuell</button>
        </div>

        {mode === 'northwind' && <>
          <section className="rounded-2xl border bg-card p-4 shadow-sm">
            <div className="flex items-start justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Aktueller Mass Proof</p><h2 className="mt-1 text-xl font-semibold">830 Northwind-Aufträge</h2></div>{northwind && <StateBadge state="READ ONLY SOURCE" />}</div>
            {northwind && <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs"><div className="rounded-lg border p-2"><strong className="block text-base">{northwind.summary.orders}</strong>Orders</div><div className="rounded-lg border p-2"><strong className="block text-base">{northwind.summary.orderDetails}</strong>Details</div><div className="rounded-lg border p-2"><strong className="block text-base">{northwind.summary.customers}</strong>Kunden</div></div>}
            {northwind && <p className="mt-3 text-xs text-muted-foreground">{northwind.summary.stateCounts.BLOCKED ?? 0} BLOCKED · {northwind.summary.stateCounts.NEEDS_CONFIRMATION ?? 0} NEEDS_CONFIRMATION · {northwind.summary.sourceSchemaAccepted} Source-Schema akzeptiert</p>}
            {northwind && <div className="mt-3 rounded-xl border p-3 text-xs"><p className="font-semibold">Evidence-Split im gesamten 830er Lauf</p><p className="mt-1 text-muted-foreground">Struktur bestätigt: {northwind.summary.evidenceCounts.structure.CONFIRMED} · STATUS belegt: {northwind.summary.evidenceCounts.statusValue.CONFIRMED} · STATUS unbelegt: {northwind.summary.evidenceCounts.statusValue.UNPROVEN} · MENGE belegt: {northwind.summary.evidenceCounts.quantityValue.CONFIRMED} · MENGE unbelegt: {northwind.summary.evidenceCounts.quantityValue.UNPROVEN}</p></div>}
          </section>

          <section className="rounded-2xl border bg-card p-4 shadow-sm">
            <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
              <input className="rounded-lg border bg-background px-3 py-2 text-sm" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="A-10248, VINET, Firmenname…" />
              <button className="rounded-lg border px-3 py-2 text-sm font-semibold" onClick={search}>Suchen</button>
            </div>
            <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
              {['', 'BLOCKED', 'NEEDS_CONFIRMATION'].map((value) => <button key={value || 'ALL'} className={`rounded-lg border px-2 py-2 ${stateFilter === value ? 'bg-muted font-semibold' : ''}`} onClick={() => { setStateFilter(value); setOffset(0); setSelected(null); void loadNorthwind(0, query, value); }}>{value || 'ALLE'}</button>)}
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

            <section className="rounded-2xl border bg-card p-4 shadow-sm"><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Quelle → Bridge → Ziel</p><h2 className="mt-1 mb-3 text-lg font-semibold">Tatsächliche Zuordnung</h2><MappingTable source={selectedRaw} target={selectedEvaluation.mapped} /><p className="mt-3 text-xs text-muted-foreground">STATUS bleibt leer, weil Northwind keinen bestätigten Gegenpart besitzt. MENGE wird nur bei genau einem Detail direkt übernommen.</p></section>

            <NorthwindEvidence selected={selected} />

            <section className="rounded-2xl border bg-card p-4 shadow-sm"><div className="flex items-center justify-between"><h2 className="text-lg font-semibold">Warum steht der Fall hier?</h2><span className="rounded-full border px-2 py-1 text-[10px] font-semibold">{selectedBlocking.length} Blocker</span></div><div className="mt-3 space-y-2">{selectedBlocking.map((item: any) => <div key={item.id} className="rounded-xl border p-3"><div className="flex justify-between gap-3"><strong className="text-sm">{item.label}</strong><span className="text-[10px] font-semibold">BLOCKIERT</span></div><p className="mt-1 text-xs text-muted-foreground">{item.evidence}</p></div>)}</div></section>

            <section className="rounded-2xl border bg-card p-4 shadow-sm"><h2 className="text-lg font-semibold">Diesen Testfall steuerbar machen</h2><p className="mt-1 text-sm text-muted-foreground">Nur dieser ausgewählte Auftrag wird als echter Live-Fall gespeichert. Die übrigen 829 Proof-Datensätze bleiben read-only.</p>{authBox}{authMessage && <p className="mt-2 text-xs text-muted-foreground">{authMessage}</p>}{persistError && <p className="mt-2 text-sm">{persistError}</p>}<button disabled={busy} className="mt-3 w-full rounded-xl border px-4 py-3 text-sm font-semibold disabled:opacity-50" onClick={() => void persistNorthwind()}>{busy ? 'Übernehme…' : `A-${selected.orderId} in Live Bridge übernehmen`}</button></section>
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
