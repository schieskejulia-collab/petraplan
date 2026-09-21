import { useMemo, useState } from 'react';
import { useLocation } from 'wouter';
import { evaluateRecord, parseRawRecord, type RawRecord } from '@/lib/bridge-pipeline';
import { bridgeAuth, currentAccessToken } from '@/lib/bridge-auth';
import { persistTranslatorCase } from '@/lib/bridge-ingest-client';

const EMPTY_RECORD: RawRecord = {
  KUNDEN_NR: '',
  AUFTRAGS_NR: '',
  STATUS: '',
  MENGE: '',
  DATUM: '',
};

function FieldGrid({ source, target }: { source: Record<string, unknown>; target: Record<string, unknown> }) {
  const keys = [...new Set([...Object.keys(source), ...Object.keys(target)])];
  return (
    <div className="overflow-hidden rounded-xl border">
      <div className="grid grid-cols-[0.9fr_1fr_1fr] bg-muted/60 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        <span>Feld</span><span>Quelle</span><span>Ziel</span>
      </div>
      {keys.map((key) => (
        <div key={key} className="grid grid-cols-[0.9fr_1fr_1fr] gap-2 border-t px-3 py-2 text-xs">
          <span className="break-all font-medium">{key}</span>
          <span className="break-all text-muted-foreground">{String(source[key] ?? '—')}</span>
          <span className="break-all">{String(target[key] ?? '—')}</span>
        </div>
      ))}
    </div>
  );
}

export default function TranslatorPage() {
  const [, setLocation] = useLocation();
  const [rawInput, setRawInput] = useState(JSON.stringify(EMPTY_RECORD, null, 2));
  const [raw, setRaw] = useState<RawRecord>(EMPTY_RECORD);
  const [capturedAt, setCapturedAt] = useState(() => new Date().toISOString());
  const [sourceSystem, setSourceSystem] = useState('live-translator');
  const [inputError, setInputError] = useState<string | null>(null);
  const [persistError, setPersistError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState('');
  const [authMessage, setAuthMessage] = useState<string | null>(null);

  const evaluation = useMemo(
    () => evaluateRecord(raw, capturedAt, { source: sourceSystem || 'live-translator' }),
    [raw, capturedAt, sourceSystem],
  );

  const blocking = evaluation.constraints.filter((item) => item.severity === 'blocking' && !item.passed);

  const translate = () => {
    try {
      const next = parseRawRecord(JSON.parse(rawInput));
      setRaw(next);
      setCapturedAt(new Date().toISOString());
      setInputError(null);
    } catch (error) {
      setInputError(error instanceof Error ? error.message : 'Ungültige Eingabe.');
    }
  };

  const sendMagicLink = async () => {
    const normalized = email.trim();
    if (!normalized) return setAuthMessage('E-Mail-Adresse eingeben.');
    const { error } = await bridgeAuth.auth.signInWithOtp({
      email: normalized,
      options: { emailRedirectTo: window.location.href.split('#')[0] },
    });
    setAuthMessage(error ? error.message : 'Anmeldelink wurde gesendet. Öffne ihn auf diesem Gerät.');
  };

  const persist = async () => {
    const token = await currentAccessToken();
    if (!token) {
      setPersistError('Bitte zuerst anmelden.');
      return;
    }
    setBusy(true);
    setPersistError(null);
    try {
      const result = await persistTranslatorCase({
        token,
        rawRecord: raw,
        capturedAt,
        ingress: { source: sourceSystem || 'live-translator' },
        title: raw.AUFTRAGS_NR ? `Auftrag ${raw.AUFTRAGS_NR}` : undefined,
      });
      setLocation(`/bridge/${result.record_id}`);
    } catch (error) {
      setPersistError(error instanceof Error ? error.message : 'Live-Fall konnte nicht gespeichert werden.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-3xl space-y-4 px-4 py-5 pb-16">
        <header className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">PetraPlan · Übersetzer</p>
            <h1 className="mt-1 text-2xl font-semibold">Live übersetzen</h1>
            <p className="mt-1 text-sm text-muted-foreground">Genau dieser Datensatz wird geprüft und kann anschließend als derselbe Live-Fall gespeichert werden.</p>
          </div>
          <button className="rounded-lg border px-3 py-2 text-sm" onClick={() => setLocation('/cases')}>Fälle</button>
        </header>

        <section className="rounded-2xl border bg-card p-4 shadow-sm">
          <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Quellsystem</label>
          <input className="mt-2 w-full rounded-xl border bg-background px-3 py-2 text-sm" value={sourceSystem} onChange={(e) => setSourceSystem(e.target.value)} />
          <label className="mt-4 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">Rohdatensatz</label>
          <textarea className="mt-2 w-full rounded-xl border bg-background p-3 font-mono text-xs" rows={11} value={rawInput} onChange={(e) => setRawInput(e.target.value)} />
          {inputError && <p className="mt-2 text-sm">{inputError}</p>}
          <button className="mt-3 w-full rounded-xl border px-4 py-3 text-sm font-semibold" onClick={translate}>Übersetzen & prüfen</button>
        </section>

        <section className="rounded-2xl border bg-card p-4 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Ergebnis</p>
              <h2 className="mt-1 text-xl font-semibold">{evaluation.state.state}</h2>
            </div>
            <div className="text-right text-xs text-muted-foreground">
              <p>{blocking.length} Blocker</p>
              <p>{evaluation.release.releaseAllowed ? 'Freigabe technisch möglich' : 'Freigabe blockiert'}</p>
            </div>
          </div>
          <p className="mt-3 text-sm leading-relaxed">{evaluation.release.reason}</p>
        </section>

        <section className="rounded-2xl border bg-card p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Quelle → Übersetzung</p>
          <h2 className="mt-1 mb-3 text-lg font-semibold">Tatsächliche Feldwerte</h2>
          <FieldGrid source={raw} target={evaluation.mapped as Record<string, unknown>} />
        </section>

        <section className="rounded-2xl border bg-card p-4 shadow-sm">
          <div className="flex items-center justify-between gap-3"><h2 className="text-lg font-semibold">Prüfergebnis</h2><span className="rounded-full border px-2 py-1 text-[11px] font-semibold">{blocking.length} Blocker</span></div>
          <div className="mt-3 space-y-2">
            {evaluation.constraints.map((item) => (
              <div key={item.id} className="rounded-xl border p-3">
                <div className="flex items-start justify-between gap-3"><strong className="text-sm">{item.label}</strong><span className="text-[11px] font-semibold">{item.passed ? 'OK' : item.severity === 'blocking' ? 'BLOCKIERT' : 'HINWEIS'}</span></div>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{item.evidence}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-2xl border bg-card p-4 shadow-sm">
          <h2 className="text-lg font-semibold">In die Live Bridge übernehmen</h2>
          <p className="mt-1 text-sm text-muted-foreground">Der Server berechnet denselben Datensatz erneut und schreibt Source Snapshot, Übersetzung, Constraints und Validation in die Truth Chain.</p>
          <div className="mt-3 flex gap-2">
            <input className="min-w-0 flex-1 rounded-lg border bg-background px-3 py-2 text-sm" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="E-Mail für Anmeldung" />
            <button className="rounded-lg border px-3 py-2 text-sm font-semibold" onClick={() => void sendMagicLink()}>Link senden</button>
          </div>
          {authMessage && <p className="mt-2 text-xs text-muted-foreground">{authMessage}</p>}
          {persistError && <p className="mt-2 text-sm">{persistError}</p>}
          <button disabled={busy} className="mt-3 w-full rounded-xl border px-4 py-3 text-sm font-semibold disabled:opacity-50" onClick={() => void persist()}>{busy ? 'Speichere…' : 'Als echten Live-Fall speichern'}</button>
        </section>
      </div>
    </main>
  );
}
