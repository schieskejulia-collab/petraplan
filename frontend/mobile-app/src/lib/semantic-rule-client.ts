export type SemanticRuleEvidence = { kind: 'SOURCE' | 'MEANING' | 'AUTHORITY'; reference: string; summary: string };
export type SemanticRuleDefinition = {
  question: string; condition: string; conclusion: string; justification: string;
  evidence: SemanticRuleEvidence[]; limitations: string[]; exceptions: string[]; unresolved_items: string[];
};
export type SemanticRule = {
  id: string; rule_id: string; version: number; claim_id: string;
  snapshot_id: string; source_address: string; source_path: string; target_address: string;
  question: string; condition_description: string; conclusion_description: string; justification: string;
  evidence: SemanticRuleEvidence[]; limitations: string[]; exceptions: string[]; unresolved_items: string[];
  status: 'PROPOSED' | 'APPROVED' | 'REJECTED' | 'REVOKED' | 'SUPERSEDED';
  snapshot_current: boolean;
  decision_authority: null | { id: string; role_name: string; authority_reference: string; valid_until: string };
  history: Array<{ id: string; decision: string; reason: string; actor_id: string; authority_id: string; decided_at: string;
    authority_role: string | null; authority_reference: string | null }>;
};
export async function semanticRuleRequest(recordId: string, token: string, body?: Record<string, unknown>): Promise<any> {
  const res = await fetch(`/api/cases/${encodeURIComponent(recordId)}/semantic-rules`, {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(String(data.error ?? `HTTP ${res.status}`));
  return data;
}
