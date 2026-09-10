import test from "node:test";
import assert from "node:assert/strict";
import { evaluateEvidence } from "../.bridge-test-build/bridge-evidence.js";

const proposal = {
  id: "proposal:status:unknown",
  subject: "STATUS=UNBEKANNT",
  proposedValue: "open",
  scope: "rule",
  proposedBy: "operator-a",
};

const human = {
  id: "ev:human:1",
  kind: "human_statement",
  strength: "unverified",
  scope: "rule",
  reference: "Operator vermutet: UNBEKANNT bedeutet open",
  capturedAt: "2026-09-10T10:00:00.000Z",
  submittedBy: "operator-a",
};

const supportingCase = {
  id: "ev:case:1",
  kind: "independent_case",
  strength: "supporting",
  scope: "case",
  reference: "Ähnlicher Datensatz endete mit offenem Auftrag",
  capturedAt: "2026-09-10T10:01:00.000Z",
  submittedBy: "reviewer-b",
};

const authoritativeCase = {
  id: "ev:source-record:1",
  kind: "source_system_record",
  strength: "authoritative",
  scope: "case",
  reference: "Quellsystem-Record für Auftrag A-10027",
  capturedAt: "2026-09-10T10:02:00.000Z",
  submittedBy: "system-export",
};

const authoritativeRule = {
  id: "ev:mapping:1",
  kind: "mapping_table",
  strength: "authoritative",
  scope: "rule",
  reference: "Freigegebene STATUS-Mapping-Tabelle v3",
  capturedAt: "2026-09-10T10:03:00.000Z",
  submittedBy: "system-owner",
};

test("human statement alone never becomes reusable truth", () => {
  const decision = evaluateEvidence(proposal, [human]);

  assert.equal(decision.status, "HUMAN_CONFIRMED");
  assert.equal(decision.eligibleForCaseUse, false);
  assert.equal(decision.eligibleForGlobalRule, false);
  assert.equal(decision.requiresIndependentEvidence, true);
});

test("supporting cases without authoritative evidence remain unresolved", () => {
  const decision = evaluateEvidence(proposal, [supportingCase]);

  assert.equal(decision.status, "UNRESOLVED");
  assert.equal(decision.eligibleForCaseUse, false);
  assert.equal(decision.eligibleForGlobalRule, false);
});

test("authoritative case evidence can support one case but not create a global rule", () => {
  const decision = evaluateEvidence(proposal, [human, authoritativeCase]);

  assert.equal(decision.status, "EVIDENCE_CONFIRMED");
  assert.equal(decision.eligibleForCaseUse, true);
  assert.equal(decision.eligibleForGlobalRule, false);
});

test("global rule requires authoritative rule-scoped evidence", () => {
  const decision = evaluateEvidence(proposal, [human, supportingCase, authoritativeRule]);

  assert.equal(decision.status, "EVIDENCE_CONFIRMED");
  assert.equal(decision.eligibleForCaseUse, true);
  assert.equal(decision.eligibleForGlobalRule, true);
  assert.deepEqual(decision.authoritativeEvidenceIds, ["ev:mapping:1"]);
});

test("empty or unusable references never count as evidence", () => {
  const decision = evaluateEvidence(proposal, [
    {
      ...authoritativeRule,
      id: "ev:bad",
      reference: "   ",
    },
  ]);

  assert.equal(decision.status, "UNRESOLVED");
  assert.equal(decision.eligibleForGlobalRule, false);
});

test("audit trail keeps proposal and evidence provenance", () => {
  const decision = evaluateEvidence(proposal, [human, authoritativeRule]);

  assert.equal(decision.audit.proposalId, proposal.id);
  assert.equal(decision.audit.proposedBy, proposal.proposedBy);
  assert.deepEqual(decision.audit.evidenceIds, ["ev:human:1", "ev:mapping:1"]);
});
