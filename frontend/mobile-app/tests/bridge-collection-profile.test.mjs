import test from "node:test";
import assert from "node:assert/strict";

import { buildOrderInstanceProfile } from "../.bridge-test-build/bridge-instance-profile.js";
import {
  assessCollectionStructure,
  attachCollectionStructure,
} from "../.bridge-test-build/bridge-collection-profile.js";

const baseProfile = buildOrderInstanceProfile({
  raw: { KUNDEN_NR: "4711", AUFTRAGS_NR: "A-10027" },
  source: "demo-source",
  sourceSnapshotId: "snapshot:demo",
  observedAt: "2026-09-11T19:10:00.000Z",
});

test("confirmed collection shape does not invent business ordering", () => {
  const assessment = assessCollectionStructure({
    relationId: "order_to_items",
    shape: "list",
    shapeStatus: "confirmed",
    evidence: ["source metadata exposes the relation as a list"],
  });

  assert.equal(assessment.collection.shape, "list");
  assert.equal(assessment.collection.shapeStatus, "confirmed");
  assert.equal(assessment.collection.orderingStatus, "unresolved");
  assert.ok(assessment.collection.blockers.some((item) => item.includes("Reihenfolge")));
});

test("join object with confirmed own fields can be treated as meaningful association entity", () => {
  const assessment = assessCollectionStructure({
    relationId: "order_to_product",
    shape: "set",
    shapeStatus: "confirmed",
    joinObject: "order_position",
    associationMeaningStatus: "confirmed",
    hasOwnMeaning: true,
    ownFields: ["MENGE", "PREIS"],
    evidence: ["observed order_position contains its own quantity and price fields"],
  });

  assert.equal(assessment.associationEntity.status, "confirmed");
  assert.equal(assessment.associationEntity.hasOwnMeaning, true);
  assert.deepEqual(assessment.associationEntity.ownFields, ["MENGE", "PREIS"]);

  const profile = attachCollectionStructure(baseProfile, assessment);
  assert.equal(profile.collections.length, 1);
  assert.equal(profile.associationEntities.length, 1);
  assert.equal(profile.associationEntities[0].joinObject, "order_position");
});

test("observed join object without confirmed meaning stays candidate", () => {
  const assessment = assessCollectionStructure({
    relationId: "customer_to_tags",
    shape: "set",
    shapeStatus: "candidate",
    joinObject: "customer_tag",
    associationMeaningStatus: "candidate",
    hasOwnMeaning: null,
    evidence: ["join object observed but semantic role is undocumented"],
  });

  assert.equal(assessment.associationEntity.status, "candidate");
  assert.equal(assessment.associationEntity.hasOwnMeaning, null);
  assert.ok(assessment.associationEntity.blockers.some((item) => item.includes("fachliche Bedeutung")));
});
