import type { CaseTrace } from '@/api/connector';

export type ExplicitClaimType =
  | 'SOURCE'
  | 'STRUCTURE'
  | 'REPRESENTATION'
  | 'SEMANTIC'
  | 'SEMANTIC_MAPPING'
  | 'MAPPING'
  | 'AGGREGATION'
  | 'CONTEXT'
  | 'BEHAVIOR'
  | 'VALIDATION'
  | 'DECISION'
  | 'AUTHORIZATION';

async function parseError(res: Response): Promise<Error> {
  const body = await res.json().catch(() => ({}));
  return new Error(String(body.error ?? `HTTP ${res.status}`));
}

export async function createExplicitClaim(input: {
  recordId: string;
  token: string;
  candidate_id: string;
  subject_address: string;
  statement: string;
  claim_type: ExplicitClaimType;
}): Promise<{ claim_id: string; trace: CaseTrace }> {
  const res = await fetch(`/api/cases/${encodeURIComponent(input.recordId)}/claim`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${input.token}`,
    },
    body: JSON.stringify({
      candidate_id: input.candidate_id,
      subject_address: input.subject_address,
      statement: input.statement,
      claim_type: input.claim_type,
    }),
  });
  if (!res.ok) throw await parseError(res);
  return await res.json() as { claim_id: string; trace: CaseTrace };
}
