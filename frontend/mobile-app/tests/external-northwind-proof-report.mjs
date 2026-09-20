import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";

const summary = JSON.parse(await readFile("external-northwind-mass-summary.json", "utf8"));
const traces = (await readFile("external-northwind-830-traces.jsonl", "utf8"))
  .trim()
  .split(/\r?\n/)
  .filter(Boolean)
  .map((line) => JSON.parse(line));

assert.equal(traces.length, summary.sourceRows.orders, "Trace count must match source order count");

const schemaFailureFieldCounts = {};
const schemaFailureShapes = {};
const adapterUnresolvedFieldCounts = {};
let statusOnlyUnresolved = 0;
let statusAndQuantityUnresolved = 0;
let otherSchemaFailures = 0;

for (const trace of traces) {
  if (trace.bridgeContractSchema !== "FAILED") continue;

  const evidence = trace.bridgeContractSchemaEvidence ?? "";
  const fieldList = evidence.match(/felder=([^;]+)/)?.[1] ?? "";
  const fields = fieldList.split(",").map((field) => field.trim()).filter(Boolean);
  const shape = fields.slice().sort().join("+") || "UNKNOWN";
  schemaFailureShapes[shape] = (schemaFailureShapes[shape] ?? 0) + 1;
  for (const field of fields) {
    schemaFailureFieldCounts[field] = (schemaFailureFieldCounts[field] ?? 0) + 1;
  }

  const unresolvedFields = (trace.adapterConflicts ?? [])
    .filter(({ code }) => code === "NO_CONFIRMED_SEMANTIC_MAPPING")
    .map(({ field }) => field);
  for (const field of unresolvedFields) {
    adapterUnresolvedFieldCounts[field] = (adapterUnresolvedFieldCounts[field] ?? 0) + 1;
  }

  const unresolvedSet = new Set(unresolvedFields);
  if (unresolvedSet.has("STATUS") && unresolvedSet.has("MENGE")) {
    statusAndQuantityUnresolved += 1;
  } else if (unresolvedSet.has("STATUS") && unresolvedSet.size === 1) {
    statusOnlyUnresolved += 1;
  } else {
    otherSchemaFailures += 1;
  }
}

const diagnosis = {
  proof: "external-northwind-contract-diagnosis-v1",
  sourceOrders: summary.sourceRows.orders,
  sourceSchemaAccepted: summary.sourceSchemaGate.accepted,
  bridgeContractSchema: summary.bridgeContractSchema,
  schemaFailureFieldCounts,
  schemaFailureShapes,
  adapterUnresolvedFieldCounts,
  rootCauseClasses: {
    statusOnlyUnresolved,
    statusAndQuantityUnresolved,
    otherSchemaFailures,
  },
  finding: {
    status: "Northwind contains no confirmed equivalent for the Bridge STATUS value map. The adapter therefore leaves STATUS empty instead of guessing a business meaning.",
    quantity: "For orders with multiple Order_Detail rows, the adapter leaves MENGE empty because summing line quantities into one order quantity is not a confirmed business rule.",
    contract: "order-v1 currently requires STATUS and MENGE to be non-empty and format-valid. Therefore an intentionally unresolved adapter value also causes contract.schema to fail.",
    interpretation: "The 830 contract.schema failures are not evidence that the foreign source schema was unreadable. They show that the strict target contract cannot be fully satisfied without inventing unresolved business meaning.",
  },
  decision: "Do not weaken order-v1 and do not invent STATUS or aggregate MENGE. Keep source-schema acceptance, target-contract completeness, semantic resolution and release as separate proof layers.",
};

const markdown = `# External Northwind Mass Proof – Diagnose\n\n` +
`## Ergebnis\n\n` +
`- Quellaufträge: **${diagnosis.sourceOrders}**\n` +
`- Source-Schema akzeptiert: **${diagnosis.sourceSchemaAccepted}/${diagnosis.sourceOrders}**\n` +
`- Bridge-Contract-Schema bestanden: **${diagnosis.bridgeContractSchema.passed}**\n` +
`- Bridge-Contract-Schema fehlgeschlagen: **${diagnosis.bridgeContractSchema.failed}**\n` +
`- Source-Mutationen: **${summary.sourceMutationCount}**\n\n` +
`## Warum scheitert contract.schema bei 830/830?\n\n` +
`Der Northwind-Adapter erfindet keine fehlende Fachbedeutung. Für **STATUS** gibt es in den geprüften Northwind-Daten keinen bestätigten Gegenpart zur Bridge-Value-Map. STATUS bleibt deshalb leer. Das bestätigte Zielmodell **order-v1** verlangt für STATUS jedoch einen nichtleeren, formatgültigen Wert. Dadurch ist das Source-Schema lesbar, während das Ziel-Contract-Schema noch nicht vollständig erfüllt ist.\n\n` +
`Bei Aufträgen mit mehreren Order_Detail-Zeilen kommt **MENGE** hinzu: Die Bridge summiert Positionsmengen nicht eigenmächtig zu einer Auftragsmenge. Ohne bestätigte Aggregationsregel bleibt MENGE leer.\n\n` +
`## Aufteilung\n\n` +
`- Nur STATUS fachlich unaufgelöst: **${statusOnlyUnresolved}** Fälle\n` +
`- STATUS und MENGE fachlich unaufgelöst: **${statusAndQuantityUnresolved}** Fälle\n` +
`- Andere Schema-Ursachen: **${otherSchemaFailures}** Fälle\n\n` +
`Schemafehler nach Feld: ${Object.entries(schemaFailureFieldCounts).map(([field, count]) => `**${field}: ${count}**`).join(" · ")}\n\n` +
`## Interpretation\n\n` +
`Die 830 Fehler in **contract.schema** bedeuten nicht, dass die fremden Northwind-Daten strukturell unlesbar waren. Das Source-Schema-Gate hat die Datensätze separat geprüft. Der Zielvertrag scheitert dort, wo ein benötigter Bridge-Wert fachlich nicht bestätigt ist.\n\n` +
`Das ist ein wichtiger Unterschied:\n\n` +
`1. **Source Schema Gate** – Kann die fremde Struktur sicher gelesen werden?\n` +
`2. **Bridge Contract Schema** – Ist der adaptierte Datensatz für order-v1 vollständig?\n` +
`3. **Semantik** – Ist die Bedeutung der Werte bestätigt?\n` +
`4. **Release** – Sind alle unabhängigen Blocker gelöst?\n\n` +
`## Entscheidung\n\n` +
`**order-v1 wird nicht abgeschwächt. STATUS wird nicht erfunden. Mehrere Positionsmengen werden nicht ohne bestätigte Regel summiert.** Die vier Ebenen bleiben getrennt sichtbar.\n`;

await Promise.all([
  writeFile("external-northwind-contract-diagnosis.json", `${JSON.stringify(diagnosis, null, 2)}\n`, "utf8"),
  writeFile("external-northwind-contract-diagnosis.md", markdown, "utf8"),
]);

console.log("EXTERNAL_NORTHWIND_CONTRACT_DIAGNOSIS");
console.log(JSON.stringify(diagnosis, null, 2));
