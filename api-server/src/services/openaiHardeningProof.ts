import assert from 'node:assert/strict';
import { parseLegacyText } from './aiParser.js';
import { runIngestionPipeline } from './ingestionPipeline.js';

const cases = [
  {
    name: 'ambiguous-documentation-vs-runtime',
    legacyText: `
LEGACY NOTES
- KUNDNR maps to customer_id and is NUMC; leading zeros are significant.
- BETRAG maps to amount and is DECIMAL; values may appear as 1.250,50.
- STATUS maps to status and is CHAR.

Old handbook note: STATUS = C may mean "cancelled". This note is marked "possibly obsolete" and has no source reference.
Runtime trace from 2024-11-12: close_order completed successfully, then STATUS changed O -> C, and the UI displayed "Order completed".
Shell job: nightly import_orders.sh exits immediately on any non-zero import exit code and writes ERROR to import.log.

Do not choose an obsolete interpretation over stronger explicit runtime evidence. If evidence conflicts, record the conflict in warnings.
`,
    rawPayload: { KUNDNR: '00042', BETRAG: '1.250,50', STATUS: 'C' },
    check(result: Awaited<ReturnType<typeof runIngestionPipeline>>) {
      assert.equal(result.extractedSchema.mapped_payload.customer_id, '00042');
      assert.equal(result.extractedSchema.mapped_payload.amount, 1250.5);
      assert.ok(result.analysis.state_transitions.some((x) => /O.*C|C.*O/i.test(x)));
      assert.ok(result.analysis.warnings.length > 0, 'conflict must be surfaced as warning');
    },
  },
  {
    name: 'missing-semantics-no-invention',
    legacyText: `
EXPORT FRAGMENT
- ID maps to id and is NUMC.
- FLAG maps to flag and is CHAR.
- process.sh reads FLAG and, when FLAG = X, calls step_two.sh.
- No documentation explains what FLAG = X means in business terms.
- No database constraint or UI label is available.

Do not invent a business meaning for FLAG = X.
`,
    rawPayload: { ID: '0007', FLAG: 'X' },
    check(result: Awaited<ReturnType<typeof runIngestionPipeline>>) {
      assert.equal(result.extractedSchema.mapped_payload.id, '0007');
      assert.ok(result.analysis.operations.length > 0 || result.analysis.communication_contracts.length > 0);
      assert.ok(result.analysis.warnings.length > 0, 'unknown semantics must be warned about');
      assert.ok(!result.analysis.business_rules.some((x) => /approved|cancelled|completed|paid/i.test(x)), 'must not invent business semantics');
    },
  },
  {
    name: 'contradictory-rules',
    legacyText: `
SYSTEM EXTRACT WITH CONFLICT
- ORDER_ID maps to order_id and is NUMC.
- STATUS maps to status and is CHAR.

Rule file A says: STATUS may change A -> B only after approve_order succeeds.
Rule file B says: STATUS may change A -> B before approve_order runs.
Both files are active and no precedence is documented.
Runtime logs show examples of both sequences.

Treat this as an unresolved contradiction. Do not collapse it into one definitive rule.
`,
    rawPayload: { ORDER_ID: '00123', STATUS: 'B' },
    check(result: Awaited<ReturnType<typeof runIngestionPipeline>>) {
      assert.equal(result.extractedSchema.mapped_payload.order_id, '00123');
      assert.ok(result.analysis.warnings.length > 0, 'contradiction must be warned about');
      assert.ok(result.analysis.evidence.length > 0);
    },
  },
  {
    name: 'noise-and-ui-overhead',
    legacyText: `
GTK WINDOW CONFIGURATION
width=800 height=600 title=Orders theme=blue
button label="Close order"

DATA CONTRACT
- AUFTRAG maps to order_id and is NUMC.
- SUMME maps to total and is DECIMAL.
Operation close_order writes audit entry CLOSE_OK and then sets STATUS to C.
STATUS maps to status and is CHAR.
Runtime: CLOSE_OK is present before STATUS=C for the observed transaction.

Ignore pure layout details. Preserve the operation and observed ordering.
`,
    rawPayload: { AUFTRAG: '000099', SUMME: '99,95', STATUS: 'C' },
    check(result: Awaited<ReturnType<typeof runIngestionPipeline>>) {
      assert.equal(result.extractedSchema.mapped_payload.order_id, '000099');
      assert.equal(result.extractedSchema.mapped_payload.total, 99.95);
      assert.ok(result.analysis.operations.some((x) => /close_order/i.test(x)));
      assert.ok(!result.analysis.business_rules.some((x) => /width|height|theme|blue/i.test(x)), 'UI noise must not become business logic');
    },
  },
];

for (const testCase of cases) {
  const result = await runIngestionPipeline({
    legacyText: testCase.legacyText,
    rawPayload: testCase.rawPayload,
    analyze: parseLegacyText,
  });
  testCase.check(result);
  console.log(JSON.stringify({
    hardening_case: testCase.name,
    status: 'OK',
    mapped_payload: result.extractedSchema.mapped_payload,
    warnings: result.analysis.warnings,
    business_rules: result.analysis.business_rules,
    state_transitions: result.analysis.state_transitions,
    operations: result.analysis.operations,
    communication_contracts: result.analysis.communication_contracts,
  }, null, 2));
}

console.log('N64_OPENAI_HARDENING_PROOF_OK');
