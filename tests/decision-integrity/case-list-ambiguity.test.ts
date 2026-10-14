import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listCases, getCaseTrace } from '../../api-server/src/services/caseTrace.js';

// Read-only Supabase query double: each query resolves to its configured rows.
function fakeDb(tables: Record<string, any[]>) {
  return {
    from(table: string) {
      const query: any = {
        select() { return query; },
        eq() { return query; },
        in() { return query; },
        order() { return query; },
        range() { return query; },
        maybeSingle() {
          const matches = tables[table] ?? [];
          return Promise.resolve({ data: matches[0] ?? null, error: null });
        },
        then(resolve: (value: any) => any, reject: (reason: any) => any) {
          return Promise.resolve({ data: tables[table] ?? [], error: null }).then(resolve, reject);
        },
      };
      return query;
    },
  } as any;
}
const record = { id: 'case-1', created_at: '2026-10-13T10:00:00Z', title: 'Case', category: 'test', status: 'open', source_system: 'test' };
const certificate = { id: 'cert-1', release_status: 'trusted', validation_result_id: 'v1', certified_at: '2026-10-13T12:00:00Z' };
const validation = { id: 'v1', status: 'passed', created_at: '2026-10-13T11:59:59Z' };

test('listCases blocks conflicting certificates with identical certified_at', async () => {
  const db = fakeDb({ records: [record], release_certificates: [certificate, { ...certificate, id: 'cert-2', release_status: 'revoked' }] });
  const items = await listCases(db, 10, 0);
  assert.equal(items.length, 1);
  assert.equal(items[0].release_status, 'blocked');
});

test('listCases blocks conflicting status history with identical created_at', async () => {
  const db = fakeDb({
    records: [record],
    conflicts: [{ id: 'conflict-1', conflict: false }],
    release_certificates: [certificate],
    release_status_history: [
      { release_certificate_id: 'cert-1', new_status: 'trusted', created_at: '2026-10-13T12:01:00Z' },
      { release_certificate_id: 'cert-1', new_status: 'revoked', created_at: '2026-10-13T12:01:00Z' },
    ],
    validation_results: [validation],
  });
  const items = await listCases(db, 10, 0);
  assert.equal(items[0].release_status, 'blocked');
});

test('getCaseTrace blocks tied certificates even when one claims trusted', async () => {
  const db = fakeDb({
    records: [record],
    release_certificates: [certificate, { ...certificate, id: 'cert-2', release_status: 'revoked' }],
  });
  const trace = await getCaseTrace(db, record.id);
  assert.equal(trace?.release.effective_status, 'blocked');
});

test('getCaseTrace blocks tied release history despite passing validation', async () => {
  const db = fakeDb({
    records: [record],
    conflicts: [{ id: 'conflict-1', conflict: false }],
    release_certificates: [certificate],
    release_status_history: [
      { release_certificate_id: 'cert-1', new_status: 'trusted', created_at: '2026-10-13T12:01:00Z' },
      { release_certificate_id: 'cert-1', new_status: 'revoked', created_at: '2026-10-13T12:01:00Z' },
    ],
    validation_results: [validation],
  });
  const trace = await getCaseTrace(db, record.id);
  assert.equal(trace?.release.effective_status, 'blocked');
});
