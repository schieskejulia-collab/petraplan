import test from "node:test";
import assert from "node:assert/strict";

import { decideReadAccess } from "../.bridge-test-build/bridge-read-access-decision.js";

const readySource = {
  checks: [
    { id: "readiness.ingress", passed: true, observed: "trusted" },
    { id: "readiness.addressing", passed: true, observed: "ready" },
  ],
  sourceReady: true,
  failedCheckIds: [],
  sourcePolicy: "preserve",
  writePolicy: "forbidden",
  releaseAuthority: "none",
  interpretationPolicy: "do_not_interpret_until_source_ready",
  principle: "trust_context_address_source_verify_adapter_profile_capabilities_gate_operation_then_interpret",
};

const readyPlan = {
  status: "ready",
  mode: "expand_on_demand",
  rootAddress: "orders/A-10027",
  requestedFields: ["AUFTRAGS_NR"],
  targets: [],
  maxRelationDepth: 1,
  blockers: [],
  evidence: ["root address confirmed"],
  sourcePolicy: "preserve",
  writePolicy: "forbidden",
  loadingPolicy: "read_only_expand_on_demand",
  note: "ready",
};

const freshSourceSnapshot = {
  sourceSnapshotId: "snap:1",
  readOrigin: "source",
  capturedAt: "2026-09-11T20:00:00.000Z",
  assessedAt: "2026-09-11T20:01:00.000Z",
  maxAgeMs: 300000,
  ageMs: 60000,
  status: "confirmed",
  freshnessStatus: "fresh",
  cacheIsSourceTruth: false,
  evidence: ["freshness policy confirmed"],
  blockers: [],
  note: "fresh",
};

test("allows a targeted read only when source, plan and freshness are confirmed", () => {
  const result = decideReadAccess({
    sourceReadiness: readySource,
    readPlan: readyPlan,
    freshness: freshSourceSnapshot,
  });

  assert.equal(result.status, "ready");
  assert.equal(result.readAllowed, true);
  assert.equal(result.refreshRequired, false);
  assert.equal(result.writePolicy, "forbidden");
});

test("a confirmed stale snapshot requires refresh instead of silent reuse", () => {
  const result = decideReadAccess({
    sourceReadiness: readySource,
    readPlan: readyPlan,
    freshness: {
      ...freshSourceSnapshot,
      freshnessStatus: "stale",
      ageMs: 600000,
      blockers: ["snapshot is stale"],
    },
  });

  assert.equal(result.status, "refresh_required");
  assert.equal(result.readAllowed, false);
  assert.equal(result.refreshRequired, true);
  assert.match(result.note, /erneut gegen die Quelle gelesen/);
});

test("unconfirmed freshness never becomes a usable read merely because the plan is ready", () => {
  const result = decideReadAccess({
    sourceReadiness: readySource,
    readPlan: readyPlan,
    freshness: {
      ...freshSourceSnapshot,
      status: "candidate",
      freshnessStatus: "fresh",
    },
  });

  assert.equal(result.status, "needs_confirmation");
  assert.equal(result.readAllowed, false);
});

test("source readiness failure blocks the read even with a fresh snapshot", () => {
  const result = decideReadAccess({
    sourceReadiness: {
      ...readySource,
      sourceReady: false,
      failedCheckIds: ["readiness.adapter"],
    },
    readPlan: readyPlan,
    freshness: freshSourceSnapshot,
  });

  assert.equal(result.status, "blocked");
  assert.equal(result.readAllowed, false);
});

test("a fresh cache copy may satisfy the read gate but never becomes source truth", () => {
  const result = decideReadAccess({
    sourceReadiness: readySource,
    readPlan: readyPlan,
    freshness: {
      ...freshSourceSnapshot,
      readOrigin: "cache",
      cacheIsSourceTruth: false,
    },
  });

  assert.equal(result.status, "ready");
  assert.equal(result.readAllowed, true);
  assert.equal(result.cachePolicy, "cache_never_source_truth");
  assert.match(result.note, /niemals Source Truth/);
});
