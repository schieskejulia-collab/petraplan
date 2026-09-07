import { useState, type ReactNode } from "react";
import { useLocation } from "wouter";
import {
  demoConflictRecord,
  demoValidRecord,
  evaluateRecord,
  parseRawRecord,
  type IngressContext,
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
  const [capturedAt, setCapturedAt] = useState(() => new Date().toISOString());
  const [ingressOverrides, setIngressOverrides] = useState<Partial<IngressContext>>({});
  const [rawInput, setRawInput] = useState(() => JSON.stringify(demoValidRecord, null, 2));
  const [inputError, setInputError] = useState<string | null>(null);

  const evaluation = evaluateRecord(raw, capturedAt, ingressOverrides);
  const {
    ingress,
    contract,
    gatewayIssues,
    snapshot,
    schema,
    missing,
    semantics,
    fieldMap,
    valueMap,
    transformations,
    mapped,
    checks,
    issues,
    trace,
    release,
    report,
  } = evaluation;

  // Fail-safe release gate: transport/contract blockers and failed data checks
  // are counted independently, but they converge on one release decision.
  const blockingChecks = checks.filter(({ ok, severity }) => !ok && severity === "blocking");
  const effectiveBlockingCount = blockingChecks.length + gatewayIssues.length;
  const effectiveReleaseAllowed = effectiveBlockingCount === 0;
  const releaseConsistent =
    release.blockingIssues === effectiveBlockingCount &&
    release.releaseAllowed === effectiveReleaseAllowed;

  function loadRecord(nextRecord: RawRecord) {
    setRaw(nextRecord);
    setCapturedAt(new Date().toISOString());
    setIngressOverrides({});
    setRawInput(JSON.stringify(nextRecord, null, 2));
    setInputError(null);
  }

  function simulateTransportTimeout() {
    setRaw(demoValidRecord);
    setCapturedAt(new Date().toISOString());
    setIngressOverrides({
      transport: "webservice",
      service: "orders-service",
      operation: "receiveOrder",
      interactionMode: "request_reply",
      contract: "order-v1",
      transportStatus: "timeout",
    });
    setRawInput(JSON.stringify(demoValidRecord, null, 2));
    setInputError(null);
  }

  function readRawRecord() {
    try {
      loadRecord(parseRawRecord(JSON.parse(rawInput)));
    } catch (error) {
      setInputError(error instanceof Error ? error.message : "Der Datensatz konnte nicht gelesen werden.");
    }
  }

  const flow = [
    "Source",
    "Snapshot",
    "Schema",
    "Missing",
    "Semantik",
    "Field Map",
    "Value Map",
    "Transformation",
    "Canonical",
    "Validierung",
    "Issue",
    "Trace",
    "Freigabe",
    "Report",
  ];

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-5xl space-y-5 px-4 py-6 pb-12">
        <button className="rounded-lg border px-3 py-2 text-sm" onClick={() => setLocation("/cases")}>← Fälle</button>

        <header className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-teal-700">Bridge-Prototyp · Version 0.11 · Schnittstellenvertrag</p>
          <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">Der 14-Schritte-Entknotungs-Check läuft als sichtbarer Prüfpfad.</h1>
          <p className="max-w-3xl text-sm text-muted-foreground md:text-base">Transportfehler, Vertragsabweichungen und Datenfehler werden getrennt erkannt. Kein Wert wird stillschweigend umgedeutet.</p>
        </header>

        <section className="rounded-2xl border border-sky-200 bg-sky-50 p-4 shadow-sm">
          <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-sky-800">Eingangskontext · vor Schritt 1</p>
          <h2 className="mt-1 font-semibold text-sky-950">Wie ist dieser Datensatz zur Bridge gekommen?</h2>
          <p className="mt-1 text-xs text-sky-900/70">Quelle, Transport, Service, Operation, Interaktionsart, Message-ID, Correlation-ID und Vertragsversion bleiben als eigener Kontext erhalten.</p>
          <JsonBlock value={ingress} />
          <div className="mt-3 flex flex-wrap gap-2">
            <button className="rounded-lg bg-sky-800 px-3 py-2 text-sm font-semibold text-white" onClick={simulateTransportTimeout}>Transport-Timeout simulieren</button>
            <button className="rounded-lg bg-white px-3 py-2 text-sm font-semibold text-sky-900" onClick={() => loadRecord(demoValidRecord)}>Transport OK</button>
          </div>
          {gatewayIssues.filter(({ scope }) => scope === "transport").map(({ issue, message }) => (
            <p key={issue} className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-xs font-semibold text-red-800">{issue}: {message}</p>
          ))}
        </section>

        <nav aria-label="Datenfluss" className="flex flex-wrap items-center gap-2 text-xs font-semibold text-teal-800">
          {flow.map((label, index) => (
            <span key={label} className="flex items-center gap-2">
              <span className="rounded-full border border-teal-200 bg-teal-50 px-3 py-2">{index + 1}. {label}</span>
              {index < flow.length - 1 && <span className="text-slate-400">→</span>}
            </span>
          ))}
        </nav>

        <div className="grid gap-4 md:grid-cols-2">
          <Section eyebrow="01 · Source empfangen" title="Rohdatensatz entgegennehmen">
            <p className="mt-1 text-xs text-muted-foreground">Die Quelle wird zuerst gelesen, nicht verändert.</p>
            <details className="mt-3 rounded-xl border px-3 py-2">
              <summary className="cursor-pointer text-sm font-semibold">Eigenen Demo-Datensatz einlesen</summary>
              <textarea aria-label="Rohdatensatz als JSON" className="mt-3 min-h-40 w-full rounded-lg border bg-background p-3 font-mono text-xs" value={rawInput} onChange={(event) => setRawInput(event.target.value)} spellCheck={false} />
              <button className="mt-2 rounded-lg bg-teal-700 px-3 py-2 text-sm font-semibold text-white" onClick={readRawRecord}>Datensatz einlesen</button>
              {inputError && <p className="mt-2 text-xs font-medium text-red-700" role="alert">{inputError}</p>}
            </details>
            <JsonBlock value={raw} />
          </Section>

          <Section eyebrow="02 · Snapshot erzeugen" title="Originalzustand unverändert sichern">
            <p className="mt-1 text-xs text-muted-foreground">Quelle, Service, Operation, Vertrag, Message-ID, Correlation-ID, Zeitpunkt und Originalwerte bilden gemeinsam den Nachweis.</p>
            <JsonBlock value={snapshot} />
          </Section>

          <Section eyebrow="03 · Schema prüfen" title="Entspricht die Nachricht dem bestätigten Vertrag?" wide>
            <p className="mt-1 text-xs text-muted-foreground">Bevor fachlich übersetzt wird, prüft die Bridge Struktur, Datentyp und Format gegen den bestätigten Schnittstellenvertrag.</p>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <div>
                <p className="text-xs font-semibold">Bestätigter Contract</p>
                <JsonBlock value={contract} />
              </div>
              <div>
                <p className="text-xs font-semibold">Prüfergebnis der eingegangenen Nachricht</p>
                <JsonBlock value={schema} />
              </div>
            </div>
            {gatewayIssues.filter(({ scope }) => scope === "contract").map(({ issue, message }) => (
              <p key={issue} className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-xs font-semibold text-red-800">{issue}: {message}</p>
            ))}
          </Section>

          <Section eyebrow="04 · Missing-Regel prüfen" title="Ist der Quellwert laut bestätigter Regel fehlend?">
            <p className="mt-1 text-xs text-muted-foreground">0 wird nicht automatisch als fehlend behandelt. Nur explizit bestätigte Marker zählen.</p>
            <JsonBlock value={missing} />
          </Section>

          <Section eyebrow="05 · Semantik bestimmen" title="Was bedeutet Feld und konkreter Wert?">
            <p className="mt-1 text-xs text-muted-foreground">Technische Bezeichnung und fachliche Bedeutung werden getrennt dokumentiert.</p>
            <JsonBlock value={semantics} />
          </Section>

          <Section eyebrow="06 · Field Map anwenden" title="Quellfelder neutralen Feldern zuordnen">
            <JsonBlock value={fieldMap} />
          </Section>

          <Section eyebrow="07 · Value Map anwenden" title="Quellcodes in neutrale Bedeutung übersetzen">
            <p className="mt-1 text-xs text-muted-foreground">Nur bestätigte Codes werden übersetzt. Unbekannte Werte bleiben ungeklärt statt erraten.</p>
            <JsonBlock value={valueMap} />
          </Section>

          <Section eyebrow="08 · Transformation ausführen" title="Nur bestätigte Formate verändern">
            <p className="mt-1 text-xs text-muted-foreground">Beispiel: 07.09.2026 → 2026-09-07. Der Originalwert bleibt im Snapshot erhalten.</p>
            <JsonBlock value={transformations} />
          </Section>

          <Section eyebrow="09 · Canonical Model aufbauen" title="Neutral übersetzte Werte speichern">
            <p className="mt-1 text-xs text-muted-foreground">Ab hier gelten nur die kanonischen Feldnamen und bestätigten Transformationen.</p>
            <JsonBlock value={mapped} />
          </Section>

          <Section eyebrow="10 · Validieren" title="Fachliche Regeln gegen das Ergebnis prüfen" wide>
            <p className="mt-1 text-xs text-muted-foreground">Diese Prüfung bewertet die Daten. Transport- und Vertragsprobleme bleiben davon getrennte Fehlerklassen.</p>
            <div className="mt-3 grid gap-2 md:grid-cols-2">
              {checks.map(({ label, ok, rule, observed, severity }) => (
                <div key={label} className="flex items-center justify-between gap-3 rounded-xl border px-3 py-2">
                  <div>
                    <p className="text-sm font-medium">{label}</p>
                    <p className="text-[11px] text-muted-foreground">{observed} · Regel: {rule} · {severity}</p>
                  </div>
                  <span className={`rounded-full px-2 py-1 text-[11px] font-bold ${ok ? "bg-teal-50 text-teal-700" : "bg-red-50 text-red-700"}`}>{ok ? "OK" : "FEHLER"}</span>
                </div>
              ))}
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <button className="rounded-lg bg-teal-700 px-3 py-2 text-sm font-semibold text-white" onClick={() => loadRecord(demoConflictRecord)}>Daten-Fehlerfall laden</button>
              <button className="rounded-lg bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-800" onClick={() => loadRecord(demoValidRecord)}>Gültigen Fall laden</button>
            </div>
          </Section>

          <Section eyebrow="11 · Issue erzeugen" title={(issues.length + gatewayIssues.length) ? `${issues.length + gatewayIssues.length} Abweichung${issues.length + gatewayIssues.length === 1 ? "" : "en"} dokumentiert` : "Keine Issues"}>
            {(issues.length + gatewayIssues.length) ? (
              <>
                {gatewayIssues.length > 0 && <JsonBlock value={gatewayIssues} />}
                {issues.length > 0 && <JsonBlock value={issues} />}
              </>
            ) : <p className="mt-3 rounded-xl bg-teal-50 p-3 text-sm text-teal-800">Keine Regelverletzung gefunden.</p>}
          </Section>

          <Section eyebrow="12 · Trace erzeugen" title="Jeder Wert behält seine Spur">
            <p className="mt-1 text-xs text-muted-foreground">Eingangskontext und Vertrag bleiben im Snapshot; jeder Datenwert behält zusätzlich seine eigene Übersetzungs- und Prüfspur.</p>
            <JsonBlock value={trace} />
          </Section>

          <Section eyebrow="13 · Freigabe entscheiden" title={effectiveReleaseAllowed ? "Freigabe erlaubt" : "Freigabe blockiert"}>
            <div className={`mt-3 rounded-xl border p-4 ${effectiveReleaseAllowed ? "border-teal-200 bg-teal-50" : "border-red-200 bg-red-50"}`}>
              <p className={`text-lg font-bold ${effectiveReleaseAllowed ? "text-teal-800" : "text-red-800"}`}>releaseAllowed = {String(effectiveReleaseAllowed)}</p>
              <p className="mt-2 text-sm text-muted-foreground">
                {effectiveReleaseAllowed
                  ? "Transport, Vertrag und Datenprüfung enthalten kein BLOCKING-Issue."
                  : `${effectiveBlockingCount} BLOCKING-Issue${effectiveBlockingCount === 1 ? "" : "s"} aus Transport, Vertrag oder Datenprüfung vorhanden. Freigabe blockiert.`}
              </p>
              <p className="mt-2 text-xs font-semibold">BLOCKING-Issues gesamt: {effectiveBlockingCount}</p>
              {!releaseConsistent && (
                <p className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-2 text-xs font-semibold text-amber-900">
                  Interne Abweichung erkannt: Die Engine-Release-Angabe stimmt nicht mit den sichtbaren BLOCKING-Prüfungen überein. Die Anzeige bleibt fail-safe blockiert.
                </p>
              )}
            </div>
          </Section>

          <Section eyebrow="14 · Report erzeugen" title="Bestätigt, offen, fehlerhaft, nächster Schritt">
            <JsonBlock value={report} />
          </Section>
        </div>

        <section className="rounded-2xl border border-teal-200 bg-teal-50 p-4 text-sm text-teal-900">
          <p className="font-semibold">Grundprinzip</p>
          <p className="mt-1">Die Bridge schreibt nichts zurück in System A. Sie trennt Transport, Schnittstellenvertrag und fachliche Datenprüfung, bevor eine Freigabe nachvollziehbar erlaubt oder blockiert wird.</p>
        </section>
      </div>
    </main>
  );
}