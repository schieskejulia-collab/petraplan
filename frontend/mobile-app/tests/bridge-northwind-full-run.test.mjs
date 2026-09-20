import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { evaluateRecordWithConflictTruth } from "../.bridge-test-build/bridge-conflict-truth.js";
import { adaptNorthwindOrder } from "../.bridge-test-build/bridge-northwind-adapter.js";

const fixtureUrl = new URL("./fixtures/northwind-order-10248.json", import.meta.url);
const northwind = JSON.parse(await readFile(fixtureUrl, "utf8"));
const capturedAt = "2026-09-19T01:35:00.000Z";

test("complete Northwind order runs through source adapter and bridge without inventing semantics", () => {
  const before = structuredClone(northwind);
  const adaptation = adaptNorthwindOrder(northwind);

  // Source Truth: the complete foreign payload is preserved unchanged.
  assert.deepEqual(northwind, before);
  assert.deepEqual(adaptation.sourceSnapshot, before);
  assert.notEqual(adaptation.sourceSnapshot, northwind);

  // Explicit field mappings that can be proven from Northwind.
  assert.equal(adaptation.raw.KUNDEN_NR, "VINET");
  assert.equal(adaptation.raw.AUFTRAGS_NR, "A-10248");
  assert.equal(adaptation.raw.DATUM, "1996-07-04");

  // Three product rows do not prove what the bridge's single MENGE should mean.
  assert.equal(adaptation.raw.MENGE, "");
  assert.equal(adaptation.evidence.quantitySource, "unmapped");
  assert.ok(
    adaptation.issues.some(
      ({ code, field }) => code === "NO_CONFIRMED_SEMANTIC_MAPPING" && field === "MENGE",
    ),
  );

  // No Northwind field is silently reinterpreted as the bridge's status model.
  assert.equal(adaptation.raw.STATUS, "");
  assert.ok(
    adaptation.issues.some(
      ({ code, field }) => code === "NO_CONFIRMED_SEMANTIC_MAPPING" && field === "STATUS",
    ),
  );

  const evaluation = evaluateRecordWithConflictTruth(
    adaptation.raw,
    capturedAt,
    {
      source: "northwind",
      transport: "file",
      destination: "petraplan-bridge",
      service: "northwind-orders",
      operation: "readOrder",
      interactionMode: "one_way",
      correlationId: "northwind:order:10248",
      contract: "order-v1",
      transportStatus: "received",
    },
    {},
    adaptation.issues,
  );

  // The existing bridge receives the adapted record and preserves it again.
  assert.deepEqual(evaluation.snapshot.values, adaptation.raw);
  assert.equal(evaluation.ingress.source, "northwind");
  assert.equal(evaluation.interactionTrace.correlationId, "northwind:order:10248");

  // Demo-only reference checks must not leak into a foreign-source run.
  assert.equal(evaluation.constraints.some(({ id }) => id === "order.demo_reference"), false);

  // Only mappings with confirmed semantics survive the full bridge run.
  assert.equal(evaluation.mapped.customerId, "VINET");
  assert.equal(evaluation.mapped.orderId, "A-10248");
  assert.equal(evaluation.mapped.quantity, null);
  assert.equal(evaluation.mapped.orderDate, "1996-07-04");
  assert.equal(evaluation.mapped.status, null);

  // Structure and unresolved meaning are separate causes. The adapter has
  // already proven why STATUS/MENGE are empty, so those placeholders must not
  // create duplicate contract.schema or quantity.positive blockers.
  assert.equal(evaluation.constraints.find(({ id }) => id === "contract.schema")?.passed, true);
  assert.equal(evaluation.gatewayIssues.some(({ issue }) => issue === "CONTRACT_MISMATCH"), false);
  assert.equal(evaluation.constraints.some(({ id }) => id === "quantity.positive"), false);

  // The actual causes remain explicit: STATUS has no confirmed value-map and
  // multi-position MENGE has no confirmed aggregation meaning.
  assert.equal(evaluation.release.releaseAllowed, false);
  assert.equal(evaluation.release.blockingIssues, 2);
  assert.equal(evaluation.state.state, "NEEDS_CONFIRMATION");
  assert.equal(evaluation.report.errors.length, 2);
  assert.ok(evaluation.constraints.some(({ id, passed }) => id === "status.value_map" && passed === false));
  assert.ok(
    evaluation.constraints.some(
      ({ id, passed }) => id === "adapter.NO_CONFIRMED_SEMANTIC_MAPPING:MENGE" && passed === false,
    ),
  );
  assert.equal(
    evaluation.constraints.some(({ id }) => id === "adapter.NO_CONFIRMED_SEMANTIC_MAPPING:STATUS"),
    false,
  );
  assert.ok(
    evaluation.report.errors.some((error) =>
      error.startsWith("[adapter] Adapter-Konflikt (NO_CONFIRMED_SEMANTIC_MAPPING)"),
    ),
  );
});
