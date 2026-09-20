import test from "node:test";
import assert from "node:assert/strict";

import {
  demoValidRecord,
  evaluateRecord,
} from "../.bridge-test-build/bridge-pipeline.js";

const capturedAt = "2026-09-20T20:45:00.000Z";

function blockingIds(evaluation) {
  return evaluation.constraints
    .filter(({ passed, severity }) => !passed && severity === "blocking")
    .map(({ id }) => id);
}

test("demo case 2: unknown LEGACY_FLAG stays a warning and does not block release", () => {
  const raw = { ...demoValidRecord, LEGACY_FLAG: "X" };
  const evaluation = evaluateRecord(raw, capturedAt);

  const unknownField = evaluation.constraints.find(({ id }) => id === "contract.unknown_fields");
  assert.ok(unknownField, "Expected contract.unknown_fields warning");
  assert.equal(unknownField.passed, false);
  assert.equal(unknownField.severity, "warning");
  assert.match(unknownField.evidence, /LEGACY_FLAG/);

  assert.equal(evaluation.release.releaseAllowed, true);
  assert.equal(evaluation.release.blockingIssues, 0);
  assert.deepEqual(blockingIds(evaluation), []);
});

test("demo case 3: missing KUNDEN_NR blocks without inventing a replacement", () => {
  const raw = { ...demoValidRecord, KUNDEN_NR: "" };
  const evaluation = evaluateRecord(raw, capturedAt);
  const blockers = blockingIds(evaluation);

  assert.equal(evaluation.raw.KUNDEN_NR, "");
  assert.equal(evaluation.mapped.customerId, null);
  assert.equal(evaluation.release.releaseAllowed, false);
  assert.ok(blockers.includes("contract.schema"));
  assert.ok(blockers.includes("customer.required"));
  assert.ok(
    evaluation.issues.some(
      ({ field, issue, severity }) =>
        field === "KUNDEN_NR" && issue === "MISSING_REQUIRED_VALUE" && severity === "blocking",
    ),
  );
});

test("demo case 4: STATUS=UNBEKANNT is schema-valid but semantically unresolved", () => {
  const raw = { ...demoValidRecord, STATUS: "UNBEKANNT" };
  const evaluation = evaluateRecord(raw, capturedAt);
  const blockers = blockingIds(evaluation);

  const contractSchema = evaluation.constraints.find(({ id }) => id === "contract.schema");
  const statusMap = evaluation.constraints.find(({ id }) => id === "status.value_map");
  const statusSemantics = evaluation.semantics.find(({ field }) => field === "STATUS");

  assert.equal(contractSchema?.passed, true);
  assert.equal(statusMap?.passed, false);
  assert.equal(statusMap?.severity, "blocking");
  assert.deepEqual(blockers, ["status.value_map"]);
  assert.equal(evaluation.mapped.status, null);
  assert.equal(evaluation.release.releaseAllowed, false);
  assert.equal(evaluation.release.blockingIssues, 1);
  assert.match(statusSemantics?.valueMeaning ?? "", /keine bestätigte Value-Map/);
  assert.match(statusSemantics?.valueMeaning ?? "", /STATUS=UNBEKANNT/);
});
