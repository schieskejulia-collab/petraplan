import test from "node:test";
import assert from "node:assert/strict";

import { assessHierarchy } from "../.bridge-test-build/bridge-hierarchy-profile.js";

const base = {
  relationId: "category_parent",
  entity: "category",
  nodeIdField: "CATEGORY_ID",
  parentIdField: "PARENT_CATEGORY_ID",
  definitionStatus: "confirmed",
  maxDepth: 8,
  evidence: ["demo metadata confirms CATEGORY_ID -> PARENT_CATEGORY_ID"],
};

test("confirmed recursive chain reaches root without inventing more structure", () => {
  const result = assessHierarchy({
    ...base,
    startId: "leaf",
    nodes: [
      { id: "leaf", parentId: "branch" },
      { id: "branch", parentId: "root" },
      { id: "root", parentId: null },
    ],
  });

  assert.equal(result.status, "confirmed");
  assert.equal(result.traversalStatus, "complete");
  assert.equal(result.cycleDetected, false);
  assert.deepEqual(result.observedPath, ["leaf", "branch", "root"]);
});

test("cycle is detected and traversal stops fail-safe", () => {
  const result = assessHierarchy({
    ...base,
    startId: "A",
    nodes: [
      { id: "A", parentId: "B" },
      { id: "B", parentId: "A" },
    ],
  });

  assert.equal(result.status, "unresolved");
  assert.equal(result.traversalStatus, "cycle_detected");
  assert.equal(result.cycleDetected, true);
  assert.deepEqual(result.observedPath, ["A", "B"]);
  assert.ok(result.blockers.some((item) => item.includes("Zyklus erkannt")));
});

test("missing parent stays unresolved instead of being fabricated", () => {
  const result = assessHierarchy({
    ...base,
    startId: "leaf",
    nodes: [
      { id: "leaf", parentId: "missing-root" },
    ],
  });

  assert.equal(result.status, "unresolved");
  assert.equal(result.traversalStatus, "missing_parent");
  assert.deepEqual(result.observedPath, ["leaf", "missing-root"]);
  assert.ok(result.blockers.some((item) => item.includes("nicht beobachtet")));
});

test("depth limit prevents unbounded recursive reading", () => {
  const result = assessHierarchy({
    ...base,
    maxDepth: 2,
    startId: "1",
    nodes: [
      { id: "1", parentId: "2" },
      { id: "2", parentId: "3" },
      { id: "3", parentId: null },
    ],
  });

  assert.equal(result.status, "unresolved");
  assert.equal(result.traversalStatus, "depth_limit");
  assert.deepEqual(result.observedPath, ["1", "2"]);
});
