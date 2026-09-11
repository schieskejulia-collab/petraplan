import test from "node:test";
import assert from "node:assert/strict";

import {
  assessSnapshotFreshness,
  attachFreshnessAssessment,
} from "../.bridge-test-build/bridge-freshness-profile.js";
import { buildOrderInstanceProfile } from "../.bridge-test-build/bridge-instance-profile.js";

const baseInput = {
  sourceSnapshotId: "snap:test-1",
  capturedAt: "2026-09-11T18:00:00.000Z",
  assessedAt: "2026-09-11T18:02:00.000Z",
  freshnessPolicyStatus: "confirmed",
  maxAgeMs: 5 * 60 * 1000,
  evidence: ["demo policy confirms a five minute read-freshness window"],
};

test("direct source snapshot inside confirmed window is fresh", () => {
  const result = assessSnapshotFreshness({ ...baseInput, readOrigin: "source" });

  assert.equal(result.status, "confirmed");
  assert.equal(result.freshnessStatus, "fresh");
  assert.equal(result.ageMs, 2 * 60 * 1000);
  assert.equal(result.cacheIsSourceTruth, false);
  assert.equal(result.blockers.length, 0);
});

test("cache snapshot may be fresh but never becomes source truth", () => {
  const result = assessSnapshotFreshness({ ...baseInput, readOrigin: "cache" });

  assert.equal(result.status, "confirmed");
  assert.equal(result.freshnessStatus, "fresh");
  assert.equal(result.cacheIsSourceTruth, false);
  assert.ok(result.note.includes("niemals Source Truth"));
});

test("snapshot outside confirmed window is explicitly stale", () => {
  const result = assessSnapshotFreshness({
    ...baseInput,
    assessedAt: "2026-09-11T18:10:00.000Z",
    readOrigin: "source",
  });

  assert.equal(result.status, "confirmed");
  assert.equal(result.freshnessStatus, "stale");
  assert.ok(result.blockers.some((item) => item.includes("älter")));
});

test("unconfirmed freshness policy cannot produce confirmed freshness", () => {
  const result = assessSnapshotFreshness({
    ...baseInput,
    readOrigin: "cache",
    freshnessPolicyStatus: "candidate",
  });

  assert.equal(result.freshnessStatus, "fresh");
  assert.equal(result.status, "candidate");
  assert.ok(result.blockers.some((item) => item.includes("nur Kandidat")));
});

test("future timestamp remains unresolved", () => {
  const result = assessSnapshotFreshness({
    ...baseInput,
    capturedAt: "2026-09-11T18:05:00.000Z",
    assessedAt: "2026-09-11T18:02:00.000Z",
    readOrigin: "source",
  });

  assert.equal(result.freshnessStatus, "future_timestamp");
  assert.equal(result.status, "unresolved");
});

test("freshness assessment attaches to the instance profile without changing snapshot identity", () => {
  const profile = buildOrderInstanceProfile({
    raw: { KUNDEN_NR: "4711", AUFTRAGS_NR: "A-10027" },
    source: "legacy_orders",
    sourceSnapshotId: "snap:test-1",
    observedAt: baseInput.capturedAt,
  });
  const assessment = assessSnapshotFreshness({ ...baseInput, readOrigin: "cache" });
  const attached = attachFreshnessAssessment(profile, assessment);

  assert.equal(attached.sourceSnapshotId, "snap:test-1");
  assert.equal(attached.freshness.length, 1);
  assert.equal(attached.freshness[0].freshnessStatus, "fresh");
  assert.equal(attached.freshness[0].cacheIsSourceTruth, false);
});
