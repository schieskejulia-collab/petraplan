import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

// Execute the observed original guard and audit functions in a relevant isolated
// subschema. This proves guard behavior, not full-schema or browser compatibility.
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
async function fixture() {
 const db=new PGlite();
 await db.exec(`
 create table public.audit_log(id uuid primary key default gen_random_uuid(),actor_type text,table_name text,record_id uuid,action text,before_data jsonb,after_data jsonb,source text);
 create table public.ingestion_logs(id uuid primary key,source_system text not null,source_reference text,source_hash text not null,raw_payload jsonb not null,status text,extracted_schema jsonb);
 create table public.records(id uuid primary key,ingestion_log_id uuid references public.ingestion_logs);
 create table public.conversion_candidates(id uuid primary key);
 create table public.address_registry(id uuid primary key,source_id text not null,address text not null,source_path text not null,
 parent_address_id uuid references public.address_registry,first_snapshot_id uuid references public.ingestion_logs,
 first_record_id uuid references public.records,kind text,unique(source_id,address),check(parent_address_id is null or parent_address_id<>id));
 create table public.address_observations(id uuid primary key,address_id uuid references public.address_registry,record_id uuid references public.records,snapshot_id uuid references public.ingestion_logs,unique(record_id,address_id));
 create table public.impact_links(id uuid primary key,candidate_id uuid references public.conversion_candidates,address_id uuid references public.address_registry,
 link_type text check(link_type='impacts'),unique(candidate_id,address_id,link_type));`);
 const metadata=JSON.parse(await readFile(new URL('../../docs/verification/2026-10-26-original-schema-observations.json',import.meta.url),'utf8'));
 const functions=new Map();
 const triggers=metadata.triggers.filter(t=>['ingestion_logs','address_registry','address_observations','impact_links'].includes(t.table)
   && t.function!=='bridge_trace_root_ingestion');
 for(const t of triggers) functions.set(t.function,t.body);
 for(const body of functions.values()) await db.exec(body);
 for(const t of triggers) await db.exec(t.definition);
 await db.query("insert into public.ingestion_logs values($1,'source-a','object:1','hash-1','{\"quantity\":2}','pending',null)",[id(1)]);
 await db.query('insert into public.records values($1,$2)',[id(2),id(1)]);
 await db.query('insert into public.conversion_candidates values($1)',[id(3)]);
 return db;
}
async function address(db,n,source='source-a',parent=null,text='object:1') {
 return db.query(`insert into public.address_registry values($1,$2,$3,'/quantity',$4,$5,$6,'field')`,[id(n),source,text,parent,id(1),id(2)]);
}

test('observed Snapshot guard preserves source identity and payload while allowing processing metadata',async()=>{
 const db=await fixture();try {
  for(const change of ["raw_payload='{}'","source_hash='other'","source_system='other'","source_reference='other'"])
   await assert.rejects(db.exec(`update public.ingestion_logs set ${change}`),/immutable/);
  await db.exec("update public.ingestion_logs set status='processed',extracted_schema='{\"technical\":true}'");
  const row=(await db.query('select * from public.ingestion_logs')).rows[0];
  assert.deepEqual(row.raw_payload,{quantity:2});assert.equal(row.status,'processed');
  assert.equal((await db.query("select count(*)::int n from public.audit_log where table_name='ingestion_logs'")).rows[0].n,2);
 }finally{await db.close();}
});

test('observed Address guard enforces source uniqueness, parent scope, immutability and insertion audit',async()=>{
 const db=await fixture();try {
  await address(db,10);
  await assert.rejects(address(db,11),/unique/);
  await address(db,12,'source-b');
  await assert.rejects(address(db,13,'source-b',id(10),'child'),/same source/);
  await assert.rejects(address(db,14,'source-a',id(14),'self'),/same source|check/);
  await address(db,15,'source-a',id(10),'child');
  await assert.rejects(db.exec("update public.address_registry set source_path='/other'"),/append-only/);
  await assert.rejects(db.exec('delete from public.address_registry'),/append-only/);
  assert.equal((await db.query("select count(*)::int n from public.audit_log where table_name='address_registry'")).rows[0].n,3);
 }finally{await db.close();}
});

test('observed Reference guard accepts only impacts, rejects duplicates and preserves audited links',async()=>{
 const db=await fixture();try {
  await address(db,10);
  const insert=(n,type='impacts')=>db.query('insert into public.impact_links values($1,$2,$3,$4)',[id(n),id(3),id(10),type]);
  await insert(20);
  await assert.rejects(insert(21),/unique/);
  await assert.rejects(insert(22,'replaces'),/check/);
  await assert.rejects(db.exec('delete from public.impact_links'),/append-only/);
  await assert.rejects(db.exec("update public.impact_links set link_type='replaces'"),/append-only/);
  assert.equal((await db.query("select count(*)::int n from public.audit_log where table_name='impact_links'")).rows[0].n,1);
 }finally{await db.close();}
});
