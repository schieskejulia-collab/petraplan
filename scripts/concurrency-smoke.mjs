const target = process.env.TARGET_URL;
const total = Number(process.env.CONCURRENCY_REQUESTS ?? 50);
const method = (process.env.REQUEST_METHOD ?? 'GET').toUpperCase();
const intentId = process.env.INTENT_ID ?? 'petraplan-concurrency-smoke';

if (!target) {
  console.error('TARGET_URL is required. Example: TARGET_URL=https://example.test/api/healthz npm run test:concurrency');
  process.exit(2);
}

if (!Number.isInteger(total) || total < 2 || total > 1000) {
  console.error('CONCURRENCY_REQUESTS must be an integer between 2 and 1000.');
  process.exit(2);
}

const started = performance.now();

const requests = Array.from({ length: total }, async (_, index) => {
  const requestStarted = performance.now();
  try {
    const headers = {
      'x-petraplan-test-request': String(index + 1),
      'x-petraplan-intent-id': intentId,
    };

    const response = await fetch(target, { method, headers });
    const body = await response.text();
    return {
      index: index + 1,
      ok: response.ok,
      status: response.status,
      duration_ms: Math.round(performance.now() - requestStarted),
      request_id: response.headers.get('x-request-id'),
      body_preview: body.slice(0, 120),
    };
  } catch (error) {
    return {
      index: index + 1,
      ok: false,
      status: null,
      duration_ms: Math.round(performance.now() - requestStarted),
      error: error instanceof Error ? error.message : String(error),
    };
  }
});

const results = await Promise.all(requests);
const elapsed = Math.round(performance.now() - started);
const successes = results.filter((item) => item.ok).length;
const failures = results.length - successes;
const statusCounts = results.reduce((acc, item) => {
  const key = item.status == null ? 'network_error' : String(item.status);
  acc[key] = (acc[key] ?? 0) + 1;
  return acc;
}, {});
const durations = results.map((item) => item.duration_ms).sort((a, b) => a - b);
const percentile = (p) => durations[Math.min(durations.length - 1, Math.floor(durations.length * p))];

console.log(JSON.stringify({
  target,
  method,
  intent_id: intentId,
  requests: total,
  successes,
  failures,
  elapsed_ms: elapsed,
  status_counts: statusCounts,
  latency_ms: {
    min: durations[0],
    p50: percentile(0.50),
    p95: percentile(0.95),
    max: durations[durations.length - 1],
  },
  sample_failures: results.filter((item) => !item.ok).slice(0, 10),
}, null, 2));

if (failures > 0) process.exitCode = 1;
