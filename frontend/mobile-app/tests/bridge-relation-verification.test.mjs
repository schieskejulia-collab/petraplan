import test from "node:test";
import assert from "node:assert/strict";

import { demoValidRecord } from "../.bridge-test-build/bridge-pipeline.js";
import { demoOrderToCustomerEvidence } from "../.bridge-test-build/bridge-relation-demo.js";
import { evaluateRecordWithInstanceProfile } from "../.bridge-test-build/bridge-profiled-evaluation.js";

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

  assert.ok(
    result.report.relationFindings.some((item) =>
      item.includes("Record-Link=confirmed") && item.includes("Zielidentität=confirmed"),
    ),
  );
});
