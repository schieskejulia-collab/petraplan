import test from "node:test";
import assert from "node:assert/strict";

import { buildOrderInstanceProfile } from "../.bridge-test-build/bridge-instance-profile.js";
import { assessComponent, attachComponent } from "../.bridge-test-build/bridge-component-profile.js";

const baseProfile = buildOrderInstanceProfile({
  raw: { KUNDEN_NR: "4711", AUFTRAGS_NR: "A-10027" },
  source: "demo",
  sourceSnapshotId: "snap:component-demo",
  observedAt: "2026-09-11T20:20:00.000Z",
});

test("confirmed grouped fields form a component without own identity", () => {
  const component = assessComponent({
    componentId: "customer_address",
    ownerEntity: "customer",
    componentType: "address",
    definitionStatus: "confirmed",
    fields: [
      { field: "STREET", value: "Musterweg 1", status: "confirmed" },
      { field: "POSTAL_CODE", value: "39576", status: "confirmed" },
      { field: "CITY", value: "Stendal", status: "confirmed" },
    ],
    evidence: ["demo mapping confirms address field group"],
  });

  assert.equal(component.status, "confirmed");
  assert.equal(component.hasOwnIdentity, false);
  assert.equal(component.fields.length, 3);
  assert.ok(component.note.includes("keine eigene Identität"));

  const profiled = attachComponent(baseProfile, component);
  assert.equal(profiled.components.length, 1);
  assert.equal(profiled.components[0].componentId, "customer_address");
});

test("candidate definition does not promote grouped fields to confirmed component", () => {
  const component = assessComponent({
    componentId: "money_value",
    ownerEntity: "order_position",
    componentType: "money",
    definitionStatus: "candidate",
    fields: [
      { field: "AMOUNT", value: "19.99", status: "confirmed" },
      { field: "CURRENCY", value: "EUR", status: "confirmed" },
    ],
    evidence: ["two related fields were observed, but grouping meaning is not confirmed"],
  });

  assert.equal(component.status, "candidate");
  assert.equal(component.hasOwnIdentity, false);
  assert.ok(component.blockers.some((item) => item.includes("Definition")));
});

test("missing component field keeps the component candidate", () => {
  const component = assessComponent({
    componentId: "customer_address",
    ownerEntity: "customer",
    componentType: "address",
    definitionStatus: "confirmed",
    fields: [
      { field: "STREET", value: "Musterweg 1", status: "confirmed" },
      { field: "POSTAL_CODE", value: null, status: "unresolved" },
      { field: "CITY", value: "Stendal", status: "confirmed" },
    ],
    evidence: ["address definition confirmed, one observed field unresolved"],
  });

  assert.equal(component.status, "candidate");
  assert.ok(component.blockers.some((item) => item.includes("POSTAL_CODE")));
  assert.equal(component.hasOwnIdentity, false);
});
