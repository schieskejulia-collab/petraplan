import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listCases, getCaseTrace } from '../../api-server/src/services/caseTrace.js';
import { listCases as listProductionCases } from '../../api-server/src/services/caseList.js';
import { reconcileReleaseGate } from '../../api-server/src/services/releaseReconciliation.js';
import { invalidateReleaseAfterNewClaim } from '../../api-server/src/services/claimReleaseInvalidation.js';

// Read-only Supabase query double: each query resolves to its configured rows.
function fakeDb(tables: Record<string, any[]>, counts: Record<string,number> = {}) {
  return {
    from(table: string) {
      let limit = Infinity;
      let selected = [...(tables[table] ?? [])];
      const query: any = {
        select() { return query; },
        eq(key:string,value:unknown) { selected=selected.filter(row=>row[key]===value); return query; },
        in(key:string,values:unknown[]) { selected=selected.filter(row=>values.includes(row[key])); return query; },
        order() { return query; },
        range() { return query; },
        limit(value:number) { limit=value; return query; },
        insert() { throw new Error('Unexpected write during ambiguity assessment'); },
        maybeSingle() {
          return Promise.resolve({ data: selected.slice(0,limit)[0] ?? null, error: null });
        },
        then(resolve: (value: any) => any, reject: (reason: any) => any) {
          return Promise.resolve({ data: selected.slice(0,limit), error: null, count:counts[table] ?? selected.length }).then(resolve, reject);
        },
      };
      return query;
    },
  } as any;
}
const record = { id: 'case-1', created_at: '2026-10-13T10:00:00Z', title: 'Case', category: 'test', status: 'open', source_system: 'test' };
const certificate = { id: 'cert-1', record_id:record.id, release_status: 'trusted', validation_result_id: 'v1', certified_at: '2026-10-13T12:00:00Z' };
const validation = { id: 'v1',conflict_id:'conflict-1', status: 'passed', created_at: '2026-10-13T11:59:59Z' };

test('listCases blocks conflicting certificates with identical certified_at', async () => {
  const db = fakeDb({ records: [record], release_certificates: [certificate, { ...certificate, id: 'cert-2', release_status: 'revoked' }] });
  const items = await listCases(db, 10, 0);
  assert.equal(items.length, 1);
  assert.equal(items[0].release_status, 'blocked');
});

test('listCases blocks conflicting status history with identical created_at', async () => {
  const db = fakeDb({
    records: [record],
    conflicts: [{ id: 'conflict-1',record_id:record.id, conflict: false }],
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
    conflicts: [{ id: 'conflict-1',record_id:record.id, conflict: false }],
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

test('production case list blocks tied certificates and history in either input order',async()=>{
 for(const historyTie of [false,true]) {
  const entries=historyTie ? [
    {release_certificate_id:certificate.id,new_status:'trusted',created_at:'2026-10-13T12:01:00Z'},
    {release_certificate_id:certificate.id,new_status:'revoked',created_at:'2026-10-13T12:01:00Z'},
  ] : [certificate,{...certificate,id:'cert-2',release_status:'revoked'}];
  for(const reversed of [false,true]) {
   const ordered=reversed?[...entries].reverse():entries;
   const db=fakeDb({records:[record],conflicts:[{id:'conflict-1',record_id:record.id,conflict:false}],
     release_certificates:historyTie?[certificate]:ordered,
     release_status_history:historyTie?ordered:[],validation_results:[validation]});
   assert.equal((await listProductionCases(db,10,0))[0].release_status,'blocked');
  }
 }
});

test('all case readers retain an unambiguous certified passing release',async()=>{
 const tables={records:[record],conflicts:[{id:'conflict-1',record_id:record.id,conflict:false}],
   release_certificates:[certificate],validation_results:[validation]};
 assert.equal((await listCases(fakeDb(tables),10,0))[0].release_status,'trusted');
 assert.equal((await listProductionCases(fakeDb(tables),10,0))[0].release_status,'trusted');
 assert.equal((await getCaseTrace(fakeDb(tables),record.id))?.release.effective_status,'trusted');
});

test('an orphaned passing certificate cannot remain usable without its validation basis',async()=>{
 const tables={records:[record],release_certificates:[certificate]};
 assert.equal((await listCases(fakeDb(tables),10,0))[0].release_status,'blocked');
 assert.equal((await listProductionCases(fakeDb(tables),10,0))[0].release_status,'blocked');
 assert.equal((await getCaseTrace(fakeDb(tables),record.id))?.release.effective_status,'blocked');
});

test('truncated certificate query is an explicit error instead of an incomplete release assessment',async()=>{
 const tables={records:[record],release_certificates:[certificate]};
 await assert.rejects(listCases(fakeDb(tables,{release_certificates:2}),10,0),/Incomplete decision-basis/);
 await assert.rejects(listProductionCases(fakeDb(tables,{release_certificates:2}),10,0),/Incomplete decision-basis/);
 await assert.rejects(getCaseTrace(fakeDb(tables,{release_certificates:2}),record.id),/Incomplete decision-basis/);
});

test('safety reconciliation and Claim invalidation never write against an arbitrary tied certificate or history',async()=>{
 for(const historyTie of [false,true]) {
  const db=fakeDb({release_certificates:historyTie?[certificate]:[certificate,{...certificate,id:'cert-2'}],
   release_status_history:historyTie?[
    {release_certificate_id:certificate.id,new_status:'trusted',created_at:'2026-10-13T12:01:00Z'},
    {release_certificate_id:certificate.id,new_status:'revoked',created_at:'2026-10-13T12:01:00Z'},
   ]:[]});
  const a=await reconcileReleaseGate({supabase:db,recordId:record.id,actorUserId:'reviewer'});
  const b=await invalidateReleaseAfterNewClaim({supabase:db,recordId:record.id,actorUserId:'reviewer',claimId:'claim-1'});
  for(const result of [a,b]) { assert.equal(result.effectiveStatus,'blocked'); assert.equal(result.transitioned,false); }
 }
});
