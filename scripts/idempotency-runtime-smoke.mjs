const target = process.env.TARGET_URL;
const requests = Number(process.env.REQUESTS ?? 50);
const intentId = process.env.INTENT_ID ?? `petraplan-runtime-${Date.now()}`;
const operation = process.env.OPERATION ?? 'idempotency-smoke';
const method = process.env.METHOD ?? 'POST';
const expiresAt = process.env.EXPIRES_AT ?? new Date(Date.now() + 10 * 60 * 1000).toISOString();

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
          'x-operation': operation,
          'x-test-expires-at': expiresAt,
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

const successful = results.filter((result) => result.ok);
const executionIds = successful
  .map((result) => result.payload && typeof result.payload === 'object' ? result.payload.execution_id : undefined)
  .filter(Boolean);
const claimWinners = successful.filter(
  (result) => result.payload && typeof result.payload === 'object' && result.payload.claimed === true,
).length;

const uniqueExecutionIds = [...new Set(executionIds)];
const allRequestsSucceeded = successful.length === requests;
const allReturnedExecutionIdentity = executionIds.length === requests;
const oneLogicalExecution = uniqueExecutionIds.length === 1;
const oneClaimWinner = claimWinners === 1;
const duplicateSafe = allRequestsSucceeded && allReturnedExecutionIdentity && oneLogicalExecution && oneClaimWinner;

console.log(JSON.stringify({
  target,
  method,
  intent_id: intentId,
  operation,
  expires_at: expiresAt,
  requests,
  successes: successful.length,
  failures: requests - successful.length,
  elapsed_ms: Date.now() - started,
  status_counts: statusCounts,
  execution_ids_observed: executionIds.length,
  unique_execution_ids: uniqueExecutionIds,
  claim_winners: claimWinners,
  duplicate_safe: duplicateSafe,
  proof_conditions: {
    all_requests_succeeded: allRequestsSucceeded,
    all_returned_execution_identity: allReturnedExecutionIdentity,
    exactly_one_execution_id: oneLogicalExecution,
    exactly_one_claim_winner: oneClaimWinner,
  },
}, null, 2));

if (!duplicateSafe) {
  console.error('Runtime idempotency proof failed. Every request must succeed, return the same execution_id, and exactly one request must claim ownership.');
  process.exitCode = 2;
}
