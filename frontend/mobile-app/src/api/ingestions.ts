export type IngestionStatus = 'pending' | 'processed' | 'error';

export type IngestionLogSummary = {
  id: string;
  source_system: string;
  status: IngestionStatus;
  error_message: string | null;
  created_at: string;
  extracted_schema: Record<string, unknown> | null;
};

export type IngestionLogDetail = IngestionLogSummary & {
  raw_payload: Record<string, unknown>;
};

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '');

async function requestJson<T>(path: string): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`);
  const body = await response.json().catch(() => ({}));

  if (!response.ok) {
    const message =
      body && typeof body === 'object' && 'error' in body && typeof body.error === 'string'
        ? body.error
        : `Request failed with status ${response.status}`;
    throw new Error(message);
  }

  return body as T;
}

export async function listIngestions(limit = 25): Promise<IngestionLogSummary[]> {
  const result = await requestJson<{ items: IngestionLogSummary[] }>(
    `/api/ingestions?limit=${encodeURIComponent(limit)}`,
  );
  return result.items;
}

export function getIngestion(id: string): Promise<IngestionLogDetail> {
  return requestJson<IngestionLogDetail>(`/api/ingestions/${encodeURIComponent(id)}`);
}
