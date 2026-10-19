/**
 * RE EX synthetic Northwind decision-basis check.
 * Pure, read-only pre-review assessment. Never authorizes execution or writes.
 * Based on the RE EX Media technical test note dated 2026-10-13, page 3.
 */
export type DecisionBasis = {
  source: string | null;
  mapping: string | null;
  scope: string | null;
  semanticRevision: string | null;
  evidenceRevision: string | null;
  status: string | null;
  conflict: boolean | null;
};
export type DecisionBasisResult =
  | 'BLOCKED_INCOMPLETE_EVIDENCE'
  | 'BLOCKED_BINDING_MISMATCH'
  | 'BLOCKED_STALE_BASIS'
  | 'ELIGIBLE_FOR_NEXT_REVIEW';

export function checkDecisionBasis(bound: DecisionBasis, current: DecisionBasis): DecisionBasisResult {
  const required = [
    bound.source, bound.mapping, bound.scope, bound.semanticRevision, bound.evidenceRevision,
    current.source, current.mapping, current.scope, current.semanticRevision,
    current.evidenceRevision, current.status,
  ];
  if (required.some(v => typeof v !== 'string' || !v.trim())
    || typeof current.conflict !== 'boolean')
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
