export type PersistedBridgeCase = {
  record_id: string;
  ingestion_id: string;
  validation_id: string;
  source_mode?: string;
  release_allowed: boolean;
  bridge_state: unknown;
  open_points: string[];
  errors: string[];
};

async function postIngest(token: string, bodyInput: Record<string, unknown>): Promise<PersistedBridgeCase> {
  const res = await fetch('/api/bridge/ingest', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(bodyInput),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(String(body.error ?? `HTTP ${res.status}`));
  return body as PersistedBridgeCase;
}

export async function persistTranslatorCase(input: {
  token: string;
  rawRecord: Record<string, unknown>;
  capturedAt: string;
  ingress?: Record<string, unknown>;
  response?: Record<string, unknown>;
  title?: string;
}): Promise<PersistedBridgeCase> {
  return postIngest(input.token, {
    raw_record: input.rawRecord,
    captured_at: input.capturedAt,
    ingress: input.ingress ?? {},
    response: input.response ?? {},
    title: input.title,
  });
}

export async function persistPinnedNorthwindCase(input: {
  token: string;
  orderId: number;
  capturedAt?: string;
}): Promise<PersistedBridgeCase> {
  return postIngest(input.token, {
    northwind_order_id: input.orderId,
    captured_at: input.capturedAt ?? new Date().toISOString(),
  });
}
