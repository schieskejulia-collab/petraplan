const target = process.env.TARGET_URL;
const requests = Number(process.env.REQUESTS ?? 50);
const intentId = process.env.INTENT_ID ?? `petraplan-runtime-${Date.now()}`;
const method = process.env.METHOD ?? 'POST';

if (!target) {
  console.error('TARGET_URL is required');
  process.exit(1);
}

const body = process.env.REQUEST_BODY ? JSON.parse(process.env.REQUEST_BODY) : undefined;

const started = Date.now();
const results = await Promise.all(
  Array.from({ length: requests }, async (_, index) => {
    const t0 = Date.now();
    try {
      const response = await fetch(target, {
        method,
        headers: {
          'content-type': 'application/json',
          'x-intent-id': intentId,
          'x-test-request-index': String(index),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });

      let payload = null;
      const text = await response.text();
      if (text) {
        try {
          payload = JSON.parse(text);
        } catch {
          payload = text;
        }
      }

      return {
        ok: response.ok,
        status: response.status,
        latency_ms: Date.now() - t0,
        payload,
      };
    } catch (error) {
      return {
        ok: false,
        status: null,
        latency_ms: Date.now() - t0,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }),
);

const statusCounts = results.reduce((acc, result) => {
  const key = String(result.status ?? 'network_error');
  acc[key] = (acc[key] ?? 0) + 1;
  return acc;
}, {});

const executionIds = results
  .map((result) => result.payload && typeof result.payload === 'object' ? result.payload.execution_id : undefined)
  .filter(Boolean);

const uniqueExecutionIds = [...new Set(executionIds)];
const duplicateSafe = uniqueExecutionIds.length <= 1;

console.log(JSON.stringify({
  target,
  method,
  intent_id: intentId,
  requests,
  elapsed_ms: Date.now() - started,
  status_counts: statusCounts,
  execution_ids_observed: executionIds.length,
  unique_execution_ids: uniqueExecutionIds,
  duplicate_safe: duplicateSafe,
  note: execution_id must be returned by the target endpoint for this script to prove single logical execution; otherwise it only reports transport behavior.
}, null, 2));

if (!duplicateSafe) process.exitCode = 2;
