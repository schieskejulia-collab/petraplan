import test from "node:test";
import assert from "node:assert/strict";

import { groupConstraints } from "../.bridge-test-build/bridge-validation-groups.js";

const constraint = (id, category, sequence, passed, severity = "blocking") => ({
  id,
  category,
  sequence,
  passed,
  severity,
});

test("groups existing constraints without changing their decisions", () => {
  const groups = groupConstraints([
    constraint("data.customer.required", "data", 4, true),
    constraint("transport.received", "transport", 1, true),
    constraint("data.date.canonical", "data", 8, false),
    constraint("contract.schema", "contract", 3, false),
    constraint("order.demo_reference", "data", 5, false, "warning"),
  ]);

  assert.deepEqual(groups.map(({ id }) => id), ["transport", "contract", "data"]);
  assert.deepEqual(groups[0], {
    id: "transport",
    label: "Transport",
    constraintIds: ["transport.received"],
    passed: true,
    blockingIssues: 0,
    warningIssues: 0,
  });
  assert.deepEqual(groups[2], {
    id: "data",
    label: "Daten und Formate",
    constraintIds: ["data.customer.required", "order.demo_reference", "data.date.canonical"],
    passed: false,
    blockingIssues: 1,
    warningIssues: 1,
  });
});
