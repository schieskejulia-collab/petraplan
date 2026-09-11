import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { demoConflictRecord, demoValidRecord } from "../lib/bridge-pipeline";
import { evaluateRecordWithInstanceProfile } from "../lib/bridge-profiled-evaluation";
import { demoOrderToCustomerEvidence } from "../lib/bridge-relation-demo";
import {
  buildQueryTranslationPlan,
  type CanonicalReadQuery,
  type DialectBinding,
} from "../lib/bridge-query-abstraction";
import { decideQueryReadExecution } from "../lib/bridge-query-read-gate";
import { buildQueryTraceReport } from "../lib/bridge-query-trace-report";
import type { ReadAccessDecision } from "../lib/bridge-read-access-decision";
import { buildUnifiedBridgeTraceReport } from "../lib/bridge-unified-trace-report";

const canonicalQuery: CanonicalReadQuery = {
  subject: "order",
  fields: ["orderId", "customerId"],
  predicates: [{ field: "customerId", operator: "eq", parameter: "customerId" }],
  semanticStatus: "confirmed",
  evidence: ["demo-ui: fachliche Leseabsicht bestätigt"],
};

const binding: DialectBinding = {
  dialect: "postgresql",
  dialectStatus: "confirmed",
  subjectAddress: "orders",
  subjectAddressStatus: "confirmed",
  fieldMap: {
    orderId: "AUFTRAGS_NR",
    customerId: "KUNDEN_NR",
  },
  fieldMapStatus: "confirmed",
  parameterStyle: "named",
  evidence: ["demo-ui: Dialekt, Zieladresse und Field-Map bestätigt"],
};

function statusClass(status: string) {
  if (status === "ready" || status === "confirmed") return "border-teal-200 bg-teal-50 text-teal-950";
  if (status === "refresh_required" || status === "needs_confirmation") return "border-amber-200 bg-amber-50 text-amber-950";
  return "border-rose-200 bg-rose-50 text-rose-950";
}

function statusDotClass(status: string) {
  if (status === "ready" || status === "confirmed") return "bg-teal-500";
  if (status === "refresh_required" || status === "needs_confirmation") return "bg-amber-500";
  return "bg-rose-500";
}

function statusLabel(status: string) {
  if (status === "ready" || status === "confirmed") return "bestätigt";
  if (status === "refresh_required") return "neu lesen";
  if (status === "needs_confirmation") return "Bestätigung fehlt";
  return "blockiert";
}

function domainLabel(domain: string) {
  if (domain === "source_provenance") return "Ursprung";
  if (domain === "bridge_analysis") return "Analyse";
  if (domain === "instance_relations") return "Beziehungen";
  if (domain === "query_read") return "Leseweg";
  return domain.replaceAll("_", " ");
}

export default function UnifiedTracePage() {
  const [, setLocation] = useLocation();
  const [mode, setMode] = useState<"valid" | "conflict">("valid");

  const report = useMemo(() => {
    const capturedAt = new Date().toISOString();
    const raw = mode === "valid" ? demoValidRecord : demoConflictRecord;
    const bridge = evaluateRecordWithInstanceProfile(
      raw,
      capturedAt,
      {},
      {},
      [demoOrderToCustomerEvidence],
    );

    const queryPlan = buildQueryTranslationPlan(canonicalQuery, binding);
    const readAccess: ReadAccessDecision = {
      status: "ready",
      readAllowed: true,
      refreshRequired: false,
      blockers: [],
      evidence: [
        "demo-ui: read-only Zugriff bestätigt",
        "demo-ui: adressierbarer Lesepfad bestätigt",
        "demo-ui: Snapshot innerhalb bestätigter Freshness-Grenze",
      ],
      sourcePolicy: "preserve",
      writePolicy: "forbidden",
      cachePolicy: "cache_never_source_truth",
      loadingPolicy: "addressable_read_only",
      note: "Demo/Testdaten: bestätigter read-only Lesepfad für die sichtbare Nachweisdarstellung.",
    };

    const queryGate = decideQueryReadExecution({ readAccess, queryPlan });
    const query = buildQueryTraceReport({
      canonicalQuery,
      binding,
      queryPlan,
      readAccess,
      queryGate,
    });

    return buildUnifiedBridgeTraceReport({ bridge, query });
  }, [mode]);

  const compactIdentity = [
    ["Quelle", report.identity.source],
    ["Datensatz", report.identity.sourceRecord],
    ["Snapshot", report.identity.snapshotId],
  ] as const;

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-3xl space-y-4 px-4 py-5 sm:py-6">
        <header className="space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-[0.17em] text-muted-foreground">PetraPlan · Demo/Testdaten</p>
              <h1 className="mt-1 text-2xl font-semibold sm:text-3xl">Einheitlicher Nachweisweg</h1>
              <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-muted-foreground">
                Von der Quelle bis zur Entscheidung — mit Belegen, ohne produktive Daten zu verändern.
              </p>
            </div>
            <button type="button" className="shrink-0 rounded-lg border px-3 py-2 text-sm font-semibold" onClick={() => setLocation("/cases")}>
              Zurück
            </button>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setMode("valid")}
              className={`rounded-xl border px-3 py-2.5 text-sm font-semibold ${mode === "valid" ? "bg-foreground text-background" : "bg-card"}`}
            >
              Bestätigter Fall
            </button>
            <button
              type="button"
              onClick={() => setMode("conflict")}
              className={`rounded-xl border px-3 py-2.5 text-sm font-semibold ${mode === "conflict" ? "bg-foreground text-background" : "bg-card"}`}
            >
              Konfliktfall
            </button>
          </div>
        </header>

        <section className={`rounded-2xl border p-4 ${statusClass(report.decision.status)}`}>
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.16em]">Gesamtentscheidung</p>
              <h2 className="mt-1 text-xl font-semibold">{statusLabel(report.decision.status)}</h2>
            </div>
            <div className="space-y-1 text-right text-xs">
              <p>Bridge: {report.decision.bridgeReleaseAllowed ? "freigegeben" : "blockiert"}</p>
              <p>Query: {report.decision.queryExecutable ? "ausführbar" : "nicht ausführbar"}</p>
            </div>
          </div>
          <p className="mt-3 text-sm leading-relaxed">{report.conclusion}</p>
        </section>

        <section className="rounded-2xl border bg-card p-4 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-teal-700">Provenance</p>
              <h2 className="mt-1 font-semibold">Woher dieser Stand kommt</h2>
            </div>
            <span className="rounded-full border px-2 py-1 text-[10px] font-bold uppercase tracking-wide">read-only</span>
          </div>

          <div className="mt-3 divide-y rounded-xl border bg-background/50">
            {compactIdentity.map(([label, value]) => (
              <div key={label} className="grid grid-cols-[84px_1fr] gap-3 px-3 py-2.5 text-sm">
                <span className="text-muted-foreground">{label}</span>
                <span className="min-w-0 break-all font-medium">{value}</span>
              </div>
            ))}
          </div>

          <details className="mt-3 rounded-xl border px-3 py-2.5 text-xs">
            <summary className="cursor-pointer font-semibold">Technische Herkunft anzeigen</summary>
            <div className="mt-3 space-y-2 text-muted-foreground">
              <p><span className="font-semibold text-foreground">Message-ID:</span> <span className="break-all">{report.identity.messageId}</span></p>
              <p><span className="font-semibold text-foreground">Correlation-ID:</span> <span className="break-all">{report.identity.correlationId}</span></p>
              <p><span className="font-semibold text-foreground">Erfasst:</span> {report.identity.capturedAt}</p>
            </div>
          </details>
        </section>

        <section className="rounded-2xl border bg-card p-4 shadow-sm">
          <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-teal-700">Beweisweg</p>
          <h2 className="mt-1 font-semibold">Vom Ursprung bis zur Entscheidung</h2>

          <div className="relative mt-4 pl-7">
            <div className="absolute bottom-3 left-[10px] top-3 w-px bg-border" />
            <div className="space-y-4">
              {report.evidencePath.map((step, index) => (
                <div key={`${step.domain}-${index}`} className="relative">
                  <span className={`absolute -left-7 top-3 h-5 w-5 rounded-full border-4 border-card ${statusDotClass(step.status)}`} />
                  <div className={`rounded-xl border p-3.5 ${statusClass(step.status)}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-[0.14em] opacity-70">Schritt {index + 1}</p>
                        <p className="mt-0.5 font-semibold">{domainLabel(step.domain)}</p>
                      </div>
                      <span className="shrink-0 rounded-full border px-2 py-1 text-[10px] font-bold uppercase tracking-wide">{statusLabel(step.status)}</span>
                    </div>
                    <p className="mt-2 text-sm leading-relaxed">{step.summary}</p>
                    {step.evidence.length > 0 && (
                      <details className="mt-3 text-xs">
                        <summary className="cursor-pointer font-semibold">Technische Belege ({step.evidence.length})</summary>
                        <ul className="mt-2 space-y-1 break-all text-muted-foreground">
                          {step.evidence.map((item, evidenceIndex) => <li key={`${item}-${evidenceIndex}`}>• {item}</li>)}
                        </ul>
                      </details>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="rounded-2xl border bg-card p-4 shadow-sm">
          <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-teal-700">Query-Nachweis</p>
          <h2 className="mt-1 font-semibold">Fachliche Frage → technische Darstellung</h2>

          <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
            <div className="rounded-xl border p-3">
              <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Fachlich</p>
              <p className="mt-1 font-medium">{report.queryReport.canonicalIntent.subject}</p>
            </div>
            <div className="rounded-xl border p-3">
              <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Dialekt</p>
              <p className="mt-1 font-medium">{report.queryReport.translation.dialect}</p>
            </div>
          </div>

          <details className="mt-3 rounded-xl border px-3 py-2.5 text-sm">
            <summary className="cursor-pointer font-semibold">Mapping & technische Query anzeigen</summary>
            <div className="mt-3 space-y-2">
              <p><span className="font-semibold">Felder:</span> {report.queryReport.canonicalIntent.fields.join(", ")}</p>
              <p><span className="font-semibold">Mapping:</span> {report.queryReport.translation.fieldMappings.join(" · ")}</p>
              <p><span className="font-semibold">Parameter:</span> {report.queryReport.translation.parameterNames.join(", ") || "keine"}</p>
              <pre className="mt-3 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-slate-950 p-3 text-[11px] leading-relaxed text-emerald-100">
                {report.queryReport.translation.translatedRepresentation ?? "Keine technische Query erzeugt."}
              </pre>
              <p className="text-[11px] text-muted-foreground">Es werden nur Parameternamen dargestellt, keine Parameterwerte.</p>
            </div>
          </details>
        </section>

        <section className="rounded-2xl border bg-card p-4 shadow-sm">
          <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-teal-700">Offene Punkte</p>
          <h2 className="mt-1 font-semibold">Was noch nicht als Wahrheit gilt</h2>
          {report.openPoints.length === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">Für diesen Demo-Nachweisweg sind keine offenen Punkte vorhanden.</p>
          ) : (
            <ul className="mt-3 space-y-2 text-sm">
              {report.openPoints.map((item, index) => (
                <li key={`${item}-${index}`} className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-amber-950">{item}</li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-2xl border bg-card p-4 text-sm text-muted-foreground">
          <p><span className="font-semibold text-foreground">Sicherheitsprinzip:</span> Quelle erhalten · nur read-only · Belege vor Interpretation · technische Teilfreigaben überschreiben keinen Blocker.</p>
        </section>
      </div>
    </main>
  );
}
