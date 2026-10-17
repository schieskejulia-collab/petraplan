import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import { buildAddressClaimReadModel } from './addressClaimReadModel.js';
import { claimFreshnessBlockers, unresolvedSemanticClaimBlockers } from './claimFreshness.js';

// Execute the actual TypeScript HTTP handler with injected, read-only test doubles.
// No Supabase connection, server startup, credentials or source-system writes.
const recordId = '00000000-0000-4000-8000-000000000001';
const snapshotId = '00000000-0000-4000-8000-000000000002';
const address = 'NW:A-10248#STATUS';
const claim = {
  id: 'claim-1', record_id: recordId, snapshot_id: snapshotId,
  subject_address: address, scope_type: 'CASE_ONLY',
  scope_payload: { record_id: recordId, snapshot_id: snapshotId },
  status: 'CONFIRMED', confirmed_by: 'reviewer', confirmed_at: '2026-10-17T10:00:00Z',
  statement: 'Reviewed meaning', predicate: 'status', object_value: 'shipped',
  created_at: '2026-10-17T10:00:00Z',
};
const evidence = { claim_id: claim.id, relation: 'SUPPORTS', evidence_reference: 'proof-1' };

function database() {
  return {
    from(table: string) {
      const data = table === 'claims' ? [claim] : table === 'claim_evidence_links' ? [evidence] : [];
      const chain: any = {
        select() { return chain; }, eq() { return chain; },
        in() { return chain; },
        order() { return Promise.resolve({ data, error: null }); },
      };
      return chain;
    },
  };
}

function handlerFor(validation: Record<string, any> | null, releaseStatus = 'trusted') {
  const source = readFileSync(resolve(process.cwd(), 'api/cases/[recordId].ts'), 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} as Record<string, any> };
  const trace = {
    source: { ingestion: { id: snapshotId, source_system: 'Northwind', ingested_at: '2026-10-17T09:00:00Z' } },
    address_layer: { addresses: [{ address }], candidates: [], links: [] },
    validation: { authoritative: validation },
    release: { effective_status: releaseStatus, certificates: [{ validation_result_id: 'validation-1' }] },
  };
  const mocks: Record<string, any> = {
    '../../api-server/src/services/caseTrace.js': { getCaseTrace: async () => trace },
    '../../api-server/src/services/rdfProvReadModel.js': { buildRdfProvReadModel: () => ({}) },
    '../../api-server/src/services/addressClaimReadModel.js': { buildAddressClaimReadModel },
    '../../api-server/src/services/claimFreshness.js': { claimFreshnessBlockers, unresolvedSemanticClaimBlockers },
    '../_lib/auth.js': { requireBridgeRole: async () => ({ supabase: database() }) },
  };
  vm.runInNewContext(compiled, {
    module, exports: module.exports,
    require: (id: string) => {
      if (!(id in mocks)) throw new Error('Unexpected module: ' + id);
      return mocks[id];
    },
    console,
  }, { filename: 'api/cases/[recordId].ts' });
  return module.exports.default as (req: any, res: any) => Promise<void>;
}

async function request(handler: (req: any, res: any) => Promise<void>, method = 'GET') {
  let status = 200;
  let body: any;
  const res = {
    status(code: number) { status = code; return res; },
    json(value: any) { body = value; return res; },
    setHeader() { return res; },
  };
  await handler({ method, query: { recordId } }, res);
  return { status, body };
}

test('HTTP case GET returns claims but blocks current use without validation timestamp', async () => {
  const result = await request(handlerFor({ id: 'validation-1' }));
  assert.equal(result.status, 200);
  assert.equal(result.body.claim_layer.claims.length, 1);
  assert.equal(result.body.address_claim_read[0].claims[0].classification, 'CONFIRMED_NOT_CURRENTLY_USABLE');
  assert.ok(result.body.address_claim_read[0].claims[0].blockers.includes('CURRENT_RELEASE_NOT_VERIFIED'));
});

test('HTTP case GET accepts a timestamped validation basis without silently confirming claims', async () => {
  const result = await request(handlerFor({ id: 'validation-1', created_at: '2026-10-17T11:00:00Z' }));
  assert.equal(result.status, 200);
  assert.equal(result.body.address_claim_read[0].claims.length, 1);
  assert.equal(result.body.address_claim_read[0].claims[0].classification, 'CURRENTLY_USABLE');
});

test('HTTP case endpoint rejects write methods', async () => {
  const result = await request(handlerFor({ id: 'validation-1' }), 'POST');
  assert.equal(result.status, 405);
});
