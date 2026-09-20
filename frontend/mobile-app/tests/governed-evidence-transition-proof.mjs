import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";

import {
  assessReleaseImpact,
  evaluateWithGovernedEvidence,
} from "../.bridge-governance-build/bridge-governed-evidence.js";

const capturedAt = "2026-09-20T20:52:00.000Z";
const raw = {
  KUNDEN_NR: "4711",
  AUFTRAGS_NR: "A-10027",
  STATUS: "UNBEKANNT",
  MENGE: "-4",
  DATUM: "20.09.2026",
};

const quantityEvidence = {
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
  rationale: "Synthetische Testbestaetigung: exakt -4 darf in diesem Demo-Fall als bestaetigter Wert passieren. Keine Aussage ueber reale Fachsemantik.",
};

const statusEvidence = {
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
  rationale: "Synthetische Testbestaetigung: UNBEKANNT wird nur fuer diesen Governance-Proof auf in_progress abgebildet. Keine reale Northwind-Zuordnung.",
};

const stage0 = evaluateWithGovernedEvidence(raw, capturedAt, []);
const stage1 = evaluateWithGovernedEvidence(raw, capturedAt, [quantityEvidence]);
const stage2 = evaluateWithGovernedEvidence(raw, capturedAt, [quantityEvidence, statusEvidence]);
const stage3 = evaluateWithGovernedEvidence(
  raw,
  capturedAt,
  [quantityEvidence, statusEvidence],
  [statusEvidence.evidenceId],
);

assert.equal(stage0.state.state, "BLOCKED");
assert.equal(stage0.release.releaseAllowed, false);
assert.deepEqual(stage0.release.failedConstraintIds, ["status.value_map", "quantity.positive"]);

assert.equal(stage1.state.state, "NEEDS_CONFIRMATION");
assert.equal(stage1.release.releaseAllowed, false);
assert.deepEqual(stage1.release.failedConstraintIds, ["status.value_map"]);
assert.deepEqual(stage1.appliedEvidence.map(({ evidenceId }) => evidenceId), [quantityEvidence.evidenceId]);

assert.equal(stage2.state.state, "VALID");
assert.equal(stage2.release.releaseAllowed, true);
assert.deepEqual(stage2.release.failedConstraintIds, []);
assert.equal(stage2.governedMapped.status, "in_progress");

const releaseBasisComparable = stage2.release.releaseBasis
  .map(({ evidenceId, version, reviewId, constraintId }) => ({ evidenceId, version, reviewId, constraintId }))
  .sort((a, b) => a.constraintId.localeCompare(b.constraintId));
const expectedReleaseBasis = [
  {
    evidenceId: quantityEvidence.evidenceId,
    version: quantityEvidence.version,
    reviewId: quantityEvidence.reviewId,
    constraintId: quantityEvidence.constraintId,
  },
  {
    evidenceId: statusEvidence.evidenceId,
    version: statusEvidence.version,
    reviewId: statusEvidence.reviewId,
    constraintId: statusEvidence.constraintId,
  },
].sort((a, b) => a.constraintId.localeCompare(b.constraintId));
assert.deepEqual(releaseBasisComparable, expectedReleaseBasis);

// Revocation proof: withdrawing the status evidence must invalidate the previous release basis.
const revocationImpact = assessReleaseImpact(stage2.release.releaseBasis, [statusEvidence.evidenceId]);
assert.equal(revocationImpact.impacted, true);
assert.deepEqual(revocationImpact.matchedEvidenceIds, [statusEvidence.evidenceId]);
assert.deepEqual(revocationImpact.affectedConstraintIds, ["status.value_map"]);
assert.deepEqual(revocationImpact.affectedFields, ["STATUS"]);

assert.equal(stage3.state.state, "NEEDS_CONFIRMATION");
assert.equal(stage3.release.releaseAllowed, false);
assert.deepEqual(stage3.release.failedConstraintIds, ["status.value_map"]);
assert.equal(stage3.governedMapped.status, null);
assert.ok(stage3.ignoredEvidenceIds.includes(statusEvidence.evidenceId));
assert.deepEqual(stage3.revokedEvidenceIds, [statusEvidence.evidenceId]);
assert.deepEqual(stage3.appliedEvidence.map(({ evidenceId }) => evidenceId), [quantityEvidence.evidenceId]);

assert.deepEqual(stage0.raw, raw);
assert.deepEqual(stage1.raw, raw);
assert.deepEqual(stage2.raw, raw);
assert.deepEqual(stage3.raw, raw);
assert.equal(stage0.sourceSnapshotId, stage1.sourceSnapshotId);
assert.equal(stage1.sourceSnapshotId, stage2.sourceSnapshotId);
assert.equal(stage2.sourceSnapshotId, stage3.sourceSnapshotId);

const mismatched = evaluateWithGovernedEvidence(raw, capturedAt, [
  { ...statusEvidence, evidenceId: "E-WRONG", sourceValue: "OFFEN" },
]);
assert.equal(mismatched.state.state, "BLOCKED");
assert.ok(mismatched.ignoredEvidenceIds.includes("E-WRONG"));
assert.ok(mismatched.release.failedConstraintIds.includes("status.value_map"));

const proof = {
  proof: "governed-evidence-transition-proof-v2",
  warning: "Synthetic demo evidence only. This does not assert real Northwind business semantics.",
  sourceSnapshotId: stage0.sourceSnapshotId,
  rawSourcePreserved: true,
  stages: [
    {
      stage: "01_BLOCKED",
      state: stage0.state.state,
      releaseAllowed: stage0.release.releaseAllowed,
      failedConstraintIds: stage0.release.failedConstraintIds,
      appliedEvidence: stage0.appliedEvidence,
    },
    {
      stage: "02_NEEDS_CONFIRMATION",
      state: stage1.state.state,
      releaseAllowed: stage1.release.releaseAllowed,
      failedConstraintIds: stage1.release.failedConstraintIds,
      appliedEvidence: stage1.appliedEvidence,
    },
    {
      stage: "03_RELEASED",
      state: stage2.state.state,
      releaseAllowed: stage2.release.releaseAllowed,
      failedConstraintIds: stage2.release.failedConstraintIds,
      canonicalStatus: stage2.governedMapped.status,
      releaseBasis: stage2.release.releaseBasis,
    },
    {
      stage: "04_REVOKED_REEVALUATION",
      revokedEvidenceIds: stage3.revokedEvidenceIds,
      priorReleaseImpact: revocationImpact,
      state: stage3.state.state,
      releaseAllowed: stage3.release.releaseAllowed,
      failedConstraintIds: stage3.release.failedConstraintIds,
      appliedEvidence: stage3.appliedEvidence,
    },
  ],
};

const markdown = `# Governed Evidence Transition + Revocation Proof\n\n` +
  `> **Synthetischer Demo-Beweis.** Die bestaetigten Regeln und Statusbedeutungen in diesem Test sind keine Aussage ueber reale Northwind-Semantik.\n\n` +
  `## Source Truth\n\n` +
  `Snapshot: \`${proof.sourceSnapshotId}\`\n\n` +
  `Die Raw-Source bleibt in allen vier Stufen wertgleich erhalten.\n\n` +
  `## Zustandsfolge\n\n` +
  `1. **BLOCKED** - STATUS ist unbestaetigt und MENGE=-4 verletzt die bestaetigte Ausgangsregel.\n` +
  `2. **NEEDS_CONFIRMATION** - Review ${quantityEvidence.reviewId} / ${quantityEvidence.version} bestaetigt exakt den beobachteten Mengenfall fuer diesen Demo-Kontext. STATUS bleibt offen.\n` +
  `3. **RELEASED (VALID)** - Review ${statusEvidence.reviewId} / ${statusEvidence.version} bestaetigt die Demo-Zuordnung STATUS=UNBEKANNT -> in_progress. Keine BLOCKING-Constraints bleiben offen.\n` +
  `4. **REVOKED -> NEEDS_CONFIRMATION** - Evidence ${statusEvidence.evidenceId} wird widerrufen. Die Bridge erkennt, dass der vorherige Release davon abhing, verwirft diese Evidence bei der Neubewertung und oeffnet status.value_map wieder.\n\n` +
  `## Maschinenlesbare Release-Basis\n\n` +
  '```json\n' + JSON.stringify(stage2.release.releaseBasis, null, 2) + '\n```\n\n' +
  `## Maschinenlesbarer Widerrufs-Impact\n\n` +
  '```json\n' + JSON.stringify(revocationImpact, null, 2) + '\n```\n\n' +
  `## Sicherheitsnachweis\n\n` +
  `- Keine Source-Mutation in irgendeiner Stufe.\n` +
  `- Evidence gilt nur fuer exakten Constraint + Feld + Quellwert.\n` +
  `- Falsche/mismatched Evidence wird ignoriert.\n` +
  `- Widerrufene Evidence wird nicht mehr angewendet.\n` +
  `- Ein frueherer Release kann ueber seine Release-Basis auf betroffene Evidence, Constraints und Felder zurueckgefuehrt werden.\n` +
  `- Nach Widerruf werden alle BLOCKING-Constraints erneut ausgewertet; der Datensatz faellt kontrolliert zurueck in NEEDS_CONFIRMATION.\n`;

await Promise.all([
  writeFile("governed-evidence-transition-proof.json", `${JSON.stringify(proof, null, 2)}\n`, "utf8"),
  writeFile("governed-evidence-transition-proof.md", markdown, "utf8"),
]);

console.log("GOVERNED_EVIDENCE_TRANSITION_PROOF");
console.log(JSON.stringify(proof, null, 2));
