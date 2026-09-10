import test from "node:test";
import assert from "node:assert/strict";
import { assessIngressContext } from "../.bridge-test-build/bridge-ingress-context.js";

const base = {
  authStatus: "verified",
  connectionStatus: "connected",
  freshnessStatus: "current",
  contentType: "application/json",
  expectedContentTypes: ["application/json"],
  verificationStatus: "verified",
  observedAt: "2026-09-10T15:35:00+02:00",
  source: "system_a",
};

test("trusted ingress context passes all five checks", () => {
  const assessment = assessIngressContext(base);
  assert.equal(assessment.contextTrusted, true);
  assert.deepEqual(assessment.failedCheckIds, []);
  assert.equal(assessment.checks.length, 5);
});

test("unverified auth prevents trusted context", () => {
  const assessment = assessIngressContext({ ...base, authStatus: "unverified" });
  assert.equal(assessment.contextTrusted, false);
  assert.deepEqual(assessment.failedCheckIds, ["ingress.auth"]);
});

test("timeout prevents semantic trust", () => {
  const assessment = assessIngressContext({ ...base, connectionStatus: "timeout" });
  assert.equal(assessment.contextTrusted, false);
  assert.ok(assessment.failedCheckIds.includes("ingress.connection"));
});

test("stale cache state is not treated as current source truth", () => {
  const assessment = assessIngressContext({ ...base, freshnessStatus: "stale" });
  assert.equal(assessment.contextTrusted, false);
  assert.ok(assessment.failedCheckIds.includes("ingress.freshness"));
});

test("content type parameters do not change the normalized MIME type", () => {
  const assessment = assessIngressContext({ ...base, contentType: "Application/JSON; charset=utf-8" });
  assert.equal(assessment.contextTrusted, true);
});

test("unexpected HTML is not silently parsed as JSON", () => {
  const assessment = assessIngressContext({ ...base, contentType: "text/html" });
  assert.equal(assessment.contextTrusted, false);
  assert.ok(assessment.failedCheckIds.includes("ingress.content_type"));
});

test("formal plausibility without verification stays untrusted", () => {
  const assessment = assessIngressContext({ ...base, verificationStatus: "unverified" });
  assert.equal(assessment.contextTrusted, false);
  assert.ok(assessment.failedCheckIds.includes("ingress.verification"));
});

test("source policy always preserves the incoming source", () => {
  const assessment = assessIngressContext({
    ...base,
    authStatus: "unverified",
    freshnessStatus: "unknown",
    verificationStatus: "failed",
  });
  assert.equal(assessment.sourcePolicy, "preserve");
  assert.equal(assessment.interpretationPolicy, "do_not_interpret_until_context_trusted");
});
