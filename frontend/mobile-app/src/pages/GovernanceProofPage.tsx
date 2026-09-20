import { useLocation } from "wouter";
import {
  assessReleaseImpact,
  evaluateWithGovernedEvidence,
  type GovernanceEvidence,
} from "@/lib/bridge-governed-evidence";
import type { RawRecord } from "@/lib/bridge-pipeline";

const capturedAt = "2026-09-20T20:52:00.000Z";

const raw: RawRecord = {
  KUNDEN_NR: "4711",
  AUFTRAGS_NR: "A-10027",
  STATUS: "UNBEKANNT",
  MENGE: "-4",
  DATUM: "20.09.2026",
};

const quantityEvidence: GovernanceEvidence = {
  kind: "RULE_CONFIRMATION",
  evidenceId: "E-RULE-NEGATIVE-QTY-DEMO-001",
  version: "quantity-rule-demo-v2",
  reviewId: "R-DEMO-001",
  confirmedAt: "2026-09-20T20:55:00.000Z",
  confirmedBy: "synthetic-demo-review",
  scope: "demo-only",
  constraintId: "quantity.positive",
  field: "MENGE",
  sourceValue: "-4",
  decision: "ALLOW_OBSERVED_VALUE_IN_DEMO_CONTEXT",
  rationale: "Synthetische Testbestätigung nur für diesen Demo-Fall.",
};

const statusEvidence: GovernanceEvidence = {
  kind: "SEMANTIC_MAPPING_CONFIRMATION",
  evidenceId: "E-STATUS-DEMO-001",
  version: "status-map-demo-v2",
  reviewId: "R-DEMO-002",
  confirmedAt: "2026-09-20T20:57:00.000Z",
  confirmedBy: "synthetic-demo-review",
  scope: "demo-only",
  constraintId: "status.value_map",
  field: "STATUS",
  sourceValue: "UNBEKANNT",
  canonicalValue: "in_progress",
  rationale: "Synthetische Testbestätigung nur für diesen Governance-Proof.",
};

const stage0 = evaluateWithGovernedEvidence(raw, capturedAt, []);
const stage1 = evaluateWithGovernedEvidence(raw, capturedAt, [quantityEvidence]);
const stage2 = evaluateWithGovernedEvidence(raw, capturedAt, [quantityEvidence, statusEvidence]);
const revokedEvidenceIds = [statusEvidence.evidenceId];
const stage3 = evaluateWithGovernedEvidence(raw, capturedAt, [quantityEvidence, statusEvidence], revokedEvidenceIds);
const revocationImpact = assessReleaseImpact(stage2.release.releaseBasis, revokedEvidenceIds);

function StatusLine({ title, text }: { title: string; text: string }) {
  return (
    <div className="grid grid-cols-[112px_1fr] gap-3 py-2 text-sm">
      <div className="font-semibold">{title}</div>
      <div className="text-muted-foreground">{text}</div>
    </div>
  );
}

function ArrowNote({ children }: { children: React.ReactNode }) {
  return (
    <div className="my-2 flex items-start gap-3 pl-3 text-sm">
      <div className="pt-0.5 text-lg leading-none">↓</div>
      <div className="border-l pl-3 leading-6 text-muted-foreground">{children}</div>
    </div>
  );
}

export default function GovernanceProofPage() {
  const [, setLocation] = useLocation();

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-2xl px-4 py-6">
        <div className="mb-6 flex items-center justify-between gap-3">
          <button type="button" onClick={() => setLocation("/cases")} className="text-sm font-semibold underline underline-offset-4">
            ← Zurück
          </button>
          <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Demo-only</span>
        </div>

        <header className="mb-8 space-y-3">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">PetraPlan · Governance-Nachweis</p>
          <h1 className="text-3xl font-semibold leading-tight">Was ändert sich – und warum?</h1>
          <p className="text-base leading-7 text-muted-foreground">
            Derselbe Quelldatensatz bleibt unverändert. Nur bestätigte Evidenz verändert die Bewertung.
          </p>
        </header>

        <section className="mb-8 border-y py-4">
          <div className="mb-2 flex items-center justify-between gap-3">
            <h2 className="font-semibold">Source Truth</h2>
            <span className="text-xs font-semibold">UNVERÄNDERT</span>
          </div>
          <p className="text-sm leading-6 text-muted-foreground">
            Auftrag <b className="text-foreground">{raw.AUFTRAGS_NR}</b> · Kunde <b className="text-foreground">{raw.KUNDEN_NR}</b> · STATUS <b className="text-foreground">{raw.STATUS}</b> · MENGE <b className="text-foreground">{raw.MENGE}</b> · DATUM <b className="text-foreground">{raw.DATUM}</b>
          </p>
          <p className="mt-2 break-all text-[11px] text-muted-foreground">Snapshot {stage0.sourceSnapshotId}</p>
        </section>

        <section aria-labelledby="proof-flow" className="mb-10">
          <h2 id="proof-flow" className="mb-4 text-xl font-semibold">Aussage → Beleg → neue Entscheidung</h2>

          <div className="border-l-2 pl-5">
            <div className="py-2">
              <div className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">1 · Ausgangslage</div>
              <div className="mt-1 text-2xl font-semibold">BLOCKED</div>
              <StatusLine title="Warum?" text="Zwei Blocker sind offen: status.value_map und quantity.positive." />
            </div>

            <ArrowNote>
              <b className="text-foreground">R-DEMO-001</b> bestätigt nur den beobachteten Mengenfall <b className="text-foreground">MENGE=-4</b> über <b className="text-foreground">quantity-rule-demo-v2</b>.
            </ArrowNote>

            <div className="py-2">
              <div className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">2 · Ein Blocker gelöst</div>
              <div className="mt-1 text-2xl font-semibold">NEEDS_CONFIRMATION</div>
              <StatusLine title="Offen bleibt" text="status.value_map – die Bedeutung von STATUS=UNBEKANNT ist noch nicht bestätigt." />
            </div>

            <ArrowNote>
              <b className="text-foreground">R-DEMO-002</b> bestätigt exakt die Demo-Zuordnung <b className="text-foreground">UNBEKANNT → in_progress</b> über <b className="text-foreground">status-map-demo-v2</b>.
            </ArrowNote>

            <div className="py-2">
              <div className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">3 · Beide Blocker gelöst</div>
              <div className="mt-1 text-2xl font-semibold">RELEASED</div>
              <StatusLine title="Warum?" text="Alle BLOCKING-Constraints sind erfüllt. Die Freigabe basiert auf genau zwei bestätigten Evidence-Einträgen." />
            </div>

            <ArrowNote>
              <b className="text-foreground">Widerruf:</b> {statusEvidence.evidenceId} wird zurückgezogen.
            </ArrowNote>

            <div className="py-2">
              <div className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">4 · Grundlage entfällt</div>
              <div className="mt-1 text-2xl font-semibold">NEEDS_CONFIRMATION</div>
              <StatusLine title="Warum?" text="status.value_map ist wieder offen. Die frühere Freigabe bleibt nicht stillschweigend bestehen." />
            </div>
          </div>
        </section>

        <section className="mb-8 border-y py-5">
          <h2 className="text-xl font-semibold">Woran hing der Release konkret?</h2>
          <div className="mt-3 divide-y">
            {stage2.release.releaseBasis.map((item) => (
              <div key={item.evidenceId} className="py-3 text-sm leading-6">
                <div className="font-semibold">{item.constraintId}</div>
                <div className="text-muted-foreground">{item.evidenceId} · {item.version} · {item.reviewId}</div>
              </div>
            ))}
          </div>
          <p className="mt-3 text-sm leading-6">
            Widerruf von <b>{revocationImpact.matchedEvidenceIds.join(", ")}</b> betrifft <b>{revocationImpact.affectedConstraintIds.join(", ")}</b> im Feld <b>{revocationImpact.affectedFields.join(", ")}</b>.
          </p>
        </section>

        <section className="space-y-3 text-sm leading-6">
          <h2 className="text-xl font-semibold">Was ist damit bewiesen?</h2>
          <p><b>1.</b> Die Source bleibt gleich.</p>
          <p><b>2.</b> Ein Release entsteht erst, wenn die konkreten Blocker durch passende Evidenz aufgelöst sind.</p>
          <p><b>3.</b> Wird eine Release-Grundlage widerrufen, fällt die Entscheidung kontrolliert zurück.</p>

          <details className="pt-2 text-muted-foreground">
            <summary className="cursor-pointer font-semibold text-foreground">Technische Details anzeigen</summary>
            <div className="mt-3 space-y-2 text-xs leading-5">
              <p>Stage 0: {stage0.state.state} · Release {String(stage0.release.releaseAllowed)}</p>
              <p>Stage 1: {stage1.state.state} · Release {String(stage1.release.releaseAllowed)}</p>
              <p>Stage 2: {stage2.state.state} · Release {String(stage2.release.releaseAllowed)}</p>
              <p>Stage 3: {stage3.state.state} · Release {String(stage3.release.releaseAllowed)}</p>
              <p>Revocation impact: {String(revocationImpact.impacted)}</p>
            </div>
          </details>

          <p className="pt-3 text-xs text-muted-foreground">
            Synthetische Demo-Evidenz. Beweist den Governance-Mechanismus, nicht reale Northwind-Fachsemantik oder einen produktiven Kundenfall.
          </p>
        </section>
      </div>
    </main>
  );
}
