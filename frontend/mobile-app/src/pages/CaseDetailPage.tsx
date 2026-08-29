import { useEffect, useState, type ReactNode } from "react";
import { useLocation, useRoute } from "wouter";
import { milaApi, type CaseTrace } from "@/api/connector";

function JsonBlock({ value }: { value: unknown }) {
  return (
    <pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-muted/60 p-3 text-[11px] leading-relaxed">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

function Stage({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl border bg-card p-4 shadow-sm">
      <div className="mb-3">
        <h2 className="font-semibold">{title}</h2>
        <p className="mt-1 text-xs text-muted-foreground">{subtitle}</p>
      </div>
      {children}
    </section>
  );
}

export default function CaseDetailPage() {
  const [, params] = useRoute("/cases/:caseId");
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
      setError(err instanceof Error ? err.message : "Truth Trace konnte nicht geladen werden.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [caseId]);

  if (loading) return <main className="min-h-screen p-6 text-sm text-muted-foreground">Lade Truth Trace…</main>;

  if (error || !data) {
    return (
      <main className="min-h-screen p-6">
        <button className="mb-4 rounded-lg border px-3 py-2 text-sm" onClick={() => setLocation("/cases")}>← Fälle</button>
        <div className="rounded-xl border p-4">
          <p className="text-sm">{error ?? "Fall nicht gefunden."}</p>
          <button className="mt-3 rounded-lg border px-3 py-2 text-sm" onClick={() => void load()}>Erneut versuchen</button>
        </div>
      </main>
    );
  }

  const latestCertificate = data.release.certificates.at(-1);
  const latestStatus = data.release.status_history.at(-1);
  const releaseStatus = String(latestStatus?.new_status ?? latestCertificate?.release_status ?? "open");

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-3xl space-y-4 px-4 py-6 pb-12">
        <button className="rounded-lg border px-3 py-2 text-sm" onClick={() => setLocation("/cases")}>← Fälle</button>

        <header className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-3xl font-semibold">{data.title}</h1>
            <span className="rounded-full border px-2 py-1 text-[11px] font-semibold">{releaseStatus.toUpperCase()}</span>
          </div>
          <p className="text-sm text-muted-foreground">{data.category} · Case {data.id.slice(0, 8)}</p>
        </header>

        <Stage title="Source Truth" subtitle="Unveränderte Herkunft und Referenz">
          <JsonBlock value={data.source} />
        </Stage>

        <Stage title="Semantic Truth" subtitle="Bedeutung und normalisierte Interpretation">
          <p className="text-sm">{data.semantic.meaning}</p>
          <JsonBlock value={{ metadata: data.semantic.metadata, extracted_schema: data.semantic.extracted_schema }} />
        </Stage>

        <Stage title="Conflict Truth" subtitle="Abweichungen bleiben sichtbar und werden nicht automatisch zusammengeführt">
          <p className="text-sm">{data.conflict.conflicts.length} Konflikt(e)</p>
          <JsonBlock value={data.conflict} />
        </Stage>

        <Stage title="Execution Truth" subtitle="Operationen, die den Fall untersucht haben">
          <JsonBlock value={data.execution.operations} />
        </Stage>

        <Stage title="Runtime Truth" subtitle="Technische Beobachtungen und Laufzeitdiagnostik">
          <JsonBlock value={data.runtime.observations} />
        </Stage>

        <Stage title="Resolution Truth" subtitle="Nachvollziehbare Entscheidung ohne Löschen vorheriger Wahrheit">
          <JsonBlock value={data.resolution} />
        </Stage>

        <Stage title="Validation Truth" subtitle="Prüfung gegen Evidenz und Quellen">
          <JsonBlock value={data.validation.results} />
        </Stage>

        <Stage title="Review Truth" subtitle="Autorisierte Prüfung, Kriterien und finale Entscheidung">
          <JsonBlock value={data.review} />
        </Stage>

        <Stage title="Release Truth" subtitle="Freigabestatus und unveränderliches Zertifikat">
          <p className="text-sm font-medium">Status: {releaseStatus}</p>
          {latestCertificate && (
            <p className="mt-2 break-all text-xs text-muted-foreground">Certificate hash: {String(latestCertificate.certificate_hash ?? "n/a")}</p>
          )}
          <JsonBlock value={data.release} />
        </Stage>
      </div>
    </main>
  );
}
