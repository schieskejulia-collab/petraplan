import type { CaseTrace } from '@/api/connector';

export type BridgeDecisionAction = 'approve_review' | 'reject_review' | 'release' | 'revoke';

export interface BridgeDecisionAccess {
  role: string;
  can_review: boolean;
  can_release: boolean;
  can_revoke: boolean;
  review_ready: boolean;
  release_ready: boolean;
  revoke_ready: boolean;
}

async function parseError(res: Response): Promise<Error> {
  const body = await res.json().catch(() => ({}));
  return new Error(String(body.error ?? `HTTP ${res.status}`));
}

export async function getBridgeDecisionAccess(recordId: string, token: string): Promise<BridgeDecisionAccess> {
  const res = await fetch(`/api/cases/${encodeURIComponent(recordId)}/decision`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw await parseError(res);
  return (await res.json()).access as BridgeDecisionAccess;
}

export async function submitBridgeDecision(input: {
  recordId: string;
  token: string;
  action: BridgeDecisionAction;
  reason: string;
  criteria?: Record<string, boolean>;
}): Promise<CaseTrace> {
  const res = await fetch(`/api/cases/${encodeURIComponent(input.recordId)}/decision`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${input.token}`,
    },
    body: JSON.stringify({ action: input.action, reason: input.reason, criteria: input.criteria ?? {} }),
  });
  if (!res.ok) throw await parseError(res);
  return (await res.json()).trace as CaseTrace;
}
