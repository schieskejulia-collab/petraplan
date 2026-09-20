import { useEffect, useMemo, useState } from "react";
import { useLocation, useRoute } from "wouter";
import { milaApi, type CaseTrace } from "@/api/connector";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function label(value: unknown) {
  const raw = String(value ?? "offen").toLowerCase();
  if (raw === "trusted") return "FREIGEGEBEN";
  if (raw === "blocked") return "BLOCKIERT";
  if (raw === "revoked") return "WIDERRUFEN";
  if (raw === "exception") return "AUSNAHME";
  if (["passed", "pass", "valid", "validated", "approved", "success"].includes(raw)) return "BESTANDEN";
  if (raw === "failed") return "FEHLGESCHLAGEN";
  return raw.toUpperCase();
}

function JsonValue({ value }: { value: unknown }) {
  return (
    <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-muted/50 p-3 text-[11px] leading-relaxed">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

function FieldTable({ source, target }: { source: Record<string, unknown>; target: Record<string, unknown> }) {
  const rows = useMemo(() => {
    const keys = [...new Set([...Object.keys(source), ...Object.keys(target)])];
    return keys.map((key) => ({ key, source: source[key], target: target[key] }));
  }, [source, target]);

  return (
    <div className="overflow-hidden rounded-xl border">
      <div className="grid grid-cols-[0.9fr_1fr_1fr] bg-muted/60 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        <span>Feld</span><span>Quelle</span><span>Ziel</span>
      </div>
      {rows.map((row) => (
        <div key={row.key} className="grid grid-cols-[0.9fr_1fr_1fr] gap-2 border-t px-3 py-2 text-xs">
          <span className="font-medium break-all">{row.key}</span>
          <span className="break-all text-muted-foreground">{String(row.source ?? "—")}</span>
          <span className="break-all">{String(row.target ?? "—")}</span>
        </div>
      ))}
    </div>
  );
}

export default function LiveBridgePage() {
  const [, params] = useRoute("/bridge/:caseId");
  const [, setLocation] = useLocation();
  const caseId = params?.caseId ?? "";
  const [data, setData] = useState<CaseTrace | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    if (!caseId) return;
    setLoading(true);
    setError(null);
    try {
      setData(await milaApi.caseTrace(caseId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Bridge-Fall konnte nicht geladen werden.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [caseId]);

  if (loading) return <main className="min-h-screen p-5 text-sm text-muted-foreground">Lade Live-Bridge…</main>;
  if (error || !data) {
    return (
      <main className="min-h-screen p-5">
        <button className="mb-4 rounded-lg border px-3 py-2 text-sm" onClick={() => setLocation("/cases")}>← Fälle</button>
        <div className="rounded-xl border p-4 text-sm">{error ?? "Fall nicht gefunden."}</div>
      </main>
    );
  }

  const ingestion = data.source.ingestion;
  const rawPayload = isRecord(ingestion?.raw_payload) ? ingestion.raw_payload : data.source.record;
  const extracted = data.semantic.extracted_schema;
  const mappedPayload = isRecord(extracted?.mapped_payload)
    ? extracted.mapped_payload
    : isRecord(data.semantic.metadata?.mapped_payload)
      ? data.semantic.metadata.mapped_payload as Record<string, unknown>
      : {};
  const authoritative = data.validation.authoritative;
  const review = data.review.current;
  const release = data.release.effective_status;
  const gate = data.release.gate;

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-3xl px-4 py-5 pb-16">
        <header className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">PetraPlan · Live Bridge</p>
            <h1 className="mt-1 truncate text-2xl font-semibold">{data.title}</h1>
            <p className="mt-1 text-xs text-muted-foreground">{String(ingestion?.source_system ?? data.source.record.source_system ?? "Quelle unbekannt")} · Case {data.id.slice(0, 8)}</p>
          </div>
          <button className="shrink-0 rounded-lg border px-3 py-2 text-sm" onClick={() => setLocation("/cases")}>Zurück</button>
        </header>

        <section className="mb-4 rounded-2xl border bg-card p-4 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Aktueller Zustand</p>
              <p className="mt-1 text-xl font-semibold">{label(release ?? data.status)}</p>
            </div>
            <div className="text-right text-xs text-muted-foreground">
              <p>{data.conflict.conflicts.length} Konflikt{data.conflict.conflicts.length === 1 ? "" : "e"}</p>
              <p>Validation: {label(authoritative?.status)}</p>
            </div>
          </div>
          {gate && <p className="mt-3 text-sm leading-relaxed">{gate.reason}</p>}
        </section>

        <section className="mb-4 space-y-3 rounded-2xl border bg-card p-4 shadow-sm">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Quelle → Übersetzung</p>
            <h2 className="mt-1 text-lg font-semibold">Was die Bridge tatsächlich sieht</h2>
          </div>
          {Object.keys(mappedPayload).length > 0 ? (
            <FieldTable source={rawPayload} target={mappedPayload} />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <p className="mb-2 text-xs font-semibold text-muted-foreground">SOURCE</p>
                <JsonValue value={rawPayload} />
              </div>
              <div>
                <p className="mb-2 text-xs font-semibold text-muted-foreground">ÜBERSETZUNG</p>
                <JsonValue value={extracted ?? data.semantic.metadata} />
              </div>
            </div>
          )}
          {Boolean(ingestion?.source_hash) && <p className="break-all text-[11px] text-muted-foreground">Source hash: {String(ingestion?.source_hash)}</p>}
        </section>

        {data.conflict.conflicts.length > 0 && (
          <section className="mb-4 rounded-2xl border bg-card p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="text-lg font-semibold">Offene Punkte</h2>
              <span className="rounded-full border px-2 py-1 text-[11px] font-semibold">{data.conflict.conflicts.length}</span>
            </div>
            <div className="space-y-2">
              {data.conflict.conflicts.map((conflict, index) => (
                <div key={String(conflict.id ?? index)} className="rounded-xl border p-3">
                  <p className="text-sm font-semibold">{String(conflict.title ?? conflict.conflict_type ?? conflict.type ?? `Konflikt ${index + 1}`)}</p>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{String(conflict.description ?? conflict.reason ?? conflict.message ?? "Kein Beschreibungstext gespeichert.")}</p>
                </div>
              ))}
            </div>
          </section>
        )}

        <section className="rounded-2xl border bg-card p-4 shadow-sm">
          <h2 className="text-lg font-semibold">Entscheidung</h2>
          <div className="mt-3 divide-y rounded-xl border">
            <div className="flex justify-between gap-4 px-3 py-2 text-sm"><span className="text-muted-foreground">Validation</span><strong>{label(authoritative?.status)}</strong></div>
            <div className="flex justify-between gap-4 px-3 py-2 text-sm"><span className="text-muted-foreground">Review</span><strong>{review?.complete ? label(review.decision ?? "vollständig") : "OFFEN"}</strong></div>
            <div className="flex justify-between gap-4 px-3 py-2 text-sm"><span className="text-muted-foreground">Berechtigung im Review</span><strong>{review?.reviewer_authorized === true ? "BESTÄTIGT" : "NICHT BELEGT"}</strong></div>
            <div className="flex justify-between gap-4 px-3 py-2 text-sm"><span className="text-muted-foreground">Release</span><strong>{label(release)}</strong></div>
          </div>

          {review && !review.complete && review.missing.length > 0 && (
            <p className="mt-3 text-xs leading-relaxed text-muted-foreground">Noch fehlend: {review.missing.join(", ")}</p>
          )}

          <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
            Diese Ansicht liest den gespeicherten Fall, seine echte Ingestion, Konflikte, maßgebliche Validation, Review Truth und Release Truth. Es werden keine Demo-Zustände erzeugt.
          </p>
        </section>
      </div>
    </main>
  );
}
