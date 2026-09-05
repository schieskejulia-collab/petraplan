import { useState, type ReactNode } from "react";
import { useLocation } from "wouter";
import {
  demoConflictRecord,
  demoValidRecord,
  evaluateRecord,
  fieldMap,
  parseRawRecord,
  type RawRecord,
} from "../lib/bridge-pipeline";

function JsonBlock({ value }: { value: unknown }) {
  return (
    <pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-slate-950 p-4 text-[11px] leading-relaxed text-emerald-100">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

function Section({ eyebrow, title, children, wide = false }: { eyebrow: string; title: string; children: ReactNode; wide?: boolean }) {
  return (
    <section className={`rounded-2xl border bg-card p-4 shadow-sm ${wide ? "md:col-span-2" : ""}`}>
      <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-teal-700">{eyebrow}</p>
      <h2 className="mt-1 font-semibold">{title}</h2>
      {children}
    </section>
  );
}

export default function BridgePage() {
  const [, setLocation] = useLocation();
  const [raw, setRaw] = useState<RawRecord>(demoValidRecord);
  const [rawInput, setRawInput] = useState(() => JSON.stringify(demoValidRecord, null, 2));
  const [inputError, setInputError] = useState<string | null>(null);
  const { mapped, checks, passed, provenance } = evaluateRecord(raw, new Date().toISOString().slice(0, 10));

  function loadRecord(nextRecord: RawRecord) {
    setRaw(nextRecord);
    setRawInput(JSON.stringify(nextRecord, null, 2));
    setInputError(null);
  }

  function readRawRecord() {
    try {
      loadRecord(parseRawRecord(JSON.parse(rawInput)));
    } catch (error) {
      setInputError(error instanceof Error ? error.message : "Der Datensatz konnte nicht gelesen werden.");
    }
  }

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-5xl space-y-5 px-4 py-6 pb-12">
        <button className="rounded-lg border px-3 py-2 text-sm" onClick={() => setLocation("/cases")}>← Fälle</button>

        <header className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-teal-700">Bridge-Prototyp · Version 0.4</p>
          <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">Auftrag lesbar machen, ohne die Quelle anzufassen.</h1>
          <p className="max-w-2xl text-sm text-muted-foreground md:text-base">Ein read-only Ablauf vom Quellwert über die FIELD-MAP bis zur nachvollziehbaren Ausgabe.</p>
        </header>

        <nav aria-label="Datenfluss" className="flex flex-wrap items-center gap-2 text-sm font-semibold text-teal-800">
          {["Rohdaten", "FIELD-MAP", "Prüfung", "Ausgabe"].map((label, index) => (
            <span key={label} className="flex items-center gap-2">
              <span className="rounded-full border border-teal-200 bg-teal-50 px-3 py-2">{label}</span>
              {index < 3 && <span className="text-slate-400">→</span>}
            </span>
          ))}
        </nav>

        <div className="grid gap-4 md:grid-cols-2">
          <Section eyebrow="01 · Quelle" title="Unveränderte Rohdaten">
            <p className="mt-1 text-xs text-muted-foreground">So kommt der Datensatz aus System A an.</p>
            <details className="mt-3 rounded-xl border px-3 py-2">
              <summary className="cursor-pointer text-sm font-semibold">Rohdatensatz einlesen</summary>
              <p className="mt-2 text-xs text-muted-foreground">Ein JSON-Datensatz wird erst nach dem Einlesen durch dieselbe Pipeline geprüft.</p>
              <textarea
                aria-label="Rohdatensatz als JSON"
                className="mt-3 min-h-40 w-full rounded-lg border bg-background p-3 font-mono text-xs"
                value={rawInput}
                onChange={(event) => setRawInput(event.target.value)}
                spellCheck={false}
              />
              <button className="mt-2 rounded-lg bg-teal-700 px-3 py-2 text-sm font-semibold text-white" onClick={readRawRecord}>Datensatz einlesen</button>
              {inputError && <p className="mt-2 text-xs font-medium text-red-700" role="alert">{inputError}</p>}
            </details>
            <JsonBlock value={raw} />
          </Section>

          <Section eyebrow="02 · Übersetzung" title="FIELD-MAP">
            <div className="mt-3 hidden overflow-x-auto md:block">
              <table className="w-full text-left text-xs">
                <thead className="text-muted-foreground">
                  <tr className="border-b">
                    <th className="px-2 py-2 font-semibold uppercase tracking-wide">Quelle</th>
                    <th className="px-2 py-2 font-semibold uppercase tracking-wide">Ziel</th>
                    <th className="px-2 py-2 font-semibold uppercase tracking-wide">Regel</th>
                  </tr>
                </thead>
                <tbody>
                  {fieldMap.map(([source, target, rule]) => (
                    <tr key={source} className="border-b last:border-0">
                      <td className="px-2 py-2 font-mono">{source}</td>
                      <td className="px-2 py-2 font-mono text-teal-700">{target}</td>
                      <td className="px-2 py-2 text-muted-foreground">{rule}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-3 space-y-2 md:hidden">
              {fieldMap.map(([source, target, rule]) => (
                <div key={source} className="rounded-xl border p-3">
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-mono text-xs font-semibold">{source}</span>
                    <span className="text-xs text-slate-400">→</span>
                    <span className="font-mono text-xs font-semibold text-teal-700">{target}</span>
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">Regel: {rule}</p>
                </div>
              ))}
            </div>
          </Section>

          <Section eyebrow="03 · Ergebnis" title="Übersetzte Daten">
            <JsonBlock value={mapped} />
          </Section>

          <Section eyebrow="04 · Nachweis" title={passed ? "Prüfung bestanden" : "Prüfung offen"}>
            <p className="mt-2 rounded-xl border border-teal-100 bg-teal-50 px-3 py-2 text-xs text-teal-800">Prüfung und Übersetzung beziehen sich auf denselben Auswertungssnapshot.</p>
            <div className="mt-3 space-y-2">
              {checks.map(({ label, ok, rule, observed }) => (
                <div key={label} className="flex items-center justify-between gap-3 rounded-xl border px-3 py-2">
                  <div>
                    <p className="text-sm font-medium">{label}</p>
                    <p className="text-[11px] text-muted-foreground">{observed} · Regel: {rule}</p>
                  </div>
                  <span className={`rounded-full px-2 py-1 text-[11px] font-bold ${ok ? "bg-teal-50 text-teal-700" : "bg-red-50 text-red-700"}`}>
                    {ok ? "OK" : "FEHLER"}
                  </span>
                </div>
              ))}
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <button className="rounded-lg bg-teal-700 px-3 py-2 text-sm font-semibold text-white" onClick={() => loadRecord(demoConflictRecord)}>Fehlerfall-Beispiel laden</button>
              <button className="rounded-lg bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-800" onClick={() => loadRecord(demoValidRecord)}>Gültigen Fall laden</button>
            </div>
          </Section>

          <Section eyebrow="05 · Herkunft" title="Jeder Wert bleibt nachvollziehbar" wide>
            <JsonBlock value={provenance} />
            <p className="mt-3 text-xs text-muted-foreground">Die Bridge schreibt nichts in System A. Sie liest, übersetzt, prüft und zeigt den Status transparent an.</p>
          </Section>
        </div>
      </div>
    </main>
  );
}
