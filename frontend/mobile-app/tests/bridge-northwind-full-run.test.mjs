import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { evaluateRecord } from "../.bridge-test-build/bridge-pipeline.js";
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

  const evaluation = evaluateRecord(
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
  );

  // The existing bridge receives the adapted record and preserves it again.
  assert.deepEqual(evaluation.snapshot.values, adaptation.raw);
  assert.equal(evaluation.ingress.source, "northwind");
  assert.equal(evaluation.interactionTrace.correlationId, "northwind:order:10248");

  // Only mappings with confirmed semantics survive the full bridge run.
  assert.equal(evaluation.mapped.customerId, "VINET");
  assert.equal(evaluation.mapped.orderId, "A-10248");
  assert.equal(evaluation.mapped.quantity, null);
  assert.equal(evaluation.mapped.orderDate, "1996-07-04");
  assert.equal(evaluation.mapped.status, null);

  // Both unconfirmed semantics must keep release closed.
  assert.equal(evaluation.release.releaseAllowed, false);
  assert.ok(evaluation.release.blockingIssues >= 2);
  assert.ok(evaluation.report.errors.length >= 2);
  assert.ok(evaluation.constraints.some(({ id, passed }) => id === "status.value_map" && passed === false));
  assert.ok(evaluation.constraints.some(({ id, passed }) => id === "quantity.positive" && passed === false));
});
