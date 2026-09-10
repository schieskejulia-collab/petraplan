import test from "node:test";
import assert from "node:assert/strict";
import { assessAddressingAndComparison } from "../.bridge-test-build/bridge-addressing.js";

const base = {
  representationStatus: "confirmed",
  representation: "UTF-8",
  expectedRepresentation: "utf-8",
  comparisonRuleStatus: "explicit",
  comparisonRule: "strict_equals",
  sequenceStatus: "defined",
  sequence: [1, 2, 3, 4, 5],
  addressStatus: "resolved",
  address: "system_a/orders/A-10027",
  identityStatus: "confirmed",
  recordId: "A-10027",
  correlationId: "corr:msg:system_a:A-10027:2026-09-10T18:52:00+02:00",
  source: "system_a",
};

test("addressing assessment passes when all five dimensions are explicit", () => {
  const assessment = assessAddressingAndComparison(base);
  assert.equal(assessment.addressingReady, true);
  assert.deepEqual(assessment.failedCheckIds, []);
  assert.equal(assessment.checks.length, 5);
});

test("representation mismatch is not treated as equivalent", () => {
  const assessment = assessAddressingAndComparison({
    ...base,
    representationStatus: "mismatch",
    representation: "ISO-8859-1",
  });
  assert.equal(assessment.addressingReady, false);
  assert.ok(assessment.failedCheckIds.includes("addressing.representation"));
});

test("missing comparison rule blocks reliable comparison", () => {
  const assessment = assessAddressingAndComparison({
    ...base,
    comparisonRuleStatus: "missing",
    comparisonRule: "",
  });
  assert.equal(assessment.addressingReady, false);
  assert.ok(assessment.failedCheckIds.includes("addressing.comparison_rule"));
});

test("duplicate or unsorted sequence is not deterministic", () => {
  const duplicate = assessAddressingAndComparison({ ...base, sequence: [1, 2, 2, 4] });
  const unsorted = assessAddressingAndComparison({ ...base, sequence: [1, 3, 2, 4] });
  assert.equal(duplicate.addressingReady, false);
  assert.equal(unsorted.addressingReady, false);
  assert.ok(duplicate.failedCheckIds.includes("addressing.sequence"));
  assert.ok(unsorted.failedCheckIds.includes("addressing.sequence"));
});

test("ambiguous locator never guesses which record is meant", () => {
  const assessment = assessAddressingAndComparison({
    ...base,
    addressStatus: "ambiguous",
    address: "orders/A-10027",
  });
  assert.equal(assessment.addressingReady, false);
  assert.ok(assessment.failedCheckIds.includes("addressing.address"));
});

test("identity requires both record and correlation id", () => {
  const assessment = assessAddressingAndComparison({
    ...base,
    correlationId: "",
  });
  assert.equal(assessment.addressingReady, false);
  assert.ok(assessment.failedCheckIds.includes("addressing.identity"));
});

test("confirmed identity does not claim that content is true", () => {
  const assessment = assessAddressingAndComparison(base);
  assert.equal(assessment.addressingReady, true);
  assert.equal(assessment.releaseAuthority, "none");
});

test("assessment always preserves the source", () => {
  const assessment = assessAddressingAndComparison({
    ...base,
    representationStatus: "unconfirmed",
    addressStatus: "missing",
    identityStatus: "conflicting",
  });
  assert.equal(assessment.sourcePolicy, "preserve");
  assert.equal(assessment.releaseAuthority, "none");
});
