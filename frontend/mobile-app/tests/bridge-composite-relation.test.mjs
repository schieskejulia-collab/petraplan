import test from "node:test";
import assert from "node:assert/strict";

import { verifyRelation } from "../.bridge-test-build/bridge-relation-verification.js";

const relation = {
  id: "order_position_to_target_position",
  sourceEntity: "order_position",
  targetEntity: "target_position",
  direction: "unidirectional",
  cardinality: "unknown",
  sourceFields: ["AUFTRAGS_NR", "POSITION"],
  targetFields: [],
  technicalLinkStatus: "candidate",
  semanticMeaningStatus: "confirmed",
  evidence: ["Demo relation requires order number plus position"],
};

const completeEvidence = {
  relationId: relation.id,
  targetEntity: relation.targetEntity,
  sourceField: "AUFTRAGS_NR",
  sourceValue: "A-10027",
  targetRecordObserved: true,
  foreignKeyConstraintObserved: false,
  identityParts: [
    {
      sourceField: "AUFTRAGS_NR",
      sourceValue: "A-10027",
      targetField: "ORDER_ID",
      targetValue: "A-10027",
    },
    {
      sourceField: "POSITION",
      sourceValue: "10",
      targetField: "LINE_NO",
      targetValue: "10",
    },
  ],
  evidence: ["Observed target record ORDER_ID=A-10027 + LINE_NO=10"],
};

test("composite relation confirms same record only when every identity part matches", () => {
  const result = verifyRelation(relation, completeEvidence);

  assert.equal(result.targetIdentityStatus, "confirmed");
  assert.equal(result.technicalLinkStatus, "confirmed");
  assert.equal(result.matchedValue, null);
  assert.equal(result.matchedParts.length, 2);
  assert.deepEqual(
    result.matchedParts.map(({ sourceField, sourceValue }) => [sourceField, sourceValue]),
    [["AUFTRAGS_NR", "A-10027"], ["POSITION", "10"]],
  );
  assert.equal(result.foreignKeyConstraintStatus, "unresolved");
  assert.ok(result.note.includes("zusammengesetzten Identität"));
});

test("composite relation stays candidate when one key part is missing", () => {
  const result = verifyRelation(relation, {
    ...completeEvidence,
    identityParts: [completeEvidence.identityParts[0]],
  });

  assert.equal(result.technicalLinkStatus, "candidate");
  assert.equal(result.matchedParts.length, 0);
  assert.ok(result.blockers.some((item) => item.includes("Nicht alle Teile")));
});

test("composite relation does not confirm same record when one key part differs", () => {
  const result = verifyRelation(relation, {
    ...completeEvidence,
    identityParts: [
      completeEvidence.identityParts[0],
      {
        ...completeEvidence.identityParts[1],
        targetValue: "11",
      },
    ],
  });

  assert.equal(result.targetIdentityStatus, "confirmed");
  assert.equal(result.technicalLinkStatus, "candidate");
  assert.equal(result.matchedParts.length, 0);
  assert.ok(result.blockers.some((item) => item.includes("Mindestens ein Teil")));
});
