import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleRevalidation } from '../../api/cases/[recordId]/revalidate.js';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const candidate = { id: id(3), record_id: id(1), snapshot_id: id(2), state: 'confirmed',
  candidate_key: 'NW:A-10266:STATUS-DERIVATION', source_path: 'order.ShippedDate', proposed_value: 'STATUS=GESCHLOSSEN' };
const confirmedClaim = { id: id(4), candidate_id: id(3), record_id: id(1), snapshot_id: id(2),
  scope_type: 'CASE_ONLY', scope_payload: { record_id: id(1), snapshot_id: id(2), candidate_id: id(3) },
  status: 'CONFIRMED', rule_id: 'asserted-rule', rule_version: '1',
  confirmed_by: id(5), confirmed_at: '2026-10-01T00:00:00Z',
};

async function request(claims: any[] = [], options: { role?: boolean; token?: boolean; claimError?: boolean; candidates?: any[] } = {}) {
  const writes: string[] = [];
  const trace = { source: { ingestion: { id: id(2), status: 'processed',
    extracted_schema: { source_mode: 'northwind-proof', bridge_input_raw: { STATUS: 'UNKNOWN', MENGE: '12' } } } },
    validation: { authoritative: { id: id(6), status: 'failed' } } };
  const original = structuredClone(trace);
  const client = {
    auth: { getUser: async () => ({ data: { user: { id: id(5) } }, error: null }) },
    from(table: string) {
      const q: any = {
        select: () => q, eq: () => q, order: () => q, maybeSingle: () => q,
        insert: () => { writes.push(table); return q; },
        update: () => { writes.push(table); return q; },
        delete: () => { writes.push(table); return q; },
        then(resolve: any) {
          return Promise.resolve({ data: table === 'bridge_actor_roles' ? { can_review: options.role !== false }
            : table === 'conversion_candidates' ? options.candidates ?? [candidate] : claims,
            error: table === 'claims' && options.claimError ? new Error('Evidence store unavailable') : null }).then(resolve);
        },
      };
      return q;
    },
    rpc: async (name: string) => { writes.push(name); throw new Error('No RPC may run during blocked revalidation'); },
  };
  const res: any = { statusCode: 200, body: null, setHeader() {},
    status(n: number) { this.statusCode = n; return this; }, json(body: any) { this.body = body; return this; } };
  const oldUrl = process.env.SUPABASE_URL, oldKey = process.env.SUPABASE_SECRET_KEY;
  process.env.SUPABASE_URL = 'https://test.supabase.co'; process.env.SUPABASE_SECRET_KEY = 'test-only';
  try {
    await handleRevalidation({ method: 'POST', query: { recordId: id(1) },
      headers: { authorization: options.token === false ? '' : 'Bearer test' } }, res,
      { createClient: () => client, getCaseTrace: async () => trace } as any);
  } finally {
    if (oldUrl === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = oldUrl;
    if (oldKey === undefined) delete process.env.SUPABASE_SECRET_KEY; else process.env.SUPABASE_SECRET_KEY = oldKey;
  }
  assert.deepEqual(writes, []);
  assert.deepEqual(trace, original);
  assert.equal(res.body.validation_id, undefined);
  assert.equal(res.body.release_allowed, undefined);
  return res;
}

test('candidate confirmation without a claim cannot generate a passing validation', async () => {
  const res = await request();
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.blockers[0].code, 'CLAIM_MISSING');
  assert.equal(res.body.evidence_state, 'UNKNOWN');
});

for (const status of ['DRAFT', 'UNPROVEN', 'SUPPORTED', 'CONTESTED', 'REJECTED']) {
  test(`${status} semantic claim cannot be applied in revalidation`, async () => {
    const res = await request([{ ...confirmedClaim, status }]);
    assert.equal(res.statusCode, 409);
    assert.equal(res.body.blockers[0].code, 'CLAIM_UNRESOLVED');
  });
}

test('confirmed claim and a rule reference do not stand in for verified semantic authority', async () => {
  const res = await request([confirmedClaim]);
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.blockers[0].code, 'RULE_AUTHORITY_UNVERIFIED');
});

test('claim for another snapshot is explicitly blocked', async () => {
  const res = await request([{ ...confirmedClaim, snapshot_id: id(99) }]);
  assert.equal(res.body.blockers[0].code, 'CLAIM_SCOPE_MISMATCH');
});

test('an asserted rule without its version remains unproven', async () => {
  const res = await request([{ ...confirmedClaim, rule_version: null }]);
  assert.equal(res.body.blockers[0].code, 'RULE_REFERENCE_MISSING');
});

test('ambiguous claims are not silently picked', async () => {
  const res = await request([confirmedClaim, { ...confirmedClaim, id: id(99) }]);
  assert.equal(res.body.blockers[0].code, 'CLAIM_AMBIGUOUS');
});

test('source and human confirmation evidence cannot authorize quantity aggregation either', async () => {
  const res = await request([], { candidates: [{ ...candidate,
    candidate_key: 'NW:A-10266:QUANTITY-AGGREGATION', source_path: 'orderDetails[].Quantity',
    proposed_value: 'MENGE=12', evidence: 'Source and candidate history both present' }] });
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.blockers[0].code, 'CLAIM_MISSING');
});

test('unavailable claim data produces no validation or fallback', async () => {
  assert.equal((await request([], { claimError: true })).statusCode, 500);
});

test('revalidation still requires authentication and review permission', async () => {
  assert.equal((await request([], { token: false })).statusCode, 401);
  assert.equal((await request([], { role: false })).statusCode, 403);
});
