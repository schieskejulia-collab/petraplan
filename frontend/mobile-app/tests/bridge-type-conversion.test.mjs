import test from "node:test";
import assert from "node:assert/strict";

import { assessTypeConversion } from "../.bridge-test-build/bridge-type-conversion.js";

function basePolicy(overrides = {}) {
  return {
    sourceField: "SOURCE",
    targetField: "target",
    sourceType: "string",
    targetType: "integer",
    ...overrides,
  };
}

test("plain integer text converts safely when no information is lost", () => {
  const result = assessTypeConversion("12", basePolicy());
  assert.equal(result.safety, "safe");
  assert.equal(result.convertedValue, 12);
  assert.equal(result.mutationPolicy, "no_auto_fix");
  assert.equal(result.releaseAuthority, "none");
});

test("leading zeros require confirmation instead of being silently dropped", () => {
  const result = assessTypeConversion("00123", basePolicy());
  assert.equal(result.safety, "needs_confirmation");
  assert.equal(result.convertedValue, null);
});

test("missing value is not converted to zero", () => {
  const result = assessTypeConversion("NULL", basePolicy());
  assert.equal(result.safety, "needs_confirmation");
  assert.equal(result.convertedValue, null);
});

test("non-numeric integer text is blocked", () => {
  const result = assessTypeConversion("12A", basePolicy());
  assert.equal(result.safety, "blocked");
});

test("decimal with point is safe", () => {
  const result = assessTypeConversion("12.50", basePolicy({ targetType: "decimal" }));
  assert.equal(result.safety, "safe");
  assert.equal(result.convertedValue, 12.5);
});

test("decimal comma needs locale confirmation", () => {
  const result = assessTypeConversion("12,50", basePolicy({ targetType: "decimal" }));
  assert.equal(result.safety, "needs_confirmation");
});

test("decimal comma is safe only when explicitly allowed", () => {
  const result = assessTypeConversion(
    "12,50",
    basePolicy({ targetType: "decimal", allowLocaleDecimalComma: true }),
  );
  assert.equal(result.safety, "safe");
  assert.equal(result.convertedValue, 12.5);
});

test("scientific notation needs confirmation unless contract allows it", () => {
  const result = assessTypeConversion("1e3", basePolicy({ targetType: "decimal" }));
  assert.equal(result.safety, "needs_confirmation");
});

test("valid leap day converts to canonical date", () => {
  const result = assessTypeConversion(
    "29.02.2024",
    basePolicy({ targetType: "date", sourceFormat: "DD.MM.YYYY", targetFormat: "YYYY-MM-DD" }),
  );
  assert.equal(result.safety, "safe");
  assert.equal(result.convertedValue, "2024-02-29");
});

test("invalid calendar date is blocked", () => {
  const result = assessTypeConversion(
    "29.02.2025",
    basePolicy({ targetType: "date", sourceFormat: "DD.MM.YYYY", targetFormat: "YYYY-MM-DD" }),
  );
  assert.equal(result.safety, "blocked");
});

test("date without explicit source format requires confirmation", () => {
  const result = assessTypeConversion("07.09.2026", basePolicy({ targetType: "date" }));
  assert.equal(result.safety, "needs_confirmation");
});

test("timestamp without timezone requires confirmation", () => {
  const result = assessTypeConversion(
    "2026-09-07T13:15:00",
    basePolicy({ targetType: "timestamp", sourceFormat: "ISO-8601" }),
  );
  assert.equal(result.safety, "needs_confirmation");
});

test("timestamp with explicit timezone converts safely", () => {
  const result = assessTypeConversion(
    "2026-09-07T13:15:00+02:00",
    basePolicy({ targetType: "timestamp", sourceFormat: "ISO-8601" }),
  );
  assert.equal(result.safety, "safe");
  assert.equal(result.convertedValue, "2026-09-07T11:15:00.000Z");
});

test("unimplemented type pair remains conservative", () => {
  const result = assessTypeConversion(
    "42",
    basePolicy({ sourceType: "integer", targetType: "string" }),
  );
  assert.equal(result.safety, "needs_confirmation");
});
