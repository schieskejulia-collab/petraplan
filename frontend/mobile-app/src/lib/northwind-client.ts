export type NorthwindSummary = {
  orderId: number;
  recordId: string;
  customerId: string | null;
  companyName: string;
  orderDate: string | null;
  detailCount: number;
  sourceQuantities: number[];
  sourceSchemaGate: 'ACCEPTED' | 'BLOCKED';
  bridgeContractSchema: 'PASSED' | 'FAILED';
  bridgeState: string;
  releaseAllowed: boolean;
  blockingIssues: number;
  failedConstraintIds: string[];
};

export type NorthwindListResponse = {
  proof: string;
  upstream: { repository: string; commit: string; capturedAt: string };
  summary: {
    orders: number;
    orderDetails: number;
    customers: number;
    sourceSchemaAccepted: number;
    sourceSchemaBlocked: number;
    singleDetailOrders: number;
    multipleDetailOrders: number;
    zeroDetailOrders: number;
    stateCounts: Record<string, number>;
  };
  total: number;
  offset: number;
  limit: number;
  items: NorthwindSummary[];
};

export type NorthwindDetail = {
  orderId: number;
  envelope: any;
  sourceSchemaGate: 'ACCEPTED' | 'BLOCKED';
  sourceSchemaIssues: any[];
  adaptation: null | {
    raw: Record<string, string>;
    issues: any[];
    evidence: Record<string, unknown>;
  };
  evaluation: null | {
    state: any;
    mapped: Record<string, unknown>;
    constraints: any[];
    release: any;
    trace: any[];
    report: any;
    provenance: any;
  };
};

export async function listNorthwindOrders(input: {
  q?: string;
  state?: string;
  offset?: number;
  limit?: number;
} = {}): Promise<NorthwindListResponse> {
  const params = new URLSearchParams();
  if (input.q) params.set('q', input.q);
  if (input.state) params.set('state', input.state);
  params.set('offset', String(input.offset ?? 0));
  params.set('limit', String(input.limit ?? 25));
  const res = await fetch(`/api/northwind?${params.toString()}`);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(String(body.error ?? `HTTP ${res.status}`));
  return body as NorthwindListResponse;
}

export async function getNorthwindOrder(orderId: number): Promise<NorthwindDetail> {
  const res = await fetch(`/api/northwind/${orderId}`);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(String(body.error ?? `HTTP ${res.status}`));
  return body as NorthwindDetail;
}
