import test from "node:test";
import assert from "node:assert/strict";

import { demoValidRecord } from "../.bridge-test-build/bridge-pipeline.js";
import { demoOrderToCustomerEvidence } from "../.bridge-test-build/bridge-relation-demo.js";
import { evaluateRecordWithInstanceProfile } from "../.bridge-test-build/bridge-profiled-evaluation.js";
import { assessSubtype } from "../.bridge-test-build/bridge-subtype-profile.js";

const confirmedSubtype = assessSubtype({
  record: { PARTNER_TYPE: "CUSTOMER" },
  definition: {
    baseType: "business_partner",
    discriminatorField: "PARTNER_TYPE",
    discriminatorStatus: "confirmed",
    discriminatorValues: { CUSTOMER: "customer" },
    valueMapStatus: "confirmed",
    inheritanceStrategy: "single_table",
    inheritanceStrategyStatus: "confirmed",
    evidence: ["demo metadata confirms PARTNER_TYPE=CUSTOMER"],
  },
});

test("confirmed subtype is carried inside the instance profile and report", () => {
  const result = evaluateRecordWithInstanceProfile(
    demoValidRecord,
    "2026-09-11T19:05:00.000Z",
    {},
    {},
    [demoOrderToCustomerEvidence],
    [confirmedSubtype],
  );

  assert.equal(result.instanceProfile.subtypes.length, 1);
  assert.equal(result.instanceProfile.subtypes[0].baseType, "business_partner");
  assert.equal(result.instanceProfile.subtypes[0].subtype, "customer");
  assert.equal(result.instanceProfile.subtypes[0].subtypeStatus, "confirmed");
  assert.ok(result.report.subtypeFindings.some((item) => item.includes("business_partner → customer")));
});

test("candidate subtype remains candidate inside the instance profile", () => {
  const candidateSubtype = assessSubtype({
    record: { PARTNER_TYPE: "CUSTOMER" },
    definition: {
      baseType: "business_partner",
      discriminatorField: "PARTNER_TYPE",
      discriminatorStatus: "candidate",
      discriminatorValues: { CUSTOMER: "customer" },
      valueMapStatus: "candidate",
      evidence: ["field observed, metadata not yet confirmed"],
    },
  });

  const result = evaluateRecordWithInstanceProfile(
    demoValidRecord,
    "2026-09-11T19:05:00.000Z",
    {},
    {},
    [demoOrderToCustomerEvidence],
    [candidateSubtype],
  );

  assert.equal(result.instanceProfile.subtypes[0].subtypeStatus, "candidate");
  assert.ok(result.report.openPoints.some((item) => item.includes("Subtype business_partner ist candidate")));
});
