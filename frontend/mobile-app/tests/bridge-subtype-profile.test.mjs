import test from "node:test";
import assert from "node:assert/strict";

import { assessSubtype } from "../.bridge-test-build/bridge-subtype-profile.js";

const confirmedDefinition = {
  baseType: "business_partner",
  discriminatorField: "PARTNER_TYPE",
  discriminatorStatus: "confirmed",
  discriminatorValues: {
    CUSTOMER: "customer",
    SUPPLIER: "supplier",
  },
  valueMapStatus: "confirmed",
  inheritanceStrategy: "single_table",
  inheritanceStrategyStatus: "confirmed",
  evidence: ["demo metadata confirms PARTNER_TYPE and its subtype values"],
};

test("confirmed discriminator and value map confirm the concrete subtype", () => {
  const result = assessSubtype({
    record: { PARTNER_TYPE: "CUSTOMER" },
    definition: confirmedDefinition,
  });

  assert.equal(result.baseType, "business_partner");
  assert.equal(result.subtype, "customer");
  assert.equal(result.subtypeStatus, "confirmed");
  assert.equal(result.observedDiscriminatorValue, "CUSTOMER");
  assert.equal(result.inheritanceStrategy, "single_table");
  assert.equal(result.inheritanceStrategyStatus, "confirmed");
});

test("unknown discriminator value does not invent a subtype", () => {
  const result = assessSubtype({
    record: { PARTNER_TYPE: "ARCHIVED_SPECIAL" },
    definition: confirmedDefinition,
  });

  assert.equal(result.subtype, null);
  assert.equal(result.subtypeStatus, "unresolved");
  assert.ok(result.blockers.some((item) => item.includes("keinem bestätigten Subtype")));
});

test("matching value with unconfirmed subtype metadata remains candidate", () => {
  const result = assessSubtype({
    record: { PARTNER_TYPE: "CUSTOMER" },
    definition: {
      ...confirmedDefinition,
      discriminatorStatus: "candidate",
      valueMapStatus: "candidate",
      inheritanceStrategyStatus: "candidate",
    },
  });

  assert.equal(result.subtype, "customer");
  assert.equal(result.subtypeStatus, "candidate");
  assert.equal(result.inheritanceStrategyStatus, "candidate");
  assert.ok(result.blockers.some((item) => item.includes("Discriminator-Definition")));
  assert.ok(result.blockers.some((item) => item.includes("Zuordnung")));
});
