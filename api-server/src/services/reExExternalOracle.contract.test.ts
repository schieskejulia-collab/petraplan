import test from 'node:test';
import assert from 'node:assert/strict';

/**
 * Independent executable oracle transcribed from RE EX Media's synthetic
 * Northwind/Orders.CustomerID test specification (13 October 2026, p. 3).
 * This does NOT assert that PetraPlan's production release gate implements it.
 * It defines the expected behavior to use in a subsequent adapter/integration test.
 */
type Basis = {
  source: string | null; mapping: string | null; scope: string | null;
  semanticRevision: string | null; evidenceRevision: string | null;
  status: string | null; conflict: boolean | null;
};
type Proposal = { bound: Basis; current: Basis };

function evaluate({ bound, current }: Proposal) {
  const required = [bound.source, bound.mapping, bound.scope, bound.semanticRevision,
    bound.evidenceRevision, current.source, current.mapping, current.scope,
    current.semanticRevision, current.evidenceRevision, current.status];
  if (required.some(v => typeof v !== 'string' || !v.trim()) || current.conflict === null)
    return 'BLOCKED_INCOMPLETE_EVIDENCE';
  if (bound.source !== current.source || bound.mapping !== current.mapping
    || bound.scope !== current.scope)
    return 'BLOCKED_BINDING_MISMATCH';
  if (bound.semanticRevision !== current.semanticRevision
    || bound.evidenceRevision !== current.evidenceRevision
    || current.status !== 'CONFIRMED' || current.conflict)
    return 'BLOCKED_STALE_BASIS';
  return 'ELIGIBLE_FOR_NEXT_REVIEW';
}
const baseline: Basis = {
  source: 'SRC-r1:TEST-C01', mapping: 'MAP-r1:CustomerReference',
  scope: 'SYN-ORDER-001:Orders.CustomerID',
  semanticRevision: 'SEM-r1', evidenceRevision: 'EVID-r1',
  status: 'CONFIRMED', conflict: false,
};
const proposal = (changes: Partial<Basis> = {}): Proposal =>
  ({ bound: { ...baseline }, current: { ...baseline, ...changes } });

test('RE EX A: unchanged confirmed basis is eligible for NEXT REVIEW only', () => {
  assert.equal(evaluate(proposal()), 'ELIGIBLE_FOR_NEXT_REVIEW');
});
test('RE EX B: same raw value and mapping but contradictory revised evidence blocks', () => {
  assert.equal(evaluate(proposal({
    semanticRevision: 'SEM-r2', evidenceRevision: 'EVID-r2',
    status: 'UNRESOLVED', conflict: true,
  })), 'BLOCKED_STALE_BASIS');
});
test('RE EX: missing evidence revision blocks as incomplete', () => {
  assert.equal(evaluate(proposal({ evidenceRevision: null })), 'BLOCKED_INCOMPLETE_EVIDENCE');
});
test('RE EX: source, mapping, and scope mismatches each block binding', () => {
  for (const changes of [{ source: 'SRC-r2:TEST-C01' }, { mapping: 'MAP-r2:CustomerReference' },
    { scope: 'SYN-ORDER-002:Orders.CustomerID' }])
    assert.equal(evaluate(proposal(changes)), 'BLOCKED_BINDING_MISMATCH');
});
test('RE EX: unconfirmed or conflicting basis blocks even if revisions are unchanged', () => {
  assert.equal(evaluate(proposal({ status: 'UNRESOLVED' })), 'BLOCKED_STALE_BASIS');
  assert.equal(evaluate(proposal({ conflict: true })), 'BLOCKED_STALE_BASIS');
});
