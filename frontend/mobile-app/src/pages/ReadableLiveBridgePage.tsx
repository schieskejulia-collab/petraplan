import { useEffect, useMemo, useState } from "react";
import { useRoute } from "wouter";
import { milaApi, type CaseTrace } from "@/api/connector";
import LiveBridgePage from "./LiveBridgePage";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function statusLabel(value: unknown) {
  const raw = String(value ?? "offen").toLowerCase();
  if (["trusted", "approved", "passed", "pass", "success", "validated", "valid"].includes(raw)) return "BESTÄTIGT";
  if (raw === "confirmed") return "BESTÄTIGT";
  if (raw === "rejected") return "ABGELEHNT";
  if (raw === "failed") return "FEHLGESCHLAGEN";
  if (raw === "blocked") return "BLOCKIERT";
  if (raw === "revoked") return "WIDERRUFEN";
  if (raw === "candidate") return "KANDIDAT";
  if (raw === "superseded") return "ERSETZT";
  return raw ? raw.toUpperCase() : "OFFEN";
}

type PathStepProps = {
  number: number;
  title: string;
  question: string;
  answer: string;
  status?: string;
  detail?: string;
};

function PathStep({ number, title, question, answer, status, detail }: PathStepProps) {
  return (
    <div className="relative pl-12">
      <div className="absolute left-0 top-0 flex h-8 w-8 items-center justify-center rounded-full border bg-background text-xs font-semibold">{number}</div>
      <div className="rounded-xl border bg-background p-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{question}</p>
            <h3 className="mt-1 text-sm font-semibold">{title}</h3>
          </div>
          {status && <span className="shrink-0 rounded-full border px-2 py-1 text-[10px] font-semibold">{status}</span>}
        </div>
        <p className="mt-2 break-words text-sm leading-relaxed">{answer}</p>
        {detail && <p className="mt-2 break-words text-xs leading-relaxed text-muted-foreground">{detail}</p>}
      </div>
    </div>
  );
}

export default function ReadableLiveBridgePage() {
  const [, params] = useRoute("/bridge/:caseId");
  const caseId = params?.caseId ?? "";
  const [data, setData] = useState<CaseTrace | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!caseId) return;
    void milaApi.caseTrace(caseId)
      .then((trace) => {
        if (!cancelled) setData(trace);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Pfadansicht konnte nicht geladen werden.");
      });
    return () => {
      cancelled = true;
    };
  }, [caseId]);

  const path = useMemo(() => {
    if (!data) return null;

    const ingestion = data.source.ingestion;
    const sourceRef = String(ingestion?.source_reference ?? data.source.record.source_reference ?? data.title ?? "Quelle");
    const sourceSystem = String(ingestion?.source_system ?? data.source.record.source_system ?? "Quellsystem unbekannt");

    const candidates = Array.isArray(data.address_layer?.candidates) ? data.address_layer.candidates.filter(isRecord) : [];
    const confirmedCandidates = candidates.filter((item) => String(item.state).toLowerCase() === "confirmed");
    const openCandidates = candidates.filter((item) => String(item.state).toLowerCase() === "candidate");
    const rejectedCandidates = candidates.filter((item) => String(item.state).toLowerCase() === "rejected");

    const rawClaimLayer = (data as CaseTrace & { claim_layer?: unknown }).claim_layer;
    const claimLayer = isRecord(rawClaimLayer) ? rawClaimLayer : {};
    const claims = Array.isArray(claimLayer.claims) ? claimLayer.claims.filter(isRecord) : [];
    const evidenceLinks = Array.isArray(claimLayer.evidence_links) ? claimLayer.evidence_links.filter(isRecord) : [];
    const confirmedClaims = claims.filter((item) => ["confirmed", "supported"].includes(String(item.status).toLowerCase()));

    const validation = data.validation.authoritative;
    const review = data.review.current;
    const release = data.release.effective_status;

    const relationCount = Array.isArray(data.address_layer?.links) ? data.address_layer.links.length : 0;
    const addressCount = Array.isArray(data.address_layer?.addresses) ? data.address_layer.addresses.length : 0;

    return {
      sourceRef,
      sourceSystem,
      sourceStatus: statusLabel(ingestion?.status),
      addressCount,
      relationCount,
      candidateText: candidates.length
        ? `${candidates.length} Kandidat(en): ${confirmedCandidates.length} bestätigt, ${openCandidates.length} offen, ${rejectedCandidates.length} abgelehnt.`
        : "Keine gespeicherten Kandidaten in diesem Fall.",
      candidateStatus: openCandidates.length ? "OFFEN" : confirmedCandidates.length ? "BESTÄTIGT" : candidates.length ? "GEPRÜFT" : "KEIN KANDIDAT",
      claimText: claims.length
        ? `${claims.length} fachliche Aussage(n), davon ${confirmedClaims.length} gestützt oder bestätigt. ${evidenceLinks.length} Evidence-Verknüpfung(en) zeigen, worauf diese Aussagen beruhen.`
        : "Für diesen Fall ist noch kein Claim gespeichert. Das ist keine Behauptungslücke, die versteckt werden darf.",
      claimStatus: claims.length ? (confirmedClaims.length === claims.length ? "BESTÄTIGT" : "TEILWEISE OFFEN") : "NICHT BELEGT",
      validationText: validation
        ? `Die maßgebliche Validierung ${String(validation.id ?? "").slice(0, 8)} steht auf ${statusLabel(validation.status)}.`
        : "Es gibt noch keine maßgebliche Validierung.",
      validationStatus: statusLabel(validation?.status),
      reviewText: review?.complete
        ? `Der konkrete Fall wurde geprüft. Review-Entscheidung: ${statusLabel(review.decision ?? "bestätigt")}.`
        : "Der konkrete Fall ist noch nicht vollständig reviewed.",
      reviewStatus: review?.complete ? statusLabel(review.decision ?? "bestätigt") : "OFFEN",
      releaseText: release === "trusted"
        ? "Der geprüfte Fall ist freigegeben. Das bedeutet nicht, dass jede Aussage global wahr ist; die Freigabe gilt für diesen belegten Fall und seine Grundlage."
        : `Der Fall ist noch nicht freigegeben. Aktueller Release-Status: ${statusLabel(release)}.`,
      releaseStatus: statusLabel(release),
      conflicts: data.conflict.conflicts.length,
    };
  }, [data]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-3xl px-4 pt-5">
        <section className="mb-4 rounded-2xl border bg-card p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Pfadansicht · lesbare Beweiskette</p>
          <h2 className="mt-1 text-xl font-semibold">Wie kommt PetraPlan zu diesem Ergebnis?</h2>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">Nicht nur das Ergebnis, sondern der Weg dorthin. Jede Stufe zeigt, was beobachtet, abgeleitet, bestätigt oder noch nicht belegt ist.</p>

          {error && <p className="mt-3 rounded-xl border p-3 text-sm">{error}</p>}
          {!path && !error && <p className="mt-3 text-sm text-muted-foreground">Pfad wird geladen…</p>}

          {path && (
            <div className="mt-4 space-y-3">
              <PathStep
                number={1}
                question="Woher kommt es?"
                title="Quelle / Snapshot"
                answer={`${path.sourceRef} aus ${path.sourceSystem}`}
                status={path.sourceStatus}
                detail="Das ist die beobachtete Herkunft. Die Quelle wird nicht durch spätere Entscheidungen umgeschrieben."
              />
              <PathStep
                number={2}
                question="Womit hängt es zusammen?"
                title="Adressen und beobachtete Verbindungen"
                answer={`${path.addressCount} registrierte Adresse(n), ${path.relationCount} gespeicherte Verbindung(en).`}
                status={path.relationCount ? "BEOBACHTET" : "NICHT BELEGT"}
                detail="Eine technische Verbindung ist noch keine bestätigte fachliche Bedeutung."
              />
              <PathStep
                number={3}
                question="Welche Bedeutung wird vermutet?"
                title="Kandidaten"
                answer={path.candidateText}
                status={path.candidateStatus}
                detail="Ein Kandidat ist eine prüfbare Vermutung. Er verändert weder die Quelle noch gibt er den Fall frei."
              />
              <PathStep
                number={4}
                question="Was darf daraus behauptet werden?"
                title="Claims und Evidence"
                answer={path.claimText}
                status={path.claimStatus}
                detail="Eine Aussage bleibt auf ihren Scope begrenzt. Indirekte Aussagen dürfen ihre Beweiskette nicht verlieren."
              />
              <PathStep
                number={5}
                question="Hält die Kette der Prüfung stand?"
                title="Validation"
                answer={path.validationText}
                status={path.validationStatus}
                detail={path.conflicts ? `${path.conflicts} Konflikt(e) sind im Fall sichtbar.` : "Keine aktuell gespeicherten Konflikte im Fall."}
              />
              <PathStep
                number={6}
                question="Hat ein Mensch den konkreten Fall geprüft?"
                title="Review"
                answer={path.reviewText}
                status={path.reviewStatus}
              />
              <PathStep
                number={7}
                question="Darf dieser konkrete Fall verwendet werden?"
                title="Release"
                answer={path.releaseText}
                status={path.releaseStatus}
              />
            </div>
          )}

          <a href="#live-bridge-workflow" className="mt-4 block rounded-xl border px-4 py-3 text-center text-sm font-semibold">Technische Details darunter ansehen ↓</a>
        </section>
      </div>

      <div id="live-bridge-workflow">
        <LiveBridgePage />
      </div>
    </div>
  );
}
