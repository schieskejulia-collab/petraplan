export type PersistedBridgeCase = {
  record_id: string;
  ingestion_id: string;
  validation_id: string;
  release_allowed: boolean;
  bridge_state: unknown;
  open_points: string[];
  errors: string[];
};

export async function persistTranslatorCase(input: {
  token: string;
  rawRecord: Record<string, unknown>;
  capturedAt: string;
  ingress?: Record<string, unknown>;
  response?: Record<string, unknown>;
  title?: string;
}): Promise<PersistedBridgeCase> {
  const res = await fetch('/api/bridge/ingest', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${input.token}`,
    },
    body: JSON.stringify({
      raw_record: input.rawRecord,
      captured_at: input.capturedAt,
      ingress: input.ingress ?? {},
      response: input.response ?? {},
      title: input.title,
    }),
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(String(body.error ?? `HTTP ${res.status}`));
  return body as PersistedBridgeCase;
}
