/**
 * Mock Supabase client for idempotency smoke testing.
 * Simulates the RPC response without needing a real Postgres database.
 */

import { randomUUID } from 'crypto';

// In-memory claim store for this smoke test run
const claimsStore: Map<
  string,
  {
    claimed: boolean;
    execution_id: string;
    status: string;
    response_snapshot: unknown;
    error_snapshot: unknown;
  }
> = new Map();

export function createMockSupabaseClient() {
  return {
    rpc: async (
      fn: string,
      args: Record<string, unknown>,
    ): Promise<{
      data: unknown;
      error: { message?: string } | null;
    }> => {
      if (fn === 'claim_idempotent_execution') {
        const idempotencyKey = String(args.p_idempotency_key ?? '');

        // Simulate the RPC behavior: first request wins (claimed=true), others see the same execution_id but claimed=false
        let claimed = false;
        let executionId: string;
        
        if (!claimsStore.has(idempotencyKey)) {
          claimed = true;
          executionId = randomUUID();
          claimsStore.set(idempotencyKey, {
            claimed: true,
            execution_id: executionId,
            status: 'in_flight',
            response_snapshot: null,
            error_snapshot: null,
          });
        } else {
          const record = claimsStore.get(idempotencyKey)!;
          claimed = false;
          executionId = record.execution_id;
        }

        return {
          data: [
            {
              claimed,
              execution_id: executionId,
              status: 'in_flight',
              response_snapshot: null,
              error_snapshot: null,
            },
          ],
          error: null,
        };
      }

      return {
        data: null,
        error: { message: `Unknown RPC function: ${fn}` },
      };
    },

    from: () => ({
      insert: async () => ({ error: null }),
    }),
  };
}

export function resetMockStore() {
  claimsStore.clear();
}
