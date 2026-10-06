import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {before,beforeEach,afterEach,after,test} from 'node:test';
import assert from 'node:assert/strict';
const db=new PGlite();const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const [record,snapshot,actor,claim,evidence,other]=[1,2,3,4,5,6].map(id);
const read=p=>readFile(new URL(p,import.meta.url),'utf8');
before(async()=>{
 await db.exec(await read('./schema.sql'));
 await db.exec('create schema auth;create table auth.users(id uuid primary key)');
 for(const p of ['../../db/address_layer.sql','../../db/claim_layer.sql','../../db/representation_evidence.sql'])await db.exec((await read(p)).replace('create extension if not exists pgcrypto;',''));
 await db.exec(await read('../../supabase/migrations/20261006121534_semantic_rule_governance.sql'));
 await db.exec(await read('../../supabase/migrations/20261006125308_claim_check_requirements.sql'));
 await db.exec('grant select on claims,claim_evidence_links,representation_evidence to service_role');
});
beforeEach(async()=>{await db.exec('begin');await db.query('insert into auth.users values($1)',[actor]);
 await db.query(`insert into ingestion_logs values($1,'processed','hash',$2)`,[snapshot,JSON.stringify({untouched:true})]);
 await db.query('insert into records values($1,$2)',[record,snapshot]);await db.query('insert into bridge_actor_roles values($1,true,true,true)',[actor]);
 await db.query(`insert into claims(id,claim_family_id,claim_type,subject_address,predicate,statement,status,scope_type,record_id,snapshot_id,created_by)
 values($1,$1,'SEMANTIC_MAPPING','case#STATUS','means','Shipment means closure','UNPROVEN','CASE_ONLY',$2,$3,$4)`,[claim,record,snapshot,actor]);
 await db.query(`insert into representation_evidence(id,ingestion_log_id,record_id,field_address,source_path,raw_representation,fidelity_status,assessment_note,evidence_hash,observed_at)
 values($1,$2,$3,'case#Rest','order.Rest','0','preserved','Fixture only',repeat('a',64),now())`,[evidence,snapshot,record]);
});afterEach(async()=>db.exec('rollback'));after(async()=>db.close());
const def={question:'Is the order closed?',required_information:'Remaining delivery amount',required_address:'case#Rest',check_condition:'No delivery remains under approved meaning',counter_condition:'A remaining delivery contradicts closure',coverage_requirement:'All deliveries covered in this snapshot',next_check:'Retrieve complete delivery export'};
const add=async(d=def,previous=null)=> (await db.query('select bridge_add_claim_check($1,$2,$3,$4,$5) as r',[record,claim,actor,JSON.stringify(d),previous])).rows[0].r;
const observe=async(r,o={})=>db.query('select bridge_record_claim_check($1,$2,$3,$4)',[record,r.id,actor,JSON.stringify({result:'UNKNOWN',coverage_status:'UNKNOWN',reason:'Meaning is still unresolved',...o})]);
const fails=async(fn,code)=>{await db.exec('savepoint x');try{await assert.rejects(fn,e=>e.code===code);}finally{await db.exec('rollback to savepoint x');}};
test('requirement records missing-field question without inventing a source value',async()=>{const r=await add({...def,required_address:'not-yet-known'});assert.equal(r.absence_policy,'UNKNOWN');assert.equal(r.claim_basis.length,64);await observe(r,{result:'MISSING'});assert.equal((await db.query('select status from claims')).rows[0].status,'UNPROVEN');assert.deepEqual((await db.query('select raw_payload from ingestion_logs')).rows[0].raw_payload,{untouched:true});});
test('support requires an actual matching field and documented complete coverage',async()=>{const r=await add();await fails(()=>observe(r,{result:'SUPPORTS',coverage_status:'COMPLETE',coverage_reference:'fixture://full-export'}),'23514');await fails(()=>observe(r,{result:'SUPPORTS',representation_evidence_id:evidence}),'PT409');await observe(r,{result:'SUPPORTS',representation_evidence_id:evidence,coverage_status:'COMPLETE',coverage_reference:'fixture://full-export'});assert.equal((await db.query('select status from claims')).rows[0].status,'UNPROVEN');});
test('counterevidence can be reported without assuming complete capture',async()=>{const r=await add();await observe(r,{result:'CONTRADICTS',representation_evidence_id:evidence});assert.equal((await db.query('select count(*)::int n from release_certificates')).rows[0].n,0);});
test('wrong address or snapshot cannot supply a check',async()=>{const r=await add({...def,required_address:'another-field'});await fails(()=>observe(r,{representation_evidence_id:evidence}),'PT409');});
test('changed Claim basis and retired requirement reject further reports',async()=>{const r=await add();await add({...def,next_check:'Retrieve revised export'},r.id);await fails(()=>observe(r),'PT409');const current=await add();await db.query("update claims set statement='Changed semantic statement' where id=$1",[claim]);await fails(()=>observe(current),'PT409');});
test('stale snapshot and revoked technical reviewer fail closed',async()=>{const r=await add();await db.query('update records set ingestion_log_id=null where id=$1',[record]);await fails(()=>observe(r),'PT409');await db.query('update records set ingestion_log_id=$1 where id=$2',[snapshot,record]);await db.query('update bridge_actor_roles set active=false where user_id=$1',[actor]);await fails(()=>observe(r),'PT403');});
test('records are immutable; browser cannot insert',async()=>{const r=await add();await fails(()=>db.query('update claim_check_requirements set next_check=$1 where id=$2',['Overwrite',r.id]),'PT409');await observe(r);await fails(()=>db.exec('delete from claim_check_observations'),'PT409');await db.exec('set local role authenticated');await fails(()=>db.exec('select * from claim_check_requirements'),'42501');await db.exec('reset role');});
test('service RPC works with restricted grants; coverage cannot be asserted with an empty reference',async()=>{await db.exec('set local role service_role');const r=await add();await fails(()=>observe(r,{coverage_status:'COMPLETE',coverage_reference:''}),'23514');await observe(r);await db.exec('reset role');});
test('report freezes the actual source evidence; client cannot supply a fabricated copy',async()=>{const r=await add();await observe(r,{representation_evidence_id:evidence,evidence_snapshot:{raw_representation:999}});const o=(await db.query('select * from claim_check_observations')).rows[0];assert.equal(o.evidence_snapshot.raw_representation,0);assert.equal(o.evidence_snapshot.id,evidence);});
