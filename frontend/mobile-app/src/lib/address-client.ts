export type AddressResolution = {
  address: { requested: string; canonical: string; status: 'resolved'; kind: string; sourceId: string };
  legacy: { sourceSystem: string; sourceReference: string; capturedAt: string; access: string; writePolicy: string };
  connector: { schemaGate: string; sourceSnapshot: any; mapped: Record<string, unknown>; mappingEvidence: any };
  links: Array<{ relation: string; address: string; status: string; label: string }>;
  addressInventory: Array<{ address: string; path: string; observedValue: unknown; kind: string; candidateIds: string[] }>;
  candidates: Array<{
    id: string; sourceAddress: string; sourcePath: string; observedValue: unknown; proposedValue: string;
    conversionKind: 'derive' | 'aggregate'; evidence: string; confirmed: false;
    impactAddresses: string[]; state: 'candidate' | 'confirmed' | 'rejected';
    stateHistory: Array<{ state: string; at: string; by: string; reason: string }>;
  }>;
  truth: { state: { state: string }; constraints: any[]; trace: any[]; provenance: any };
  guardRails: { sourceWritesAllowed: boolean; releaseAllowed: boolean; blockingConstraintIds: string[]; policy: string };
  decision: { state: string; releaseAllowed: boolean; reason: string; nextSafeStep: string };
  delivery: { prototypeStatus: string; persistedCase: string };
};

export async function resolveAddress(ref: string): Promise<AddressResolution> {
  const response = await fetch(`/api/address/resolve?ref=${encodeURIComponent(ref)}`);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(String(body.message ?? body.error ?? `HTTP ${response.status}`));
  return body as AddressResolution;
}
