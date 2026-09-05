import { useMemo, useState, type ReactNode } from "react";
import { useLocation } from "wouter";

type RawRecord = {
  KUNDEN_NR: string;
  AUFTRAGS_NR: string;
  STATUS: string;
  MENGE: string;
  DATUM: string;
};

type MappedRecord = {
  customerId: string;
  orderId: string;
  status: "open" | "closed" | "in_progress" | null;
  quantity: number;
  orderDate: string;
};

const validRecord: RawRecord = {
  KUNDEN_NR: "4711",
  AUFTRAGS_NR: "A-10027",
  STATUS: "OFFEN",
  MENGE: "12",
  DATUM: "2026-09-05",
};

const conflictRecord: RawRecord = {
  ...validRecord,
  STATUS: "UNBEKANNT",
  MENGE: "-4",
};

const fieldMap = [
  ["KUNDEN_NR", "customerId", "unverändert"],
  ["AUFTRAGS_NR", "orderId", "eindeutig"],
  ["STATUS", "status", "OFFEN → open"],
  ["MENGE", "quantity", "Text → Zahl"],
  ["DATUM", "orderDate", "ISO-Format"],
] as const;

function mapRecord(source: RawRecord): MappedRecord {
  const statusMap: Record<string, MappedRecord["status"]> = {
    OFFEN: "open",
    GESCHLOSSEN: "closed",
    IN_BEARBEITUNG: "in_progress",
  };

  return {
    customerId: source.KUNDEN_NR,
    orderId: source.AUFTRAGS_NR,
    status: statusMap[source.STATUS] ?? null,
    quantity: Number(source.MENGE),
    orderDate: source.DATUM,
  };
}

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
  const [raw, setRaw] = useState<RawRecord>(validRecord);
  const mapped = useMemo(() => mapRecord(raw), [raw]);
  const checks = useMemo(() => [
    { label: "Kunden-ID vorhanden", ok: Boolean(raw.KUNDEN_NR), rule: "Pflichtfeld", observed: `KUNDEN_NR: ${raw.KUNDEN_NR || "—"}` },
    { label: "Auftragsnummer eindeutig", ok: raw.AUFTRAGS_NR === "A-10027", rule: "Beispielprüfung", observed: `AUFTRAGS_NR: ${raw.AUFTRAGS_NR}` },
    { label: "Status erlaubt", ok: mapped.status !== null, rule: "OFFEN / GESCHLOSSEN / IN_BEARBEITUNG", observed: `STATUS: ${raw.STATUS} → ${mapped.status ?? "nicht zugeordnet"}` },
    { label: "Menge größer als 0", ok: Number.isFinite(mapped.quantity) && mapped.quantity > 0, rule: "Zahl > 0", observed: `MENGE: ${Number.isFinite(mapped.quantity) ? mapped.quantity : raw.MENGE}` },
    { label: "Datum gültig", ok: /^\d{4}-\d{2}-\d{2}$/.test(raw.DATUM), rule: "YYYY-MM-DD", observed: `DATUM: ${raw.DATUM}` },
  ], [mapped, raw]);
  const passed = checks.every(({ ok }) => ok);
  const provenance = {
    source: "system_a",
    sourceRecord: raw.AUFTRAGS_NR,
    capturedAt: "2026-09-05",
    mode: "read_only",
    overallStatus: passed ? "valid" : "needs_review",
    conflicts: checks.filter(({ ok }) => !ok).map(({ label }) => label),
  };

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-5xl space-y-5 px-4 py-6 pb-12">
        <button className="rounded-lg border px-3 py-2 text-sm" onClick={() => setLocation("/cases")}>← Fälle</button>

        <header className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-teal-700">Bridge-Prototyp · Version 0.1</p>
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
              <button className="rounded-lg bg-teal-700 px-3 py-2 text-sm font-semibold text-white" onClick={() => setRaw(conflictRecord)}>Fehlerfall testen</button>
              <button className="rounded-lg bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-800" onClick={() => setRaw(validRecord)}>Gültigen Fall laden</button>
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
