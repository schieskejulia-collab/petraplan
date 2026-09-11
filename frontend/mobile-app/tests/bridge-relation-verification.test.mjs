import test from "node:test";
import assert from "node:assert/strict";

import { demoValidRecord } from "../.bridge-test-build/bridge-pipeline.js";
import { demoOrderToCustomerEvidence } from "../.bridge-test-build/bridge-relation-demo.js";
import { evaluateRecordWithInstanceProfile } from "../.bridge-test-build/bridge-profiled-evaluation.js";

test("profiled release stays blocked without observed relation proof", () => {
  const result = evaluateRecordWithInstanceProfile(
    demoValidRecord,
    "2026-09-11T18:10:00.000Z",
  );

  assert.equal(result.state.state, "VALID");
  assert.equal(result.relationDecision.status, "needs_confirmation");
  assert.equal(result.relationDecision.releaseAllowed, false);
  assert.equal(result.release.releaseAllowed, false);
  assert.ok(result.release.blockingIssues >= 1);
  assert.ok(result.report.nextStep.includes("Record-Link"));

  const explanation = result.report.relationExplanations[0];
  assert.equal(explanation.status, "needs_confirmation");
  assert.ok(explanation.remainsUnproven.some((item) => item.includes("Zielidentität")));
  assert.ok(explanation.remainsUnproven.some((item) => item.includes("Record-Link")));
});

test("observed customer target confirms record link without inventing FK/cardinality", () => {
  const result = evaluateRecordWithInstanceProfile(
    demoValidRecord,
    "2026-09-11T18:10:00.000Z",
    {},
    {},
    [demoOrderToCustomerEvidence],
  );

  assert.equal(result.relationVerifications.length, 1);

  const verification = result.relationVerifications[0];
  assert.equal(verification.relationId, "order_to_customer_reference");
  assert.equal(verification.semanticStatus, "confirmed");
  assert.equal(verification.targetIdentityStatus, "confirmed");
  assert.equal(verification.technicalLinkStatus, "confirmed");
  assert.equal(verification.targetField, "CUSTOMER_ID");
  assert.equal(verification.matchedValue, "4711");

  // The demo proves a concrete record match, not database metadata.
  assert.equal(verification.foreignKeyConstraintStatus, "unresolved");
  assert.equal(verification.cardinalityStatus, "unresolved");
  assert.equal(verification.cardinality, "unknown");
  assert.ok(verification.blockers.some((item) => item.includes("Foreign-Key")));
  assert.ok(verification.blockers.some((item) => item.includes("Kardinalität")));

  // FK/cardinality remain visible open metadata, but do not block the concrete
  // record-level relation once meaning, target identity and link are confirmed.
  assert.equal(result.relationDecision.status, "confirmed");
  assert.equal(result.relationDecision.releaseAllowed, true);
  assert.equal(result.release.releaseAllowed, true);

  assert.ok(
    result.report.relationFindings.some((item) =>
      item.includes("Record-Link=confirmed") && item.includes("Zielidentität=confirmed"),
    ),
  );

  const explanation = result.report.relationExplanations[0];
  assert.equal(explanation.status, "confirmed");
  assert.ok(explanation.confirmedBy.some((item) => item.includes("CUSTOMER_ID=4711")));
  assert.ok(explanation.confirmedBy.some((item) => item.includes("KUNDEN_NR=4711")));
  assert.ok(explanation.remainsUnproven.some((item) => item.includes("Foreign-Key")));
  assert.ok(explanation.remainsUnproven.some((item) => item.includes("Kardinalität")));
  assert.ok(explanation.conclusion.includes("Record-Link ist bestätigt"));
});
