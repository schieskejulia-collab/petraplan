import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

// Behavioral proof in an isolated relevant subschema, not a full Supabase replica
// or a multi-connection concurrency proof. Audit function is the actual live DDL.
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
async function fixture() {
 const db=new PGlite();
 await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
 create table public.records(id uuid primary key);
 create table public.release_certificates(id uuid primary key,record_id uuid not null references public.records,release_status text not null);
 create table public.release_status_history(id uuid primary key default gen_random_uuid(),release_certificate_id uuid not null references public.release_certificates,
 previous_status text,new_status text not null,changed_by uuid,reason text,created_at timestamptz not null default clock_timestamp());
 create table public.audit_log(id uuid primary key default gen_random_uuid(),actor_type text,table_name text,record_id uuid,action text,before_data jsonb,after_data jsonb,source text);
 insert into public.records values('${id(1)}');
 insert into public.release_certificates values('${id(2)}','${id(1)}','trusted');
 grant usage on schema public to service_role;
 grant all on all tables in schema public to service_role;`);
 const metadata=JSON.parse(await readFile(new URL('../../docs/verification/2026-10-26-original-schema-observations.json',import.meta.url),'utf8'));
 await db.exec(metadata.triggers.find(t=>t.function==='audit_row_change').body);
 await db.exec(await readFile(new URL('../../supabase/migrations/20261026161308_release_history_integrity_guard.sql',import.meta.url),'utf8'));
 return db;
}
async function event(db,status,certificate=id(2)) {
 return db.query(`insert into public.release_status_history(release_certificate_id,new_status,changed_by,reason)
 values($1,$2,$3,'Explicit test decision') returning *`,[certificate,status,id(3)]);
}

test('release history insert records its actual predecessor and audits atomically',async()=>{
 const db=await fixture();try {
  await db.exec('set role service_role');
  const row=(await db.query(`insert into public.release_status_history(release_certificate_id,new_status,previous_status,created_at)
    values($1,'revoked','invented','1990-01-01') returning *`,[id(2)])).rows[0];
  assert.equal(row.previous_status,'trusted');
  assert.ok(new Date(row.created_at).getTime()>Date.parse('2026-01-01'));
  const audit=(await db.query('select * from public.audit_log')).rows;
  assert.equal(audit.length,1);assert.equal(audit[0].record_id,row.id);
  assert.equal(audit[0].after_data.new_status,'revoked');
 }finally{await db.close();}
});

test('history cannot be rewritten, deleted or truncated after revocation',async()=>{
 const db=await fixture();try {
  await event(db,'revoked');
  for(const sql of ["update public.release_status_history set new_status='trusted'",'delete from public.release_status_history','truncate public.release_status_history'])
    await assert.rejects(db.exec(sql),/append-only/);
  assert.equal((await db.query('select new_status from public.release_status_history')).rows[0].new_status,'revoked');
  assert.equal((await db.query('select count(*)::int n from public.audit_log')).rows[0].n,1);
 }finally{await db.close();}
});

test('terminal history cannot be reactivated by trust, exception or a blocked event',async()=>{
 for(const terminal of ['revoked','superseded']) {
  const db=await fixture();try {
   await event(db,terminal);
   for(const status of ['trusted','exception','blocked']) await assert.rejects(event(db,status),/Terminal release history/);
   assert.equal((await db.query('select count(*)::int n from public.release_status_history')).rows[0].n,1);
   // A fresh certificate has its own history, so the old terminal record is retained.
   await db.query('insert into public.release_certificates values($1,$2,$3)',[id(4),id(1),'trusted']);
   await event(db,'trusted',id(4));
  }finally{await db.close();}
 }
});

test('failed audit insertion rolls back the history event',async()=>{
 const db=await fixture();try {
  await db.exec("alter table public.audit_log add constraint reject_test_audit check (table_name<>'release_status_history')");
  await assert.rejects(event(db,'revoked'),/reject_test_audit/);
  assert.equal((await db.query('select count(*)::int n from public.release_status_history')).rows[0].n,0);
 }finally{await db.close();}
});
