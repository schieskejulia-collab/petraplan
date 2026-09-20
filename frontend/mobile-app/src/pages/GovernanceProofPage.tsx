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
const stage3 = evaluateWithGovernedEvidence(
  raw,
  capturedAt,
  [quantityEvidence, statusEvidence],
  revokedEvidenceIds,
);
const revocationImpact = assessReleaseImpact(stage2.release.releaseBasis, revokedEvidenceIds);

const steps = [
  {
    number: "01",
    label: "BLOCKED",
    state: stage0.state.state,
    releaseAllowed: stage0.release.releaseAllowed,
    detail: "STATUS ist unbestätigt und MENGE=-4 verletzt die Ausgangsregel.",
    evidence: "Keine zusätzliche Evidenz",
  },
  {
    number: "02",
    label: "NEEDS CONFIRMATION",
    state: stage1.state.state,
    releaseAllowed: stage1.release.releaseAllowed,
    detail: "Die Mengenregel ist bestätigt. Die Statusbedeutung bleibt offen.",
    evidence: `${quantityEvidence.reviewId} · ${quantityEvidence.version}`,
  },
  {
    number: "03",
    label: "RELEASED",
    state: stage2.state.state,
    releaseAllowed: stage2.release.releaseAllowed,
    detail: "Beide blockierenden Punkte sind durch passende Demo-Evidenz aufgelöst.",
    evidence: `${statusEvidence.reviewId} · ${statusEvidence.version}`,
  },
  {
    number: "04",
    label: "REVOKED",
    state: stage3.state.state,
    releaseAllowed: stage3.release.releaseAllowed,
    detail: "Die Status-Evidenz wurde widerrufen. Derselbe Datensatz fällt zurück in NEEDS_CONFIRMATION.",
    evidence: statusEvidence.evidenceId,
  },
];

function stateBadge(state: string, releaseAllowed: boolean) {
  const label = releaseAllowed ? "RELEASED" : state;
  return (
    <span className="rounded-full border px-2.5 py-1 text-[11px] font-semibold tracking-wide">
      {label}
    </span>
  );
}

export default function GovernanceProofPage() {
  const [, setLocation] = useLocation();

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-3xl space-y-5 px-4 py-6">
        <header className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => setLocation("/cases")}
              className="rounded-lg border px-3 py-2 text-sm font-semibold"
            >
              Zurück
            </button>
            <span className="rounded-full border px-2.5 py-1 text-[11px] font-semibold">DEMO-ONLY</span>
          </div>
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">PetraPlan · Governance Proof</p>
            <h1 className="text-3xl font-semibold">Kontrollierte Evidenz</h1>
            <p className="text-sm leading-6 text-muted-foreground">
              Sichtbarer Nachweis, wie derselbe Source-Datensatz durch bestätigte Evidenz neu bewertet wird — ohne Source Truth zu verändern.
            </p>
          </div>
        </header>

        <section className="rounded-2xl border bg-card p-4 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Source Truth</p>
              <h2 className="mt-1 text-lg font-semibold">{raw.AUFTRAGS_NR}</h2>
            </div>
            <span className="rounded-full border px-2.5 py-1 text-[11px] font-semibold">UNVERÄNDERT</span>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
            <div><span className="text-muted-foreground">Kunde</span><div className="font-medium">{raw.KUNDEN_NR}</div></div>
            <div><span className="text-muted-foreground">Status</span><div className="font-medium">{raw.STATUS}</div></div>
            <div><span className="text-muted-foreground">Menge</span><div className="font-medium">{raw.MENGE}</div></div>
            <div><span className="text-muted-foreground">Datum</span><div className="font-medium">{raw.DATUM}</div></div>
          </div>
          <p className="mt-4 break-all text-[11px] text-muted-foreground">Snapshot: {stage0.sourceSnapshotId}</p>
        </section>

        <section className="space-y-3">
          <div>
            <h2 className="text-xl font-semibold">Zustandsfolge</h2>
            <p className="mt-1 text-sm text-muted-foreground">Jede Stufe wertet dieselbe Source neu aus.</p>
          </div>

          {steps.map((step, index) => (
            <div key={step.number} className="relative rounded-2xl border bg-card p-4 shadow-sm">
              <div className="flex items-start gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border text-xs font-bold">{step.number}</div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="font-semibold">{step.label}</h3>
                    {stateBadge(step.state, step.releaseAllowed)}
                  </div>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">{step.detail}</p>
                  <p className="mt-3 text-xs"><span className="text-muted-foreground">Evidenz:</span> {step.evidence}</p>
                </div>
              </div>
              {index < steps.length - 1 && (
                <div className="ml-[17px] mt-3 h-5 border-l" aria-hidden="true" />
              )}
            </div>
          ))}
        </section>

        <section className="rounded-2xl border bg-card p-4 shadow-sm">
          <h2 className="text-xl font-semibold">Maschinenlesbare Release-Basis</h2>
          <p className="mt-1 text-sm text-muted-foreground">Der Release ist nicht nur true/false, sondern auf konkrete Evidenz zurückführbar.</p>
          <div className="mt-4 space-y-3">
            {stage2.release.releaseBasis.map((item) => (
              <div key={item.evidenceId} className="rounded-xl border p-3 text-sm">
                <div className="font-semibold">{item.evidenceId}</div>
                <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                  <div><span className="text-muted-foreground">Version</span><div>{item.version}</div></div>
                  <div><span className="text-muted-foreground">Review</span><div>{item.reviewId}</div></div>
                  <div><span className="text-muted-foreground">Constraint</span><div>{item.constraintId}</div></div>
                  <div><span className="text-muted-foreground">Feld</span><div>{item.field}</div></div>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-2xl border bg-card p-4 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-xl font-semibold">Widerruf & Impact</h2>
              <p className="mt-1 text-sm text-muted-foreground">Welche frühere Freigabe hing an der widerrufenen Evidenz?</p>
            </div>
            {stateBadge(stage3.state.state, stage3.release.releaseAllowed)}
          </div>
          <div className="mt-4 space-y-2 text-sm">
            <p><span className="text-muted-foreground">Betroffen:</span> {revocationImpact.impacted ? "Ja" : "Nein"}</p>
            <p><span className="text-muted-foreground">Evidence:</span> {revocationImpact.matchedEvidenceIds.join(", ") || "—"}</p>
            <p><span className="text-muted-foreground">Constraint:</span> {revocationImpact.affectedConstraintIds.join(", ") || "—"}</p>
            <p><span className="text-muted-foreground">Feld:</span> {revocationImpact.affectedFields.join(", ") || "—"}</p>
          </div>
        </section>

        <section className="rounded-2xl border border-dashed p-4 text-sm leading-6 text-muted-foreground">
          Dieser sichtbare Nachweis verwendet ausschließlich synthetische Demo-Evidenz. Er beweist den Governance-Mechanismus, nicht reale Northwind-Fachsemantik oder einen produktiven Kundenfall.
        </section>
      </div>
    </main>
  );
}
