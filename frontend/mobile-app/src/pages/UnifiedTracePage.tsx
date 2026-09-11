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
  if (status === "ready" || status === "confirmed") return "border-teal-200 bg-teal-50 text-teal-900";
  if (status === "refresh_required" || status === "needs_confirmation") return "border-amber-200 bg-amber-50 text-amber-900";
  return "border-rose-200 bg-rose-50 text-rose-900";
}

function statusLabel(status: string) {
  if (status === "ready" || status === "confirmed") return "bestätigt";
  if (status === "refresh_required") return "neu lesen";
  if (status === "needs_confirmation") return "Bestätigung fehlt";
  return "blockiert";
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

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-4xl space-y-5 px-4 py-6">
        <header className="space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">PetraPlan · Demo/Testdaten</p>
              <h1 className="mt-1 text-3xl font-semibold">Einheitlicher Nachweisweg</h1>
              <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
                Quelle, Bridge-Analyse, Instanz-/Relationsnachweis und Query-Trace in einer Kette. Keine neue öffentliche Phase und kein produktiver Schreibzugriff.
              </p>
            </div>
            <button type="button" className="rounded-lg border px-3 py-2 text-sm font-semibold" onClick={() => setLocation("/cases")}>
              Zurück
            </button>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setMode("valid")}
              className={`rounded-lg border px-3 py-2 text-sm font-semibold ${mode === "valid" ? "bg-foreground text-background" : ""}`}
            >
              Bestätigter Demo-Fall
            </button>
            <button
              type="button"
              onClick={() => setMode("conflict")}
              className={`rounded-lg border px-3 py-2 text-sm font-semibold ${mode === "conflict" ? "bg-foreground text-background" : ""}`}
            >
              Konfliktfall
            </button>
          </div>
        </header>

        <section className={`rounded-2xl border p-5 ${statusClass(report.decision.status)}`}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.16em]">Gesamtentscheidung</p>
              <h2 className="mt-1 text-xl font-semibold">{statusLabel(report.decision.status)}</h2>
            </div>
            <div className="text-right text-xs">
              <p>Bridge: {report.decision.bridgeReleaseAllowed ? "freigegeben" : "blockiert"}</p>
              <p>Query: {report.decision.queryExecutable ? "ausführbar" : "nicht ausführbar"}</p>
            </div>
          </div>
          <p className="mt-3 text-sm leading-relaxed">{report.conclusion}</p>
        </section>

        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[
            ["Quelle", report.identity.source],
            ["Datensatz", report.identity.sourceRecord],
            ["Snapshot", report.identity.snapshotId],
            ["Message-ID", report.identity.messageId],
            ["Correlation-ID", report.identity.correlationId],
            ["Erfasst", report.identity.capturedAt],
          ].map(([label, value]) => (
            <div key={label} className="rounded-xl border bg-card p-3">
              <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
              <p className="mt-1 break-all text-sm font-medium">{value}</p>
            </div>
          ))}
        </section>

        <section className="rounded-2xl border bg-card p-4 shadow-sm">
          <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-teal-700">Beweisweg</p>
          <h2 className="mt-1 font-semibold">Vom Ursprung bis zur Query-Freigabe</h2>
          <div className="mt-4 space-y-3">
            {report.evidencePath.map((step, index) => (
              <div key={`${step.domain}-${index}`} className={`rounded-xl border p-4 ${statusClass(step.status)}`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-semibold">{index + 1}. {step.domain.replaceAll("_", " ")}</p>
                  <span className="rounded-full border px-2 py-1 text-[10px] font-bold uppercase tracking-wide">{statusLabel(step.status)}</span>
                </div>
                <p className="mt-2 text-sm leading-relaxed">{step.summary}</p>
                {step.evidence.length > 0 && (
                  <details className="mt-3 text-xs">
                    <summary className="cursor-pointer font-semibold">Belege anzeigen ({step.evidence.length})</summary>
                    <ul className="mt-2 space-y-1 break-all text-muted-foreground">
                      {step.evidence.map((item, evidenceIndex) => <li key={`${item}-${evidenceIndex}`}>• {item}</li>)}
                    </ul>
                  </details>
                )}
              </div>
            ))}
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-2">
          <div className="rounded-2xl border bg-card p-4 shadow-sm">
            <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-teal-700">Query-Nachweis</p>
            <h2 className="mt-1 font-semibold">Fachliche Frage → technische Darstellung</h2>
            <div className="mt-3 space-y-2 text-sm">
              <p><span className="font-semibold">Subjekt:</span> {report.queryReport.canonicalIntent.subject}</p>
              <p><span className="font-semibold">Felder:</span> {report.queryReport.canonicalIntent.fields.join(", ")}</p>
              <p><span className="font-semibold">Dialekt:</span> {report.queryReport.translation.dialect}</p>
              <p><span className="font-semibold">Mapping:</span> {report.queryReport.translation.fieldMappings.join(" · ")}</p>
              <p><span className="font-semibold">Parameter:</span> {report.queryReport.translation.parameterNames.join(", ") || "keine"}</p>
            </div>
            <pre className="mt-3 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-slate-950 p-3 text-[11px] leading-relaxed text-emerald-100">
              {report.queryReport.translation.translatedRepresentation ?? "Keine technische Query erzeugt."}
            </pre>
            <p className="mt-2 text-[11px] text-muted-foreground">Es werden nur Parameternamen dargestellt, keine Parameterwerte.</p>
          </div>

          <div className="rounded-2xl border bg-card p-4 shadow-sm">
            <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-teal-700">Offene Punkte</p>
            <h2 className="mt-1 font-semibold">Was noch nicht als Wahrheit gilt</h2>
            {report.openPoints.length === 0 ? (
              <p className="mt-3 text-sm text-muted-foreground">Für diesen Demo-Nachweisweg sind keine offenen Punkte vorhanden.</p>
            ) : (
              <ul className="mt-3 space-y-2 text-sm">
                {report.openPoints.map((item, index) => (
                  <li key={`${item}-${index}`} className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-950">{item}</li>
                ))}
              </ul>
            )}
          </div>
        </section>

        <section className="rounded-2xl border bg-card p-4 text-sm text-muted-foreground">
          <p><span className="font-semibold text-foreground">Sicherheitsprinzip:</span> Quelle erhalten · nur read-only · Belege vor Interpretation · technische Teilfreigaben überschreiben keinen Blocker.</p>
        </section>
      </div>
    </main>
  );
}
