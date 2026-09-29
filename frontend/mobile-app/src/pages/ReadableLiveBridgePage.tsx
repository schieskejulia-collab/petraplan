import { useEffect, useMemo, useState } from "react";
import { useRoute } from "wouter";
import { milaApi, type CaseTrace, type RdfObject } from "@/api/connector";
import LiveBridgePage from "./LiveBridgePage";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

type ReadableCaseTrace = CaseTrace & {
  claim_layer?: {
    claims: Array<Record<string, unknown>>;
    evidence_links: Array<Record<string, unknown>>;
  };
};

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

function rdfObjectText(object: RdfObject) {
  if (object.kind === "resource") return object.value;
  if (typeof object.value === "string" || typeof object.value === "number" || typeof object.value === "boolean") return String(object.value);
  try {
    return JSON.stringify(object.value);
  } catch {
    return String(object.value ?? "—");
  }
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
  const [data, setData] = useState<ReadableCaseTrace | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!caseId) return;
    void milaApi.caseTrace(caseId)
      .then((trace) => {
        if (!cancelled) setData(trace as ReadableCaseTrace);
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
    const candidateEvidence = candidates.filter((item) => Boolean(item.evidence));

    const claimLayer = data.claim_layer ?? { claims: [], evidence_links: [] };
    const claims = Array.isArray(claimLayer.claims) ? claimLayer.claims.filter(isRecord) : [];
    const evidenceLinks = Array.isArray(claimLayer.evidence_links) ? claimLayer.evidence_links.filter(isRecord) : [];
    const confirmedClaims = claims.filter((item) => ["confirmed", "supported"].includes(String(item.status).toLowerCase()));
    const scopedClaims = claims.filter((item) => Boolean(item.scope_type));
    const ruleBackedClaims = claims.filter((item) => Boolean(item.rule_id));

    const validation = data.validation.authoritative;
    const review = data.review.current;
    const release = data.release.effective_status;

    const relationCount = Array.isArray(data.address_layer?.links) ? data.address_layer.links.length : 0;
    const addressCount = Array.isArray(data.address_layer?.addresses) ? data.address_layer.addresses.length : 0;
    const representationCount = Array.isArray(data.representation?.evidence) ? data.representation.evidence.length : 0;
    const rdfStatementCount = data.rdf_prov?.rdf.statements.length ?? 0;
    const provLinkCount = data.rdf_prov?.prov.links.length ?? 0;

    const evidenceText = evidenceLinks.length
      ? `${evidenceLinks.length} Claim↔Evidence-Verknüpfung(en) zeigen, worauf gespeicherte Claims beruhen.`
      : candidateEvidence.length
        ? `${candidateEvidence.length} Candidate-Evidence-Befund(e) sind gespeichert. Sie belegen die beobachtete Grundlage des Kandidaten, aber noch keinen autorisierten fachlichen Claim.`
        : "Weder Candidate-Evidence noch eine Claim↔Evidence-Verknüpfung ist gespeichert.";

    const evidenceStatus = evidenceLinks.length
      ? "CLAIM-EVIDENCE"
      : candidateEvidence.length
        ? "CANDIDATE-EVIDENCE"
        : "NICHT BELEGT";

    return {
      sourceRef,
      sourceSystem,
      sourceStatus: statusLabel(ingestion?.status),
      addressCount,
      relationCount,
      representationCount,
      rdfStatementCount,
      provLinkCount,
      candidateText: candidates.length
        ? `${candidates.length} Kandidat(en): ${confirmedCandidates.length} bestätigt, ${openCandidates.length} offen, ${rejectedCandidates.length} abgelehnt.`
        : "Keine gespeicherten Kandidaten in diesem Fall.",
      candidateStatus: openCandidates.length ? "OFFEN" : confirmedCandidates.length ? "BESTÄTIGT" : candidates.length ? "GEPRÜFT" : "KEIN KANDIDAT",
      claimText: claims.length
        ? `${claims.length} fachliche Aussage(n), davon ${confirmedClaims.length} gestützt oder bestätigt.`
        : "Für diesen Fall ist noch kein expliziter Claim gespeichert.",
      claimStatus: claims.length ? (confirmedClaims.length === claims.length ? "BESTÄTIGT" : "TEILWEISE OFFEN") : "NICHT AUTORISIERT",
      evidenceText,
      evidenceStatus,
      scopeText: claims.length
        ? `${scopedClaims.length} von ${claims.length} Claim(s) haben einen expliziten Scope; ${ruleBackedClaims.length} verweisen auf eine gespeicherte Rule.`
        : candidates.length
          ? "Die Kandidaten haben beobachtete Herkunft und Candidate-Evidence, aber noch keinen expliziten Claim mit autorisiertem Scope oder gespeicherter Rule."
          : "Ohne Claim oder Kandidat gibt es hier keinen Claim-Scope zu autorisieren.",
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

  const rdfStatements = data?.rdf_prov?.rdf.statements ?? [];
  const provLinks = data?.rdf_prov?.prov.links ?? [];

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-3xl px-4 pt-5">
        <section className="mb-4 rounded-2xl border bg-card p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Pfadansicht · lesbare Beweiskette</p>
          <h2 className="mt-1 text-xl font-semibold">Wie kommt PetraPlan zu diesem Ergebnis?</h2>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">Nicht nur das Ergebnis, sondern der Weg dorthin. Jede Stufe zeigt, was beobachtet, verbunden, vermutet, belegt, geprüft oder freigegeben ist.</p>

          {error && <p className="mt-3 rounded-xl border p-3 text-sm">{error}</p>}
          {!path && !error && <p className="mt-3 text-sm text-muted-foreground">Pfad wird geladen…</p>}

          {path && (
            <div className="mt-4 space-y-3">
              <PathStep number={1} question="WO liegt es?" title="Address / RDF Resource" answer={`${path.addressCount} registrierte Adresse(n) im Fall.`} status={path.addressCount ? "ADRESSIERT" : "NICHT BELEGT"} detail="Die Adresse sagt, wo etwas liegt. Sie sagt noch nicht, was es fachlich bedeutet." />
              <PathStep number={2} question="WAS wurde dort tatsächlich beobachtet?" title="Observation / Source Snapshot" answer={`${path.sourceRef} aus ${path.sourceSystem}`} status={path.sourceStatus} detail="Das ist die beobachtete Herkunft. Die Quelle wird durch spätere Entscheidungen nicht umgeschrieben." />
              <PathStep number={3} question="WIE wurde es dargestellt?" title="Representation Evidence" answer={`${path.representationCount} gespeicherte Darstellungsbefund(e).`} status={path.representationCount ? "BEOBACHTET" : "NICHT BELEGT"} detail="Raw, Bridge und Display dürfen auseinanderliegen. Eine Darstellungsabweichung ist noch keine fachliche Bedeutung." />
              <PathStep number={4} question="WOMIT ist es nachweisbar verbunden?" title="RDF Relations + Keys + Context" answer={`${path.rdfStatementCount} RDF-artige Aussage(n), dazu ${path.relationCount} gespeicherte Impact-/Adressbeziehung(en).`} status={path.rdfStatementCount ? "SICHTBAR" : "NICHT BELEGT"} detail="RDF macht technische Beziehungen sichtbar. Eine technische Relation wird dadurch nicht automatisch zur fachlichen Wahrheit." />
              <PathStep number={5} question="WAS könnte diese Beziehung bedeuten?" title="Claim Candidate" answer={path.candidateText} status={path.candidateStatus} detail="Ein Kandidat ist eine prüfbare Vermutung. Er verändert weder die Quelle noch gibt er den Fall frei." />
              <PathStep number={6} question="WOHER kommen Claim und Belege?" title="PROV-O" answer={`${path.provLinkCount} Herkunfts-/Einflussbeziehung(en) sind sichtbar.`} status={path.provLinkCount ? "NACHVOLLZIEHBAR" : "NICHT BELEGT"} detail="PROV-O beschreibt Herkunft, Einfluss und Verantwortungsbezug. Es beweist nicht automatisch, dass eine Aussage richtig ist." />
              <PathStep number={7} question="WAS belegt die Aussage?" title="Evidence" answer={path.evidenceText} status={path.evidenceStatus} detail="Candidate-Evidence belegt nur die beobachtete Grundlage einer Vermutung. Erst ein eigener Claim↔Evidence-Link trägt eine explizite fachliche Aussage." />
              <PathStep number={8} question="DARF die Aussage für diesen Scope gelten?" title="Rule + Authority + Assessment" answer={path.scopeText} status={path.claimStatus} detail="Scope, Rule und fachliche Entscheidung dürfen nicht stillschweigend verallgemeinert werden." />
              <PathStep number={9} question="HÄLT genau dieser konkrete Fall?" title="Validation" answer={path.validationText} status={path.validationStatus} detail={path.conflicts ? `${path.conflicts} Konflikt(e) sind im Fall sichtbar.` : "Keine aktuell gespeicherten Konflikte im Fall."} />
              <PathStep number={10} question="HAT ein berechtigter Mensch den aktuellen Stand geprüft?" title="Review" answer={path.reviewText} status={path.reviewStatus} />
              <PathStep number={11} question="DARF dieses geprüfte Ergebnis verwendet werden?" title="Release" answer={path.releaseText} status={path.releaseStatus} />
            </div>
          )}
        </section>

        {data?.rdf_prov && (
          <section className="mb-4 rounded-2xl border bg-card p-4 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">RDF + PROV-O · read-only</p>
            <h2 className="mt-1 text-lg font-semibold">Beziehungen und Herkunft sichtbar</h2>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">Diese Ansicht liest bestehende PetraPlan-Evidence. Sie erzeugt keine neue Source Truth, bestätigt keine fachliche Bedeutung und verändert weder Candidate, Validation, Review noch Release.</p>

            <details className="mt-4 rounded-xl border p-3" open>
              <summary className="cursor-pointer text-sm font-semibold">RDF Relations ({rdfStatements.length})</summary>
              <div className="mt-3 space-y-2">
                {rdfStatements.length ? rdfStatements.map((statement, index) => (
                  <div key={`${statement.subject}-${statement.predicate}-${index}`} className="rounded-lg bg-muted/40 p-3 text-xs">
                    <p className="break-all"><span className="font-semibold">{statement.subject}</span></p>
                    <p className="my-1 break-all text-muted-foreground">↓ {statement.predicate}</p>
                    <p className="break-all font-medium">{rdfObjectText(statement.object)}</p>
                    <p className="mt-2 break-all text-[10px] text-muted-foreground">Evidence-Basis: {statement.evidence_basis}</p>
                  </div>
                )) : <p className="text-xs text-muted-foreground">Keine RDF-artige Beziehung für diesen Fall projiziert.</p>}
              </div>
            </details>

            <details className="mt-3 rounded-xl border p-3" open>
              <summary className="cursor-pointer text-sm font-semibold">PROV-O Herkunft ({provLinks.length})</summary>
              <div className="mt-3 space-y-2">
                {provLinks.length ? provLinks.map((link, index) => (
                  <div key={`${link.subject}-${link.predicate}-${index}`} className="rounded-lg bg-muted/40 p-3 text-xs">
                    <p className="break-all"><span className="font-semibold">{link.subject}</span></p>
                    <p className="my-1 break-all text-muted-foreground">↓ {link.predicate}</p>
                    <p className="break-all font-medium">{link.object}</p>
                    <p className="mt-2 break-all text-[10px] text-muted-foreground">Evidence-Basis: {link.evidence_basis}</p>
                  </div>
                )) : <p className="text-xs text-muted-foreground">Keine PROV-O-artige Herkunftsbeziehung für diesen Fall projiziert.</p>}
              </div>
            </details>

            <details className="mt-3 rounded-xl border p-3">
              <summary className="cursor-pointer text-sm font-semibold">Grenzen dieser Ansicht</summary>
              <div className="mt-2 space-y-1 text-xs text-muted-foreground">
                {data.rdf_prov.guard_rails.map((guard) => <p key={guard}>• {guard}</p>)}
              </div>
            </details>
          </section>
        )}

        <a href="#live-bridge-workflow" className="mb-4 block rounded-xl border px-4 py-3 text-center text-sm font-semibold">Technische Details darunter ansehen ↓</a>
      </div>

      <div id="live-bridge-workflow">
        <LiveBridgePage />
      </div>
    </div>
  );
}
