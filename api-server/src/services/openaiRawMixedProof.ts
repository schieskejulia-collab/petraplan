import assert from 'node:assert/strict';
import { parseLegacyText } from './aiParser.js';
import { runIngestionPipeline } from './ingestionPipeline.js';

const legacyText = String.raw`
-- orders.sql
CREATE TABLE ORDERS (
  KUNDNR CHAR(8) NOT NULL,
  BETRAG DECIMAL(12,2) NOT NULL,
  STATUS CHAR(1) NOT NULL
);

-- close_order.c
int close_order(Order *o) {
  if (!write_audit(o->KUNDNR, "CLOSE_OK")) return -1;
  o->STATUS = 'C';
  return save_order(o);
}

# import_orders.sh
#!/bin/sh
/usr/local/bin/import_orders /data/orders.csv
rc=$?
if [ "$rc" -ne 0 ]; then
  echo "ERROR import failed rc=$rc" >> /var/log/import.log
  exit "$rc"
fi
exit 0

# runtime.log
2026-08-28T01:15:02Z close_order kundnr=00000042 audit=CLOSE_OK
2026-08-28T01:15:02Z close_order kundnr=00000042 status O->C
2026-08-28T01:15:02Z close_order kundnr=00000042 save_order rc=0

# ui.properties
window.title=Auftraege
window.width=1024
button.close.label=Auftrag schliessen

# old_handbook.txt
STATUS C = cancelled ?  // handschriftlicher Alt-Hinweis, Herkunft unbekannt
`;

const rawPayload = {
  KUNDNR: '00000042',
  BETRAG: '1.250,50',
  STATUS: 'C',
};

const result = await runIngestionPipeline({
  legacyText,
  rawPayload,
  analyze: parseLegacyText,
});

console.log(JSON.stringify({
  diagnostic: 'N64_OPENAI_RAW_MIXED_DIAGNOSTIC',
  fieldMapping: result.analysis.fieldMapping,
  field_types: result.analysis.field_types,
  schema_sql: result.analysis.schema_sql,
  mapped_payload: result.extractedSchema.mapped_payload,
  warnings: result.analysis.warnings,
}, null, 2));

assert.equal(result.extractedSchema.mapped_payload.customer_id ?? result.extractedSchema.mapped_payload.kundnr, '00000042');
assert.equal(result.extractedSchema.mapped_payload.amount ?? result.extractedSchema.mapped_payload.betrag, 1250.5);
assert.equal(result.extractedSchema.mapped_payload.status, 'C');
assert.ok(result.analysis.operations.some((x) => /close_order/i.test(x)), 'close_order must be recovered');
assert.ok(result.analysis.state_transitions.some((x) => /O.*C|C.*O/i.test(x)), 'O->C state transition must be recovered');
assert.ok(result.analysis.communication_contracts.some((x) => /non-zero|exit|import/i.test(x)), 'shell error/exit behavior must be recovered');
assert.ok(result.analysis.evidence.length > 0, 'evidence must be present');
assert.ok(result.analysis.warnings.length > 0, 'ambiguous handbook note must surface as warning');
assert.ok(!result.analysis.business_rules.some((x) => /width|1024|window\.title/i.test(x)), 'UI noise must not become business logic');

console.log(JSON.stringify({
  proof: 'N64_OPENAI_RAW_MIXED_PROOF_OK',
  model: process.env.OPENAI_MODEL ?? 'gpt-4.1-mini',
  mapped_payload: result.extractedSchema.mapped_payload,
  business_rules: result.analysis.business_rules,
  state_transitions: result.analysis.state_transitions,
  operations: result.analysis.operations,
  communication_contracts: result.analysis.communication_contracts,
  evidence: result.analysis.evidence,
  warnings: result.analysis.warnings,
}, null, 2));
