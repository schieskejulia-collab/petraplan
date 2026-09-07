import { useState, type ReactNode } from "react";
import { useLocation } from "wouter";
import {
  demoConflictRecord,
  demoValidRecord,
  evaluateRecord,
  parseRawRecord,
  type IngressContext,
  type RawRecord,
  type ResponseContext,
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
  const [responseOverrides, setResponseOverrides] = useState<Partial<ResponseContext>>({});
  const [rawInput, setRawInput] = useState(() => JSON.stringify(demoValidRecord, null, 2));
  const [inputError, setInputError] = useState<string | null>(null);
  const [demoCaseActive, setDemoCaseActive] = useState(false);

  const evaluation = evaluateRecord(raw, capturedAt, ingressOverrides, responseOverrides);
  const {
    ingress,
    interactionTrace,
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

  const blockingChecks = checks.filter(({ ok, severity }) => !ok && severity === "blocking");
  const visibleBlockingCount = blockingChecks.length + gatewayIssues.length;
  const reportBlockingCount = report.errors.length;
  const effectiveBlockingCount = Math.max(visibleBlockingCount, reportBlockingCount, release.blockingIssues);
  const effectiveReleaseAllowed =
    release.releaseAllowed === true &&
    visibleBlockingCount === 0 &&
    reportBlockingCount === 0 &&
    release.blockingIssues === 0;
  const releaseConsistent =
    release.blockingIssues === visibleBlockingCount &&
    release.blockingIssues === reportBlockingCount &&
    release.releaseAllowed === (visibleBlockingCount === 0);

  const contractProblem = gatewayIssues.some(({ scope }) => scope === "contract");
  const statusProblem = issues.some(({ issue }) => issue === "UNKNOWN_STATUS");
  const quantityProblem = issues.some(({ issue }) => issue === "NEGATIVE_VALUE");
  const responsePending = interactionTrace.response.status === "pending";

  const resolutionFindings = [
    ...gatewayIssues.map(({ scope, issue, message }) => ({
      key: `${scope}-${issue}`,
      type: scope === "transport" ? "Transportproblem" : "Schnittstellenvertrag",
      title: scope === "transport" ? "Die Übertragung ist nicht sicher abgeschlossen" : "Die Vertragsversion ist nicht bestätigt",
      evidence: scope === "transport"
        ? message
        : `Empfangen wurde ${ingress.contract}; bestätigt ist ${contract.name}.`,
      diagnosis: scope === "transport"
        ? "Der Inhalt kann fachlich korrekt sein, aber der Transportzustand ist nicht zuverlässig bestätigt."
        : "Das ist kein Datenwert-Fehler. Die beiden Seiten können unterschiedliche Strukturen oder Bedeutungen erwarten.",
      safeAction: scope === "transport"
        ? "Datensatz unverändert halten und nicht weitergeben, bis der Eingang bestätigt ist."
        : "Keine Feld- oder Wertübersetzung aus der unbestätigten Version automatisch übernehmen.",
      proposal: scope === "transport"
        ? "Transport erneut bestätigen. Erst bei eindeutigem Empfang denselben Snapshot erneut durch den Prüfpfad schicken."
        : `Entweder ${ingress.contract} als neue Vertragsversion fachlich bestätigen oder eine explizite Zuordnung zu ${contract.name} hinterlegen. Erst danach darf die Bridge die Version automatisch akzeptieren.`,
    })),
    ...issues.filter(({ severity }) => severity === "blocking").map(({ issue, field, sourceValue, message }) => {
      if (issue === "UNKNOWN_STATUS") {
        return {
          key: `${field}-${issue}`,
          type: "Semantik-/Mapping-Konflikt",
          title: `STATUS=${sourceValue} ist technisch lesbar, aber fachlich nicht zugeordnet`,
          evidence: `Für STATUS=${sourceValue} existiert in der bestätigten Value-Map kein Zielwert.`,
          diagnosis: "Der Transport funktioniert und das Feld ist vorhanden. Der Knoten sitzt ausschließlich in der Bedeutung des konkreten Statuswerts.",
          safeAction: `Originalwert ${sourceValue} erhalten, keine Bedeutung erfinden und die Weitergabe dieses Werts blockieren.`,
          proposal: `Eine neue bestätigte Value-Map für STATUS=${sourceValue} anlegen. Im aktuellen Zielmodell kommen open, closed oder in_progress infrage – die Bridge wählt davon nichts ohne bestätigte fachliche Bedeutung.`,
        };
      }
      if (issue === "NEGATIVE_VALUE") {
        return {
          key: `${field}-${issue}`,
          type: "Fachlicher Datenkonflikt",
          title: `MENGE=${sourceValue} ist lesbar, verletzt aber die bestätigte Regel > 0`,
          evidence: `Der Wert wurde korrekt als Zahl erkannt. Die Regel verlangt MENGE > 0; empfangen wurde ${sourceValue}.`,
          diagnosis: "Das ist kein Übersetzungs- oder Formatproblem. Der Konflikt liegt zwischen dem gelieferten Wert und der bestätigten fachlichen Regel.",
          safeAction: "Den negativen Wert nicht korrigieren oder umdeuten; Weitergabe blockieren.",
          proposal: "Wenn die Quelle falsch ist, dort einen bestätigten positiven Mengenwert liefern. Falls negative Mengen fachlich erlaubt sein sollen, muss stattdessen die Regel > 0 bewusst geändert und versioniert bestätigt werden.",
        };
      }
      if (issue === "MISSING_REQUIRED_VALUE") {
        return {
          key: `${field}-${issue}`,
          type: "Fehlender Pflichtwert",
          title: `${field} fehlt, obwohl das Feld für diesen Vertrag erforderlich ist`,
          evidence: `Die bestätigte Regel erwartet ${field}; im eingegangenen Datensatz ist kein verwendbarer Wert vorhanden.`,
          diagnosis: "Der Knoten liegt bereits im Eingang: Für die weitere Verarbeitung fehlt eine bestätigte Information.",
          safeAction: "Keinen Ersatzwert erzeugen und die Weitergabe blockieren.",
          proposal: `Den Wert ${field} an der Quelle ergänzen. Falls das Feld fachlich nicht mehr erforderlich ist, muss stattdessen der Vertrag geändert und neu bestätigt werden.`,
        };
      }
      if (issue === "INVALID_DATE_FORMAT") {
        return {
          key: `${field}-${issue}`,
          type: "Transformationskonflikt",
          title: `DATUM=${sourceValue} kann mit der bestätigten Regel nicht eindeutig normalisiert werden`,
          evidence: `Der Quellwert ${sourceValue} passt nicht zu einer eindeutig bestätigten Datumsumwandlung.`,
          diagnosis: "Das Feld ist vorhanden, aber die Bridge kann daraus ohne zusätzliche Regel keinen sicheren kanonischen Datumswert erzeugen.",
          safeAction: "Originaldatum erhalten und keine stillschweigende Datumsumwandlung durchführen.",
          proposal: "Ein eindeutiges Quellformat bestätigen und dafür eine versionierte Transformationsregel hinterlegen. Danach kann die Bridge denselben Wert automatisch normalisieren.",
        };
      }
      return {
        key: `${field}-${issue}`,
        type: "Regelkonflikt",
        title: `${field} blockiert die Freigabe`,
        evidence: message,
        diagnosis: "Der eingegangene Wert widerspricht einer bestätigten Regel.",
        safeAction: "Wert unverändert halten und Weitergabe blockieren.",
        proposal: `Entweder ${field} an der Quelle korrigieren oder die zugrunde liegende Regel fachlich neu bestätigen.`,
      };
    }),
  ];

  const resolutionProposals = [...new Set(resolutionFindings.map(({ proposal }) => proposal))];

  const story = [
    {
      step: "1",
      title: "Nachricht kommt an",
      detail: `${ingress.transport} · ${ingress.service} · ${raw.AUFTRAGS_NR}`,
      state: ingress.transportStatus === "received" ? "ok" : "error",
      badge: ingress.transportStatus === "received" ? "angekommen" : ingress.transportStatus,
    },
    {
      step: "2",
      title: "Vertrag wird geprüft",
      detail: contractProblem ? `${ingress.contract} ist nicht bestätigt` : `${ingress.contract} passt zum bestätigten Vertrag`,
      state: contractProblem ? "error" : "ok",
      badge: contractProblem ? "Abweichung" : "passt",
    },
    {
      step: "3",
      title: "Daten werden verstanden",
      detail: statusProblem ? `STATUS ${raw.STATUS} bleibt ungeklärt` : `STATUS ${raw.STATUS} → ${mapped.status ?? "—"}`,
      state: statusProblem ? "error" : "ok",
      badge: statusProblem ? "ungeklärt" : "übersetzt",
    },
    {
      step: "4",
      title: "Regeln prüfen den Inhalt",
      detail: quantityProblem ? `MENGE ${raw.MENGE} verletzt die Regel > 0` : `MENGE ${raw.MENGE} erfüllt die Regel > 0`,
      state: quantityProblem ? "error" : "ok",
      badge: quantityProblem ? "Blocker" : "OK",
    },
    {
      step: "5",
      title: "Antwortlage bleibt sichtbar",
      detail: responsePending
        ? `Correlation ${interactionTrace.correlationId} · noch keine Antwort`
        : `${interactionTrace.response.messageId ?? "keine Message-ID"} · ${interactionTrace.response.status}`,
      state: responsePending ? "pending" : "ok",
      badge: interactionTrace.response.status,
    },
    {
      step: "6",
      title: "Bridge entscheidet",
      detail: effectiveReleaseAllowed
        ? "Keine Blocker vorhanden. Interne Freigabe ist möglich."
        : `${effectiveBlockingCount} Blocker sind lokalisiert und mit Auflösungsvorschlägen versehen.`,
      state: effectiveReleaseAllowed ? "ok" : "error",
      badge: effectiveReleaseAllowed ? "intern frei" : "blockiert",
    },
  ] as const;

  function resetResponse() {
    setResponseOverrides({});
  }

  function loadRecord(nextRecord: RawRecord) {
    setRaw(nextRecord);
    setCapturedAt(new Date().toISOString());
    setIngressOverrides({});
    resetResponse();
    setRawInput(JSON.stringify(nextRecord, null, 2));
    setInputError(null);
    setDemoCaseActive(false);
  }

  function loadEntanglementDemo() {
    const now = new Date().toISOString();
    setRaw(demoConflictRecord);
    setCapturedAt(now);
    setIngressOverrides({
      source: "legacy_orders",
      transport: "webservice",
      service: "legacy-order-service",
      operation: "pushOrder",
      interactionMode: "request_reply",
      contract: "order-v2-field-drift",
      transportStatus: "received",
      messageId: `request:A-10027:${now}`,
      correlationId: "corr:A-10027:demo",
      destination: "petraplan-bridge",
    });
    setResponseOverrides({ status: "pending", messageId: null, respondedAt: null, result: null });
    setRawInput(JSON.stringify(demoConflictRecord, null, 2));
    setInputError(null);
    setDemoCaseActive(true);
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
    resetResponse();
    setRawInput(JSON.stringify(demoValidRecord, null, 2));
    setInputError(null);
    setDemoCaseActive(false);
  }

  function simulateResponse() {
    const now = new Date().toISOString();
    setResponseOverrides({
      status: "received",
      messageId: `response:${ingress.correlationId}`,
      respondedAt: now,
      result: effectiveReleaseAllowed ? "order accepted" : "order requires clarification",
    });
  }

  function simulatePendingResponse() {
    setResponseOverrides({ status: "pending", messageId: null, respondedAt: null, result: null });
  }

  function readRawRecord() {
    try {
      loadRecord(parseRawRecord(JSON.parse(rawInput)));
    } catch (error) {
      setInputError(error instanceof Error ? error.message : "Der Datensatz konnte nicht gelesen werden.");
    }
  }

  const phases = [
    ["1", "Eingang", "Quelle, Transport, Vertrag"],
    ["2", "Übersetzung", "Semantik, Field Map, Value Map"],
    ["3", "Prüfung", "Schema, Regeln, Issues, Trace"],
    ["4", "Entscheidung", "Freigabe und Report"],
  ] as const;

  const flow = ["Source", "Snapshot", "Schema", "Missing", "Semantik", "Field Map", "Value Map", "Transformation", "Canonical", "Validierung", "Issue", "Trace", "Freigabe", "Report"];

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-5xl space-y-5 px-4 py-6 pb-12">
        <button className="rounded-lg border px-3 py-2 text-sm" onClick={() => setLocation("/cases")}>← Fälle</button>

        <header className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-teal-700">Bridge-Prototyp · Version 0.18 · Auflösungsvorschläge</p>
          <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">Vier Phasen außen. Vierzehn Schritte darunter.</h1>
          <p className="max-w-3xl text-sm text-muted-foreground md:text-base">Der Entknotungs-Check lokalisiert den Knoten, bestimmt seine Art und zeigt, was sicher getan werden kann – ohne unbestätigte Werte selbst zu erfinden.</p>
        </header>

        <section className="rounded-2xl border bg-card p-4 shadow-sm">
          <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-teal-700">Entknotungs-Check · offizielle 4 Phasen</p>
          <div className="mt-3 grid gap-3 md:grid-cols-4">
            {phases.map(([number, title, detail]) => (
              <div key={title} className="rounded-xl border border-teal-200 bg-teal-50 p-3">
                <p className="text-xs font-bold text-teal-700">{number}</p>
                <p className="mt-1 font-semibold text-teal-950">{title}</p>
                <p className="mt-1 text-xs text-teal-900/70">{detail}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b bg-slate-950 p-4 text-white">
            <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-300">Live-Story · in 10 Sekunden verständlich</p>
            <h2 className="mt-1 text-xl font-semibold">Was passiert mit diesem Datensatz?</h2>
            <p className="mt-1 text-sm text-slate-300">Von der eingehenden Nachricht bis zur Entscheidung – ohne zuerst JSON lesen zu müssen.</p>
          </div>
          <div className="p-4">
            <div className="grid gap-3 md:grid-cols-6">
              {story.map(({ step, title, detail, state, badge }, index) => {
                const stateClass = state === "ok"
                  ? "border-teal-200 bg-teal-50 text-teal-950"
                  : state === "pending"
                    ? "border-amber-200 bg-amber-50 text-amber-950"
                    : "border-red-200 bg-red-50 text-red-950";
                const badgeClass = state === "ok"
                  ? "bg-teal-100 text-teal-800"
                  : state === "pending"
                    ? "bg-amber-100 text-amber-800"
                    : "bg-red-100 text-red-800";
                return (
                  <div key={title} className="relative">
                    <div className={`h-full rounded-xl border p-3 ${stateClass}`}>
                      <div className="flex items-center justify-between gap-2">
                        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-white text-xs font-bold shadow-sm">{step}</span>
                        <span className={`rounded-full px-2 py-1 text-[10px] font-bold uppercase tracking-wide ${badgeClass}`}>{badge}</span>
                      </div>
                      <p className="mt-3 text-sm font-semibold">{title}</p>
                      <p className="mt-1 text-[11px] leading-relaxed opacity-80">{detail}</p>
                    </div>
                    {index < story.length - 1 && <span className="absolute -right-2 top-1/2 hidden -translate-y-1/2 text-slate-400 md:block">→</span>}
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4 shadow-sm">
          <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-amber-800">Demo-Entknotungsfall</p>
          <h2 className="mt-1 font-semibold text-amber-950">Eine Nachricht kommt an – aber Vertrag, Wert und Antwortlage passen nicht sauber zusammen.</h2>
          <p className="mt-2 text-sm text-amber-950/80">Der Demo-Fall simuliert eine Legacy-Schnittstelle mit einer unbestätigten Vertragsversion <strong>order-v2-field-drift</strong>, einem unbekannten Statuswert, einer negativen Menge und einer noch ausstehenden Antwort.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button className="rounded-lg bg-amber-800 px-3 py-2 text-sm font-semibold text-white" onClick={loadEntanglementDemo}>Vollständigen Demo-Fall laden</button>
            <button className="rounded-lg bg-white px-3 py-2 text-sm font-semibold text-amber-900" onClick={() => loadRecord(demoValidRecord)}>Zurück zum gültigen Fall</button>
          </div>
          {demoCaseActive && <p className="mt-3 rounded-xl border border-amber-300 bg-white p-3 text-xs font-semibold text-amber-950">Demo aktiv: Die Bridge trennt jetzt Vertrags-, Semantik- und Datenkonflikte und zeigt für jeden Knoten einen konkreten Auflösungsvorschlag.</p>}
        </section>

        <section className="rounded-2xl border border-sky-200 bg-sky-50 p-4 shadow-sm">
          <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-sky-800">Eingangskontext · vor Schritt 1</p>
          <h2 className="mt-1 font-semibold text-sky-950">Wie ist dieser Datensatz zur Bridge gekommen?</h2>
          <p className="mt-1 text-xs text-sky-900/70">Quelle, Transport, Service, Operation, Message-ID, Correlation-ID und Vertragsversion bleiben als eigener Kontext erhalten.</p>
          <details className="mt-3 rounded-xl border border-sky-200 bg-white px-3 py-2">
            <summary className="cursor-pointer text-sm font-semibold text-sky-950">Technische Eingangsdaten anzeigen</summary>
            <JsonBlock value={ingress} />
          </details>
          <div className="mt-3 flex flex-wrap gap-2">
            <button className="rounded-lg bg-sky-800 px-3 py-2 text-sm font-semibold text-white" onClick={simulateTransportTimeout}>Transport-Timeout simulieren</button>
            <button className="rounded-lg bg-white px-3 py-2 text-sm font-semibold text-sky-900" onClick={() => loadRecord(demoValidRecord)}>Transport OK</button>
          </div>
          {gatewayIssues.filter(({ scope }) => scope === "transport").map(({ issue, message }) => (
            <p key={issue} className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-xs font-semibold text-red-800">{issue}: {message}</p>
          ))}
        </section>

        <section className="rounded-2xl border border-violet-200 bg-violet-50 p-4 shadow-sm">
          <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-violet-800">Request/Response-Trace</p>
          <h2 className="mt-1 font-semibold text-violet-950">Welche Antwort gehört zu welchem Request?</h2>
          <p className="mt-1 text-xs text-violet-900/70">Die Correlation-ID verbindet Anfrage und Antwort. Eine noch ausstehende Antwort wird ausdrücklich als pending markiert statt erfunden.</p>
          <div className="mt-3 rounded-xl border border-violet-200 bg-white p-3 text-xs text-violet-950">
            <span className="font-semibold">Beweiskette:</span> {raw.AUFTRAGS_NR} → {interactionTrace.request.messageId} → {interactionTrace.correlationId} → {interactionTrace.response.messageId ?? interactionTrace.response.status}
          </div>
          <details className="mt-3 rounded-xl border border-violet-200 bg-white px-3 py-2">
            <summary className="cursor-pointer text-sm font-semibold text-violet-950">Technische Trace-Daten anzeigen</summary>
            <JsonBlock value={interactionTrace} />
          </details>
          <div className="mt-3 flex flex-wrap gap-2">
            <button className="rounded-lg bg-violet-800 px-3 py-2 text-sm font-semibold text-white" onClick={simulateResponse}>Antwort simulieren</button>
            <button className="rounded-lg bg-white px-3 py-2 text-sm font-semibold text-violet-900" onClick={simulatePendingResponse}>Antwort ausstehend</button>
          </div>
        </section>

        <nav aria-label="Technischer 14-Schritte-Prüfpfad" className="flex flex-wrap items-center gap-2 text-xs font-semibold text-teal-800">
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

          <Section eyebrow="02 · Snapshot erzeugen" title="Originalzustand unverändert sichern"><JsonBlock value={snapshot} /></Section>
          <Section eyebrow="03 · Schema prüfen" title="Entspricht die Nachricht dem bestätigten Vertrag?" wide>
            <div className="mt-3 grid gap-3 md:grid-cols-2"><div><p className="text-xs font-semibold">Bestätigter Contract</p><JsonBlock value={contract} /></div><div><p className="text-xs font-semibold">Prüfergebnis</p><JsonBlock value={schema} /></div></div>
          </Section>
          <Section eyebrow="04 · Missing-Regel prüfen" title="Ist der Quellwert laut bestätigter Regel fehlend?"><JsonBlock value={missing} /></Section>
          <Section eyebrow="05 · Semantik bestimmen" title="Was bedeutet Feld und konkreter Wert?"><JsonBlock value={semantics} /></Section>
          <Section eyebrow="06 · Field Map anwenden" title="Quellfelder neutralen Feldern zuordnen"><JsonBlock value={fieldMap} /></Section>
          <Section eyebrow="07 · Value Map anwenden" title="Quellcodes in neutrale Bedeutung übersetzen"><JsonBlock value={valueMap} /></Section>
          <Section eyebrow="08 · Transformation ausführen" title="Nur bestätigte Formate verändern"><JsonBlock value={transformations} /></Section>
          <Section eyebrow="09 · Canonical Model aufbauen" title="Neutral übersetzte Werte speichern"><JsonBlock value={mapped} /></Section>

          <Section eyebrow="10 · Validieren" title="Fachliche Regeln gegen das Ergebnis prüfen" wide>
            <div className="mt-3 grid gap-2 md:grid-cols-2">
              {checks.map(({ label, ok, rule, observed, severity }) => (
                <div key={label} className="flex items-center justify-between gap-3 rounded-xl border px-3 py-2">
                  <div><p className="text-sm font-medium">{label}</p><p className="text-[11px] text-muted-foreground">{observed} · Regel: {rule} · {severity}</p></div>
                  <span className={`rounded-full px-2 py-1 text-[11px] font-bold ${ok ? "bg-teal-50 text-teal-700" : "bg-red-50 text-red-700"}`}>{ok ? "OK" : "FEHLER"}</span>
                </div>
              ))}
            </div>
            <div className="mt-4 flex flex-wrap gap-2"><button className="rounded-lg bg-teal-700 px-3 py-2 text-sm font-semibold text-white" onClick={() => loadRecord(demoConflictRecord)}>Daten-Fehlerfall laden</button><button className="rounded-lg bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-800" onClick={() => loadRecord(demoValidRecord)}>Gültigen Fall laden</button></div>
          </Section>

          <Section eyebrow="11 · Issue erzeugen" title={(issues.length + gatewayIssues.length) ? `${issues.length + gatewayIssues.length} Abweichung${issues.length + gatewayIssues.length === 1 ? "" : "en"} dokumentiert` : "Keine Issues"}>
            {issues.length + gatewayIssues.length === 0 ? <p className="mt-3 rounded-xl bg-teal-50 p-3 text-sm text-teal-800">Keine Regelverletzung gefunden.</p> : <p className="mt-3 text-sm text-muted-foreground">Die Ursachen werden in Schritt 13 nach Problemart getrennt und mit Auflösungsvorschlägen erklärt.</p>}
            <details className="mt-3 rounded-xl border px-3 py-2"><summary className="cursor-pointer text-sm font-semibold">Technische Issues anzeigen</summary><JsonBlock value={{ gatewayIssues, issues }} /></details>
          </Section>

          <Section eyebrow="12 · Trace erzeugen" title="Jeder Wert und jede Nachricht behält seine Spur">
            <p className="mt-1 text-xs text-muted-foreground">Die technische Spur bleibt vollständig vorhanden, steht aber nicht mehr vor der verständlichen Erklärung.</p>
            <details className="mt-3 rounded-xl border px-3 py-2"><summary className="cursor-pointer text-sm font-semibold">Technischen Trace anzeigen</summary><JsonBlock value={{ interactionTrace, valueTrace: trace }} /></details>
          </Section>

          <Section eyebrow="13 · Freigabe entscheiden" title={effectiveReleaseAllowed ? "Interne Freigabe möglich" : "Freigabe blockiert – Knoten lokalisiert"} wide>
            <div className={`mt-3 rounded-2xl border p-4 ${effectiveReleaseAllowed ? "border-teal-200 bg-teal-50" : "border-red-200 bg-red-50"}`}>
              <p className="text-xs font-bold uppercase tracking-[0.14em]">Was ist die Entscheidung?</p>
              <p className={`mt-1 text-2xl font-bold ${effectiveReleaseAllowed ? "text-teal-900" : "text-red-900"}`}>{effectiveReleaseAllowed ? "Dieser Datensatz kann intern freigegeben werden." : "Dieser Datensatz darf noch nicht weitergegeben werden."}</p>
              <p className="mt-2 text-sm leading-relaxed opacity-80">{effectiveReleaseAllowed ? "Transport, Schnittstellenvertrag und fachliche Regeln sind bestätigt. Es gibt aktuell keinen bekannten Blocker." : `${effectiveBlockingCount} Blocker wurden lokalisiert. Die Bridge zeigt jetzt für jeden Knoten Problemart, Beleg, sichere Sofortmaßnahme und Auflösungsvorschlag.`}</p>
            </div>

            {!effectiveReleaseAllowed && (
              <div className="mt-4 space-y-4">
                <p className="text-sm font-bold">Was genau ist der Knoten – und wie lässt er sich auflösen?</p>
                {resolutionFindings.map(({ key, type, title, evidence, diagnosis, safeAction, proposal }, index) => (
                  <div key={key} className="overflow-hidden rounded-xl border border-red-200 bg-white">
                    <div className="border-b border-red-100 bg-red-50 p-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-xs font-bold uppercase tracking-wide text-red-700">Knoten {index + 1}</p>
                        <span className="rounded-full bg-white px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-red-800">{type}</span>
                      </div>
                      <p className="mt-2 font-semibold text-slate-950">{title}</p>
                    </div>
                    <div className="space-y-3 p-4 text-sm">
                      <div><p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Beleg</p><p className="mt-1 text-slate-700">{evidence}</p></div>
                      <div><p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Diagnose</p><p className="mt-1 text-slate-700">{diagnosis}</p></div>
                      <div className="rounded-lg border border-teal-200 bg-teal-50 p-3"><p className="text-[11px] font-bold uppercase tracking-wide text-teal-800">Was kann die Bridge jetzt sicher tun?</p><p className="mt-1 text-teal-950">{safeAction}</p></div>
                      <div className="rounded-lg border border-sky-200 bg-sky-50 p-3"><p className="text-[11px] font-bold uppercase tracking-wide text-sky-800">Auflösungsvorschlag</p><p className="mt-1 text-sky-950">{proposal}</p></div>
                    </div>
                  </div>
                ))}
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
                  <p className="text-xs font-bold uppercase tracking-wide text-amber-800">Warum löst die Bridge nicht einfach selbst auf?</p>
                  <p className="mt-1 text-sm leading-relaxed text-amber-950">Sie löst alles auf, was aus bestätigten Regeln eindeutig ableitbar ist. Wo mehrere fachliche Bedeutungen möglich sind oder eine bestätigte Regel selbst geändert werden müsste, markiert sie exakt diese Entscheidung statt eine Wahrheit zu erfinden.</p>
                </div>
              </div>
            )}

            <details className="mt-4 rounded-xl border bg-white px-3 py-2">
              <summary className="cursor-pointer text-sm font-semibold">Technischen Entscheidungsnachweis anzeigen</summary>
              <JsonBlock value={{ releaseAllowed: effectiveReleaseAllowed, blockingIssues: effectiveBlockingCount, engineRelease: release, reportErrors: report.errors }} />
              {!releaseConsistent && <p className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-2 text-xs font-semibold text-amber-900">Interne Abweichung erkannt: Engine, sichtbare Prüfungen und Report stimmen nicht überein. Die Anzeige bleibt fail-safe blockiert.</p>}
            </details>
          </Section>

          <Section eyebrow="14 · Report erzeugen" title="Was ist bekannt, wo sitzt der Knoten und wie kann er aufgelöst werden?" wide>
            <div className="mt-3 grid gap-3 md:grid-cols-3">
              <div className="rounded-xl border border-teal-200 bg-teal-50 p-4">
                <p className="text-xs font-bold uppercase tracking-wide text-teal-700">Bekannt</p>
                <p className="mt-1 text-xl font-semibold text-teal-950">{report.confirmedMappings.length} Feldnamen-Zuordnungen</p>
                <p className="mt-1 text-xs text-teal-900/70">Diese Feldnamen-Zuordnungen sind bekannt. Die Bedeutung einzelner Werte kann trotzdem noch ungeklärt sein.</p>
              </div>
              <div className={`rounded-xl border p-4 ${report.errors.length ? "border-red-200 bg-red-50" : "border-teal-200 bg-teal-50"}`}>
                <p className="text-xs font-bold uppercase tracking-wide">Lokalisierte Knoten</p>
                <p className="mt-1 text-xl font-semibold">{resolutionFindings.length}</p>
                <p className="mt-1 text-xs opacity-70">{resolutionFindings.length ? "Jeder Knoten ist nach Art, Beleg und Ursache getrennt beschrieben." : "Kein blockierender Knoten offen."}</p>
              </div>
              <div className="rounded-xl border border-sky-200 bg-sky-50 p-4">
                <p className="text-xs font-bold uppercase tracking-wide text-sky-700">Auflösung</p>
                {effectiveReleaseAllowed ? (
                  <p className="mt-1 text-sm font-semibold text-sky-950">Kein Auflösungsschritt nötig. Freigabe dokumentieren und Ausgabe übergeben.</p>
                ) : (
                  <ol className="mt-2 space-y-2 text-sm font-semibold text-sky-950">
                    {resolutionProposals.map((proposal, index) => <li key={proposal}><strong>{index + 1}.</strong> {proposal}</li>)}
                  </ol>
                )}
              </div>
            </div>
            <details className="mt-4 rounded-xl border px-3 py-2"><summary className="cursor-pointer text-sm font-semibold">Vollständigen technischen Report anzeigen</summary><JsonBlock value={report} /></details>
          </Section>
        </div>

        <section className="rounded-2xl border border-teal-200 bg-teal-50 p-4 text-sm text-teal-900">
          <p className="font-semibold">Grundprinzip</p>
          <p className="mt-1">Die Bridge soll nicht nur Fehler melden. Sie trennt den Knoten nach Problemart, zeigt den Beleg, sagt was bereits sicher getan werden kann und schlägt die konkrete Auflösung vor. Nur eine fachliche Entscheidung, die aus vorhandenen Regeln nicht eindeutig ableitbar ist, bleibt bewusst zur Bestätigung offen.</p>
        </section>
      </div>
    </main>
  );
}
