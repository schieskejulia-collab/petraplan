import type { CapabilityProfileInput } from './bridge-capability-profile';

export type PetraPlanSource = {
  id: string;
  name: string;
  kind: 'pinned_reference' | string;
  mode: 'read_only' | string;
  status: 'ready' | string;
  description: string;
  origin: { label: string; revision: string };
  identity: CapabilityProfileInput['identity'];
  structure: CapabilityProfileInput['structure'];
  capabilities: CapabilityProfileInput['capabilities'];
  limits: CapabilityProfileInput['limits'];
};

export type SourceListResponse = {
  sources: PetraPlanSource[];
  principle: string;
};

export type SourceHealthResponse = {
  sourceId: string;
  status: 'ready';
  checkedAt: string;
  durationMs: number;
  summary: { orders: number; orderDetails: number; customers: number };
  sample: Array<{ orderId: number; recordId: string; customerId: string; companyName: string }>;
};

async function request<T>(path: string): Promise<T> {
  const response = await fetch(path);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
  return body as T;
}

export function listSources() {
  return request<SourceListResponse>('/api/sources');
}

export function checkNorthwindSource() {
  return request<SourceHealthResponse>('/api/sources/northwind/health');
}
