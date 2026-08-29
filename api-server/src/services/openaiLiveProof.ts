import assert from 'node:assert/strict';
import { parseLegacyTextLive } from './aiParserLive.js';
import { runIngestionPipeline } from './ingestionPipeline.js';

const legacyText = `
AUTHENTIC LEGACY EXPORT CONTRACT

The following mapping is explicit and authoritative:
- KUNDNR maps to customer_id and has legacy type NUMC. Leading zeros are significant and must be preserved.
- BETRAG maps to amount and has legacy type DECIMAL. Values use German number formatting (for example 1.250,50).
- STATUS maps to status and has legacy type CHAR.

Business rule: STATUS = C means the order is completed.
State transition: STATUS may change from O to C only after the close_order operation succeeds.
Operation: close_order sets STATUS to C after successful completion.
Communication contract: a nightly shell job invokes import_orders.sh; if the import command exits non-zero, the job stops and records an error instead of continuing.

Do not infer any additional fields or rules beyond the statements above.
`;

const rawPayload = {
  KUNDNR: '00042',
  BETRAG: '1.250,50',
  STATUS: 'C',
};

const result = await runIngestionPipeline({
  legacyText,
  rawPayload,
  analyze: parseLegacyTextLive,
});

assert.equal(result.analysis.fieldMapping.KUNDNR, 'customer_id');
assert.equal(result.analysis.fieldMapping.BETRAG, 'amount');
assert.equal(result.analysis.fieldMapping.STATUS, 'status');
assert.equal(result.analysis.field_types.KUNDNR.toUpperCase(), 'NUMC');
assert.equal(result.analysis.field_types.BETRAG.toUpperCase(), 'DECIMAL');
assert.equal(result.extractedSchema.mapped_payload.customer_id, '00042');
assert.equal(result.extractedSchema.mapped_payload.amount, 1250.5);
assert.equal(result.extractedSchema.mapped_payload.status, 'C');
assert.equal(result.extractedSchema.review_required, true);
assert.ok(result.analysis.business_rules.length > 0, 'expected at least one business rule');
assert.ok(result.analysis.state_transitions.length > 0, 'expected at least one state transition');
assert.ok(result.analysis.operations.length > 0, 'expected at least one operation');
assert.ok(result.analysis.communication_contracts.length > 0, 'expected at least one communication contract');
assert.ok(result.analysis.evidence.length > 0, 'expected evidence');

console.log(JSON.stringify({
  proof: 'N64_OPENAI_LIVE_PROOF_OK',
  model: process.env.OPENAI_MODEL ?? 'gpt-5.6',
  mapped_payload: result.extractedSchema.mapped_payload,
  business_rules: result.analysis.business_rules,
  state_transitions: result.analysis.state_transitions,
  operations: result.analysis.operations,
  communication_contracts: result.analysis.communication_contracts,
  evidence: result.analysis.evidence,
  warnings: result.analysis.warnings,
}, null, 2));
