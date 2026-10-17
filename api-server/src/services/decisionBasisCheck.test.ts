import test from 'node:test';
import assert from 'node:assert/strict';
import { checkDecisionBasis, type DecisionBasis } from './decisionBasisCheck.js';

const baseline: DecisionBasis = {
  source: 'SRC-r1:TEST-C01', mapping: 'MAP-r1:CustomerReference',
  scope: 'SYN-ORDER-001:Orders.CustomerID',
  semanticRevision: 'SEM-r1', evidenceRevision: 'EVID-r1',
  status: 'CONFIRMED', conflict: false,
};
const check = (changes: Partial<DecisionBasis> = {}, boundChanges: Partial<DecisionBasis> = {}) =>
  checkDecisionBasis({ ...baseline, ...boundChanges }, { ...baseline, ...changes });

test('RE EX production checker: confirmed unchanged basis allows next review only', () => {
  assert.equal(check(), 'ELIGIBLE_FOR_NEXT_REVIEW');
});
test('RE EX production checker: changed evidence and semantics block stale basis', () => {
  assert.equal(check({ semanticRevision: 'SEM-r2', evidenceRevision: 'EVID-r2',
    status: 'UNRESOLVED', conflict: true }), 'BLOCKED_STALE_BASIS');
});
test('RE EX production checker: missing revision or conflict status fails closed', () => {
  assert.equal(check({ evidenceRevision: null }), 'BLOCKED_INCOMPLETE_EVIDENCE');
  assert.equal(check({ conflict: null }), 'BLOCKED_INCOMPLETE_EVIDENCE');
  assert.equal(check({}, { semanticRevision: null }), 'BLOCKED_INCOMPLETE_EVIDENCE');
});
test('RE EX production checker: source mapping and scope mismatches block', () => {
  for (const changes of [{ source: 'SRC-r2:TEST-C01' }, { mapping: 'MAP-r2:CustomerReference' },
    { scope: 'SYN-ORDER-002:Orders.CustomerID' }])
    assert.equal(check(changes), 'BLOCKED_BINDING_MISMATCH');
});
test('RE EX production checker: conflict or unresolved meaning blocks unchanged revisions', () => {
  assert.equal(check({ conflict: true }), 'BLOCKED_STALE_BASIS');
  assert.equal(check({ status: 'UNRESOLVED' }), 'BLOCKED_STALE_BASIS');
});
test('RE EX production checker: newly confirmed revision still requires rebinding', () => {
  assert.equal(check({ semanticRevision: 'SEM-r2', evidenceRevision: 'EVID-r2' }),
    'BLOCKED_STALE_BASIS');
});
