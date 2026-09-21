import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";

const summary = JSON.parse(await readFile("external-northwind-mass-summary.json", "utf8"));
const traces = (await readFile("external-northwind-830-traces.jsonl", "utf8"))
  .trim()
  .split(/\r?\n/)
  .filter(Boolean)
  .map((line) => JSON.parse(line));

assert.equal(traces.length, summary.sourceRows.orders, "Trace count must match source order count");

const adapterUnresolvedFieldCounts = {};
const contractDimensionCounts = {
  completeness: { passed: 0, failed: 0 },
  type: { passed: 0, failed: 0 },
  format: { passed: 0, failed: 0 },
};
let statusOnlyUnresolved = 0;
let statusAndQuantityUnresolved = 0;
let otherSchemaFailures = 0;

function failed(trace, id) {
  return (trace.failedConstraints ?? []).some((constraint) => constraint.id === id);
}

function csvCell(value) {
  const text = value == null ? "" : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

const dimensionRows = [];
for (const trace of traces) {
  const completenessFailed = failed(trace, "contract.completeness");
  const typeFailed = failed(trace, "contract.type");
  const formatFailed = failed(trace, "contract.format");
  contractDimensionCounts.completeness[completenessFailed ? "failed" : "passed"] += 1;
  contractDimensionCounts.type[typeFailed ? "failed" : "passed"] += 1;
  contractDimensionCounts.format[formatFailed ? "failed" : "passed"] += 1;

  const unresolvedFields = (trace.adapterConflicts ?? [])
    .filter(({ code }) => code === "NO_CONFIRMED_SEMANTIC_MAPPING")
    .map(({ field }) => field);
  for (const field of unresolvedFields) {
    adapterUnresolvedFieldCounts[field] = (adapterUnresolvedFieldCounts[field] ?? 0) + 1;
  }

  const unresolvedSet = new Set(unresolvedFields);
  if (unresolvedSet.has("STATUS") && unresolvedSet.has("MENGE")) statusAndQuantityUnresolved += 1;
  else if (unresolvedSet.has("STATUS") && unresolvedSet.size === 1) statusOnlyUnresolved += 1;
  else otherSchemaFailures += 1;

  const statusEvidence = trace.adapterEvidence?.values?.status;
  const quantityEvidence = trace.adapterEvidence?.values?.quantity;
  dimensionRows.push([
    trace.recordId,
    trace.adapterRaw?.STATUS ?? "",
    statusEvidence?.status ?? "",
    statusEvidence?.reason ?? "",
    trace.adapterRaw?.MENGE ?? "",
    quantityEvidence?.status ?? "",
    quantityEvidence?.reason ?? "",
    completenessFailed ? "FAILED" : "PASSED",
    typeFailed ? "FAILED" : "PASSED",
    formatFailed ? "FAILED" : "PASSED",
    trace.bridgeState,
    trace.releaseAllowed,
  ].map(csvCell).join(","));
}

assert.equal(statusOnlyUnresolved, 137);
assert.equal(statusAndQuantityUnresolved, 693);
assert.equal(otherSchemaFailures, 0);
assert.equal(contractDimensionCounts.completeness.failed, 830);
assert.equal(contractDimensionCounts.type.failed, 0);
assert.equal(contractDimensionCounts.format.failed, 0);

const diagnosis = {
  proof: "external-northwind-contract-diagnosis-v2-granular-contract",
  sourceOrders: summary.sourceRows.orders,
  sourceSchemaAccepted: summary.sourceSchemaGate.accepted,
  legacyBridgeContractSchema: summary.bridgeContractSchema,
  contractDimensions: contractDimensionCounts,
  adapterUnresolvedFieldCounts,
  rootCauseClasses: { statusOnlyUnresolved, statusAndQuantityUnresolved, otherSchemaFailures },
  finding: {
    status: "STATUS remains an empty observed adapter value because no confirmed Northwind source mapping exists. The evidence reason now states this explicitly instead of using emptiness as the only explanation.",
    quantity: "For 693 multi-detail orders, MENGE remains empty and UNPROVEN because Northwind stores quantities per Order_Detail and provides no confirmed order-level total-quantity field or confirmed aggregation rule.",
    contract: "The target contract is now diagnosed along independent dimensions: completeness, type and format. All 830 fail completeness because STATUS is unresolved; 693 also lack MENGE. Type and format do not fail merely because a required value is absent.",
    interpretation: "A readable source, a complete target record, a type-correct value, a format-correct value, confirmed semantics and release are separate claims.",
  },
  decision: "Keep MENGE aggregation unproven. Preserve empty raw adapter values, but always pair them with explicit evidence status and reason. Use contract.completeness, contract.type and contract.format as the blocking target-contract diagnostics; contract.schema remains only a legacy summary warning.",
};

const markdown = `# External Northwind Mass Proof - granulare Contract-Diagnose\n\n` +
`## Ergebnis\n\n` +
`- Quellauftraege: **${diagnosis.sourceOrders}**\n` +
`- Source-Schema akzeptiert: **${diagnosis.sourceSchemaAccepted}/${diagnosis.sourceOrders}**\n` +
`- contract.completeness FAILED: **${contractDimensionCounts.completeness.failed}**\n` +
`- contract.type FAILED: **${contractDimensionCounts.type.failed}**\n` +
`- contract.format FAILED: **${contractDimensionCounts.format.failed}**\n` +
`- Nur STATUS fachlich unaufgeloest: **${statusOnlyUnresolved}**\n` +
`- STATUS und MENGE fachlich unaufgeloest: **${statusAndQuantityUnresolved}**\n` +
`- Andere Ursachen: **${otherSchemaFailures}**\n\n` +
`## Bedeutung\n\n` +
`Leere Adapterwerte bleiben echte Rohbeobachtungen und werden nicht durch das Wort UNPROVEN ersetzt. Stattdessen steht der Nachweisstatus daneben: STATUS ist leer + UNPROVEN + expliziter Grund. Bei MENGE ist derselbe Unterschied sichtbar.\n\n` +
`Die 693 Mehrpositionsfaelle werden weiterhin nicht summiert. Northwind liefert quantity je Order_Detail, aber kein bestaetigtes order-level totalQuantity-Feld. Eine Summe waere eine neue Aggregationsregel und braucht eigene Evidence.\n\n` +
`## Contract-Trennung\n\n` +
`1. **contract.completeness** - sind alle Pflichtwerte vorhanden?\n` +
`2. **contract.type** - sind vorhandene Werte typkorrekt?\n` +
`3. **contract.format** - sind vorhandene, typkorrekte Werte formatgueltig?\n` +
`4. **contract.schema** - nur noch nicht-blockierende Legacy-Gesamtsicht.\n\n` +
`Damit bedeutet fehlende Semantik nicht mehr automatisch Typ- oder Formatfehler.\n`;

const dimensionHeader = [
  "recordId","adapterStatus","statusValueEvidence","statusReason",
  "adapterQuantity","quantityValueEvidence","quantityReason",
  "contractCompleteness","contractType","contractFormat","bridgeState","releaseAllowed",
].map(csvCell).join(",");

await Promise.all([
  writeFile("external-northwind-contract-diagnosis.json", `${JSON.stringify(diagnosis, null, 2)}\n`, "utf8"),
  writeFile("external-northwind-contract-diagnosis.md", markdown, "utf8"),
  writeFile("external-northwind-contract-dimensions.csv", `${dimensionHeader}\n${dimensionRows.join("\n")}\n`, "utf8"),
]);

console.log("EXTERNAL_NORTHWIND_CONTRACT_DIAGNOSIS");
console.log(JSON.stringify(diagnosis, null, 2));
