import { useEffect, useState, type ReactNode } from "react";
import { useLocation, useRoute } from "wouter";
import { milaApi, type CaseTrace } from "@/api/connector";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

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

function statusLabel(value: unknown) {
  const status = String(value ?? "open").toLowerCase();
  if (status === "trusted") return "Freigegeben";
  if (status === "blocked") return "Blockiert";
  if (status === "revoked") return "Widerrufen";
  if (status === "exception") return "Ausnahmefreigabe";
  if (status === "superseded") return "Ersetzt";
  if (status === "confirmed") return "Bestätigt";
  if (status === "candidate") return "Kandidat";
  if (status === "rejected") return "Abgelehnt";
  if (["passed", "pass", "success", "validated", "valid", "approved"].includes(status)) return "Bestanden";
  if (status === "failed") return "Fehlgeschlagen";
  return status;
}

function Step({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b py-2 last:border-b-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-right text-sm font-medium">{value}</span>
    </div>
  );
}

type ReadablePathStep = {
  title: string;
  fact: string;
  relation?: string;
  evidence?: string;
  status: string;
  kind: "observed" | "derived" | "candidate" | "confirmed" | "open";
};

function kindLabel(kind: ReadablePathStep["kind"]) {
  if (kind === "observed") return "DIREKT BEOBACHTET";
  if (kind === "derived") return "ABGELEITET";
  if (kind === "candidate") return "KANDIDAT";
  if (kind === "confirmed") return "BESTÄTIGT";
  return "OFFEN / NICHT BELEGT";
}

function ReadablePath({ steps }: { steps: ReadablePathStep[] }) {
  return (
    <section className="rounded-2xl border bg-card p-4 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Pfadansicht</p>
      <h2 className="mt-1 text-lg font-semibold">Zeig mir, wie PetraPlan zu dieser Verbindung kommt</h2>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
        Jeder Schritt trennt Fakt, Beziehung, Ableitung und Bestätigung. Fehlt ein Beleg, bleibt die Stelle sichtbar offen.
      </p>
      <div className="mt-4 space-y-2">
        {steps.map((step, index) => (
          <div key={`${step.title}-${index}`}>
            <div className="rounded-xl border p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Schritt {index + 1} · {kindLabel(step.kind)}</p>
                  <h3 className="mt-1 break-words text-sm font-semibold">{step.title}</h3>
                </div>
                <span className="shrink-0 rounded-full border px-2 py-1 text-[10px] font-semibold">{step.status}</span>
              </div>
              <p className="mt-2 text-sm leading-relaxed">{step.fact}</p>
              {step.relation && (
                <div className="mt-3 rounded-lg bg-muted/50 p-2 text-xs">
                  <span className="font-semibold">Beziehung: </span>{step.relation}
                </div>
              )}
              <div className="mt-2 text-xs text-muted-foreground">
                <span className="font-semibold text-foreground">Evidence: </span>{step.evidence || "Kein eigener Beleg gespeichert."}
              </div>
            </div>
            {index < steps.length - 1 && (
              <div className="flex justify-center py-1 text-lg text-muted-foreground" aria-hidden="true">↓</div>
            )}
          </div>
        ))}
      </div>
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
  const releaseStatus = String(data.release.effective_status ?? latestCertificate?.release_status ?? "open");
  const authoritativeValidation = data.validation.authoritative;
  const authoritativeValidationStatus = String(authoritativeValidation?.status ?? "unknown");
  const historicalValidations = authoritativeValidation
    ? data.validation.results.filter((item) => item !== authoritativeValidation && item.id !== authoritativeValidation.id)
    : data.validation.results;
  const latestResolution = data.resolution.records.at(-1);
  const latestReviewDecision = data.review.decisions.at(-1);

  const traceWithClaims = data as CaseTrace & { claim_layer?: unknown };
  const claimLayer = isRecord(traceWithClaims.claim_layer) ? traceWithClaims.claim_layer : {};
  const claims = Array.isArray(claimLayer.claims) ? claimLayer.claims.filter(isRecord) : [];
  const evidenceLinks = Array.isArray(claimLayer.evidence_links) ? claimLayer.evidence_links.filter(isRecord) : [];
  const candidates = data.address_layer.candidates.filter(isRecord);
  const confirmedCandidates = candidates.filter((candidate) => String(candidate.state).toLowerCase() === "confirmed");
  const candidateCandidates = candidates.filter((candidate) => String(candidate.state).toLowerCase() === "candidate");
  const ingestion = data.source.ingestion;
  const sourceRef = String(ingestion?.source_reference ?? data.source.record.source_reference ?? data.title);
  const sourceHash = String(ingestion?.source_hash ?? data.source.record.source_hash ?? "kein Hash gespeichert");

  const readableSteps: ReadablePathStep[] = [
    {
      title: `Quelle: ${sourceRef}`,
      fact: "Das ist der gespeicherte Ausgangspunkt des Falls. An dieser Stelle wird noch keine fachliche Bedeutung ergänzt.",
      relation: "Quelle → Snapshot",
      evidence: `Source hash: ${sourceHash}`,
      status: String(ingestion?.status ?? "gespeichert").toUpperCase(),
      kind: "observed",
    },
  ];

  if (data.representation.evidence.length > 0) {
    readableSteps.push({
      title: "Werte wurden im ursprünglichen Snapshot beobachtet",
      fact: `${data.representation.evidence.length} Representation-Evidence-Eintrag/Einträge zeigen, wie Werte zum Erfassungszeitpunkt dargestellt waren.`,
      relation: "Snapshot → beobachtete Darstellung",
      evidence: data.representation.evidence.map((item) => String(item.field_address ?? item.id ?? "Representation Evidence")).slice(0, 3).join(" · "),
      status: "BEOBACHTET",
      kind: "observed",
    });
  }

  if (candidateCandidates.length > 0 || confirmedCandidates.length > 0) {
    const visibleCandidates = [...confirmedCandidates, ...candidateCandidates];
    readableSteps.push({
      title: "Fachliche Zuordnung wurde als Kandidat formuliert",
      fact: visibleCandidates.map((candidate) => `${String(candidate.candidate_key ?? candidate.id)}: ${String(candidate.observed_value ?? "?")} → ${String(candidate.proposed_value ?? "?")}`).slice(0, 3).join(" · "),
      relation: "Beobachtung → Bedeutungskandidat",
      evidence: visibleCandidates.map((candidate) => String(candidate.evidence ?? "Kandidat gespeichert")).slice(0, 2).join(" · "),
      status: confirmedCandidates.length > 0 ? `${confirmedCandidates.length} BESTÄTIGT` : `${candidateCandidates.length} OFFEN`,
      kind: confirmedCandidates.length > 0 ? "confirmed" : "candidate",
    });
  }

  if (claims.length > 0) {
    const supportedClaims = claims.filter((claim) => ["supported", "confirmed"].includes(String(claim.status).toLowerCase()));
    readableSteps.push({
      title: "Aus den Belegen wurde eine begrenzte Aussage gebildet",
      fact: claims.map((claim) => String(claim.statement ?? "Claim ohne Text")).slice(0, 2).join(" · "),
      relation: "Evidence → Claim",
      evidence: `${evidenceLinks.length} gespeicherte Claim-Evidence-Verknüpfung(en)`,
      status: supportedClaims.length > 0 ? statusLabel(supportedClaims[0].status).toUpperCase() : statusLabel(claims[0].status).toUpperCase(),
      kind: supportedClaims.length > 0 ? "confirmed" : "derived",
    });
  }

  if (authoritativeValidation) {
    readableSteps.push({
      title: "Der konkrete Fall wurde neu geprüft",
      fact: `Die maßgebliche Validation für diesen Fall ist ${statusLabel(authoritativeValidationStatus).toLowerCase()}.`,
      relation: "bestätigte Grundlage → Validation",
      evidence: `Validation ${String(authoritativeValidation.id ?? "ohne ID")} · ${String(authoritativeValidation.created_at ?? "Zeit nicht gespeichert")}`,
      status: statusLabel(authoritativeValidationStatus).toUpperCase(),
      kind: "confirmed",
    });
  }

  if (latestReviewDecision || data.review.current) {
    readableSteps.push({
      title: "Ein Mensch hat den Fall als Fall geprüft",
      fact: "Review bestätigt nicht noch einmal den Kandidaten, sondern prüft den konkreten Fall mit seinen Belegen und Blockern.",
      relation: "Validation → Review",
      evidence: String(latestReviewDecision?.reason ?? data.review.current?.reason ?? "Review-Datensatz gespeichert"),
      status: statusLabel(latestReviewDecision?.decision ?? latestReviewDecision?.status ?? data.review.current?.decision ?? "offen").toUpperCase(),
      kind: "confirmed",
    });
  }

  readableSteps.push({
    title: "Release ist die separate Freigabe des Falls",
    fact: releaseStatus === "trusted"
      ? "Der Fall ist auf Basis der gespeicherten Prüf- und Review-Kette freigegeben."
      : "Der Fall ist noch nicht als vertrauenswürdiger Release freigegeben.",
    relation: "Review → Release",
    evidence: latestCertificate ? `Zertifikat ${String(latestCertificate.id ?? "")} · Hash ${String(latestCertificate.certificate_hash ?? "nicht gespeichert")}` : "Kein Release-Zertifikat gespeichert.",
    status: statusLabel(releaseStatus).toUpperCase(),
    kind: releaseStatus === "trusted" ? "confirmed" : "open",
  });

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-3xl space-y-4 px-4 py-6 pb-12">
        <button className="rounded-lg border px-3 py-2 text-sm" onClick={() => setLocation("/cases")}>← Fälle</button>

        <header className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-3xl font-semibold">{data.title}</h1>
            <span className="rounded-full border px-2 py-1 text-[11px] font-semibold">{statusLabel(releaseStatus).toUpperCase()}</span>
          </div>
          <p className="text-sm text-muted-foreground">{data.category} · Case {data.id.slice(0, 8)}</p>
        </header>

        <ReadablePath steps={readableSteps} />

        <section className="rounded-2xl border bg-card p-4 shadow-sm">
          <div className="mb-3">
            <h2 className="font-semibold">Technische Kurzspur</h2>
            <p className="mt-1 text-xs text-muted-foreground">Die kompakte Truth-Chain bleibt erhalten; die Pfadansicht darüber erklärt, warum die Schritte zusammengehören.</p>
          </div>
          <div>
            <Step label="Source" value="Original erhalten" />
            <Step label="Conflict" value={`${data.conflict.conflicts.length} Konflikt(e)`} />
            <Step label="Resolution" value={String(latestResolution?.resolution_type ?? latestResolution?.decision ?? "offen")} />
            <Step label="Validation" value={statusLabel(authoritativeValidationStatus)} />
            <Step label="Review" value={statusLabel(latestReviewDecision?.decision ?? latestReviewDecision?.status ?? "offen")} />
            <Step label="Release" value={statusLabel(releaseStatus)} />
          </div>
          {data.release.gate && (
            <div className="mt-4 rounded-xl border p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Release Gate</p>
              <p className="mt-1 text-sm">{data.release.gate.reason}</p>
              {data.release.gate.shouldTransition && (
                <p className="mt-2 text-xs font-medium">Statuswechsel erforderlich: {statusLabel(data.release.gate.effectiveStatus)}</p>
              )}
            </div>
          )}
        </section>

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

        <Stage title="Validation Truth" subtitle="Aktuell maßgebliche Prüfung getrennt von früheren Ergebnissen">
          <div className="rounded-xl border p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Maßgebliche Validation</p>
            <p className="mt-1 text-sm font-medium">{statusLabel(authoritativeValidationStatus)}</p>
            {authoritativeValidation && <JsonBlock value={authoritativeValidation} />}
          </div>
          {historicalValidations.length > 0 && (
            <details className="mt-3 rounded-xl border p-3">
              <summary className="cursor-pointer text-sm font-medium">Historie · {historicalValidations.length} frühere Prüfung(en)</summary>
              <p className="mt-2 text-xs text-muted-foreground">Diese Ergebnisse bleiben als Audit-Historie erhalten, steuern aber nicht den aktuellen Release-Status.</p>
              <JsonBlock value={historicalValidations} />
            </details>
          )}
        </Stage>

        <Stage title="Review Truth" subtitle="Autorisierte Prüfung, Kriterien und finale Entscheidung">
          <JsonBlock value={data.review} />
        </Stage>

        <Stage title="Release Truth" subtitle="Effektiver Freigabestatus und unveränderliches Zertifikat">
          <p className="text-sm font-medium">Aktueller Status: {statusLabel(releaseStatus)}</p>
          {latestCertificate && (
            <p className="mt-2 break-all text-xs text-muted-foreground">Certificate hash: {String(latestCertificate.certificate_hash ?? "n/a")}</p>
          )}
          <JsonBlock value={data.release} />
        </Stage>
      </div>
    </main>
  );
}
