const BASE = "/api";

export interface BusinessProfile {
  business_name: string;
  industry: string;
  team_size?: number | null;
  tools?: string[];
  workflows?: string | null;
  repeated_tasks?: string | null;
  time_wasters?: string | null;
  top_priority?: string | null;
  desired_outcome?: string | null;
  premium_active?: boolean;
  user_yes_for_automation?: boolean;
}

export interface AnalysisResult {
  summary: string;
  insights: string[];
  risks: string[];
  opportunities: string[];
  recommendations: string[];
  automation_allowed: boolean;
  note: string;
}

export interface HistoryItem {
  id: number;
  created_at: string;
  business_name: string;
  industry: string;
  source: string;
}

export interface CaseListItem {
  id: string;
  created_at: string;
  title: string;
  category: string;
  status: string;
  source_system: string | null;
  conflict_count: number;
  release_status: "trusted" | "revoked" | "superseded" | null;
}

export interface CaseTrace {
  id: string;
  title: string;
  category: string;
  status: string;
  created_at: string;
  source: {
    record: Record<string, unknown>;
    ingestion: Record<string, unknown> | null;
  };
  semantic: {
    meaning: string;
    metadata: Record<string, unknown>;
    extracted_schema: Record<string, unknown> | null;
  };
  conflict: {
    conflicts: Array<Record<string, unknown>>;
    sources: Array<Record<string, unknown>>;
  };
  execution: { operations: Array<Record<string, unknown>> };
  runtime: { observations: Array<Record<string, unknown>> };
  resolution: {
    records: Array<Record<string, unknown>>;
    logs: Array<Record<string, unknown>>;
    status: Array<Record<string, unknown>>;
  };
  validation: { results: Array<Record<string, unknown>> };
  review: {
    records: Array<Record<string, unknown>>;
    sessions: Array<Record<string, unknown>>;
    criteria: Array<Record<string, unknown>>;
    decisions: Array<Record<string, unknown>>;
    logs: Array<Record<string, unknown>>;
    status_history: Array<Record<string, unknown>>;
  };
  release: {
    certificates: Array<Record<string, unknown>>;
    logs: Array<Record<string, unknown>>;
    status_history: Array<Record<string, unknown>>;
  };
}

async function parseError(res: Response): Promise<Error> {
  const body = await res.json().catch(() => ({}));
  const message = body.error ?? body.detail ?? `HTTP ${res.status}`;
  return new Error(String(message));
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await parseError(res);
  return res.json();
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw await parseError(res);
  return res.json();
}

export const milaApi = {
  analyze: (profile: BusinessProfile) => post<AnalysisResult>("/analyze", profile),
  aiAnalyze: (profile: BusinessProfile) => post<AnalysisResult>("/ai-analyze", profile),

  aiAnalyzeStream: async (profile: BusinessProfile): Promise<ReadableStreamDefaultReader<Uint8Array>> => {
    const res = await fetch(`${BASE}/ai-analyze/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(profile),
    });
    if (!res.ok || !res.body) throw new Error(`Stream failed: HTTP ${res.status}`);
    return res.body.getReader();
  },

  history: (limit = 20, offset = 0) =>
    get<{ items: HistoryItem[]; limit: number; offset: number }>(`/history?limit=${limit}&offset=${offset}`),
  historyItem: (id: number) => get<HistoryItem & { input_json: unknown; output_json: unknown }>(`/history/${id}`),
  deleteHistory: async (id: number): Promise<void> => {
    const res = await fetch(`${BASE}/history/${id}`, { method: "DELETE" });
    if (!res.ok) throw await parseError(res);
  },

  cases: (limit = 20, offset = 0) =>
    get<{ items: CaseListItem[]; limit: number; offset: number }>(`/cases?limit=${limit}&offset=${offset}`),
  caseTrace: (recordId: string) => get<CaseTrace>(`/cases/${encodeURIComponent(recordId)}`),

  health: () => get<{ status: string; version?: string }>("/health"),
};
