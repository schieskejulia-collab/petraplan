import test from "node:test";
import assert from "node:assert/strict";

import { assessCompositeIdentity } from "../.bridge-test-build/bridge-instance-profile.js";

test("confirmed composite definition plus all parts confirms the observed identity tuple", () => {
  const identity = assessCompositeIdentity({
    subject: "order_line",
    parts: [
      { field: "AUFTRAGS_NR", value: "A-10027" },
      { field: "POSITION", value: "10" },
    ],
    definitionStatus: "confirmed",
    evidence: [
      "demo metadata confirms AUFTRAGS_NR + POSITION as the composite identity",
      "snapshot:demo-order-line-1",
    ],
  });

  assert.equal(identity.kind, "composite_identifier");
  assert.equal(identity.status, "confirmed");
  assert.equal(identity.parts.length, 2);
  assert.equal(identity.parts.every(({ present }) => present), true);
});

test("complete values do not confirm a composite identity when the definition is only a candidate", () => {
  const identity = assessCompositeIdentity({
    subject: "order_line",
    parts: [
      { field: "AUFTRAGS_NR", value: "A-10027" },
      { field: "POSITION", value: "10" },
    ],
    definitionStatus: "candidate",
    evidence: ["two plausible identity fields were observed, but source metadata is missing"],
  });

  assert.equal(identity.status, "candidate");
  assert.ok(identity.note.includes("not confirmed"));
});

test("missing one component leaves the composite identity unresolved", () => {
  const identity = assessCompositeIdentity({
    subject: "order_line",
    parts: [
      { field: "AUFTRAGS_NR", value: "A-10027" },
      { field: "POSITION", value: "" },
    ],
    definitionStatus: "confirmed",
    evidence: ["composite definition is confirmed, but the observed tuple is incomplete"],
  });

  assert.equal(identity.status, "unresolved");
  assert.equal(identity.parts[1].present, false);
  assert.ok(identity.note.includes("POSITION"));
});
