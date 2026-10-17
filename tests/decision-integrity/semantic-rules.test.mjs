import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { before, beforeEach, afterEach, after, test } from 'node:test';
import assert from 'node:assert/strict';

const db = new PGlite();
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const [record, snapshot, actor, candidate, address, claim, authority, otherActor] = Array.from({length:8}, (_,i)=>id(i+1));
const read = path => readFile(new URL(path, import.meta.url), 'utf8');
const migration = '20261006121534_semantic_rule_governance';
const criteria = { identities_checked:true, meaning_evidence_checked:true, source_coverage_checked:true, counterexamples_checked:true, scope_checked:true };
const definition = {
  question:'Welche Bedeutung hat der Versand für diesen Testfall?',
  condition:'Das Versanddatum ist im genau benannten Test-Snapshot vorhanden.',
  conclusion:'Der Vorschlag soll ausschließlich im synthetischen Testkontext gelten.',
  justification:'Synthetische Testautorität; kein Beleg für die fachliche Bedeutung von Northwind.',
  evidence:[{kind:'MEANING',reference:'fixture://meaning-proof',summary:'Nur eine isolierte Testdefinition zur Prüfung des Genehmigungsmechanismus.'}],
  limitations:['Nur synthetische Fixture'], exceptions:[], unresolved_items:[],
};

before(async()=>{
  await db.exec(await read('./schema.sql'));
  await db.exec(`create schema auth; create table auth.users(id uuid primary key);
    alter table release_certificates alter column certified_by type text using certified_by::text;
    alter table release_status_history alter column changed_by type text using changed_by::text;`);
  await db.exec((await read('../../db/address_layer.sql')).replace('create extension if not exists pgcrypto;',''));
  await db.exec((await read('../../db/claim_layer.sql')).replace('create extension if not exists pgcrypto;',''));
  for (const name of ['20260927222002_chinch64_decision_integrity','20260927222450_chinch64_existing_basis_guard',
    '20261002141108_chinch64_revoked_release_terminal','20261002141136_chinch64_claim_freshness_guard',
    '20261002173000_chinch64_unresolved_semantic_claim_guard',migration]) {
    await db.exec(await read(`../../supabase/migrations/${name}.sql`));
  }
  // Fixture permissions for existing tables; keep new catalogue grants exactly as shipped.
  await db.exec('grant all on claims,claim_evidence_links,address_registry,conversion_candidates to service_role');
});
beforeEach(async()=>{
  await db.exec('begin');
  await db.query('insert into auth.users values ($1),($2)',[actor,otherActor]);
  await db.query("insert into ingestion_logs values($1,'processed','test-hash','{\"unchanged\":true}')",[snapshot]);
  await db.query('insert into records values($1,$2)',[record,snapshot]);
  await db.query('insert into bridge_actor_roles values($1,true,true,true),($2,true,true,true)',[actor,otherActor]);
  await db.query(`insert into address_registry(id,source_id,first_snapshot_id,first_record_id,address,kind,source_path,registered_at)
    values($1,'fixture',$2,$3,'fixture:case#ShippedDate','field','order.ShippedDate',now())`,[address,snapshot,record]);
  await db.query(`insert into conversion_candidates(id,candidate_key,record_id,snapshot_id,source_address_id,source_path,
    observed_value,proposed_value,conversion_kind,evidence,state,created_at)
    values($1,'fixture:STATUS-DERIVATION',$2,$3,$4,'order.ShippedDate','"1996-07-31"','"STATUS=GESCHLOSSEN"',
    'semantic','Observed source only','confirmed',now())`,[candidate,record,snapshot,address]);
  await db.query(`insert into claims(id,claim_family_id,claim_type,subject_address,predicate,object_value,statement,status,
    scope_type,scope_payload,record_id,snapshot_id,candidate_id,created_by)
    values($1,$1,'SEMANTIC_MAPPING','fixture:case#STATUS','meaning','"STATUS=GESCHLOSSEN"','Unproven meaning in synthetic case',
    'UNPROVEN','CASE_ONLY',$2,$3,$4,$5,$6)`,[claim,JSON.stringify({record_id:record,snapshot_id:snapshot,candidate_id:candidate}),record,snapshot,candidate,actor]);
});
afterEach(async()=>{ await db.exec('rollback'); });
after(async()=>{ await db.close(); });
const propose = async(def=definition,previous=null)=> (await db.query(
  'select bridge_propose_semantic_rule($1,$2,$3,$4,$5) as r',[record,claim,actor,JSON.stringify(def),previous])).rows[0].r;
const grant = async()=>db.query(`insert into semantic_rule_authorities(id,user_id,record_id,snapshot_id,target_address,role_name,
  authority_reference,granted_by,valid_until) values($1,$2,$3,$4,'fixture:case#STATUS','Fixture domain reviewer',
  'fixture://delegation-proof',$2,now()+interval '1 day')`,[authority,actor,record,snapshot]);
const decide = async(rule,decision='APPROVED',who=actor,checks=criteria)=>db.query(
  'select bridge_decide_semantic_rule($1,$2,$3,$4,$5,$6,$7) as d',
  [record,rule.id,who,authority,decision,'Explicit decision on synthetic test evidence',JSON.stringify(checks)]);
const fails = async(fn,code)=>{
  await db.exec('savepoint expected_failure');
  try { await assert.rejects(fn,error=>error.code===code); }
  finally { await db.exec('rollback to savepoint expected_failure'); }
};

test('proposal stays PROPOSED and leaves source, Claim and release unchanged',async()=>{
  const rule=await propose({...definition,unresolved_items:['Is shipment equivalent to closed?']});
  assert.equal(rule.status,'PROPOSED'); assert.equal(rule.scope_type,'CASE_ONLY');
  assert.equal(rule.source_address,'fixture:case#ShippedDate'); assert.equal(rule.target_address,'fixture:case#STATUS');
  assert.equal((await db.query('select status from claims where id=$1',[claim])).rows[0].status,'UNPROVEN');
  assert.deepEqual((await db.query('select raw_payload from ingestion_logs where id=$1',[snapshot])).rows[0].raw_payload,{unchanged:true});
  assert.equal((await db.query('select count(*)::int as n from release_certificates')).rows[0].n,0);
});
test('ordinary reviewer cannot approve without documented semantic authority',async()=>{
  const rule=await propose(); await fails(()=>decide(rule),'PT403');
});
test('authority for another user cannot be supplied by the caller',async()=>{
  await grant(); const rule=await propose(); await fails(()=>decide(rule,'APPROVED',otherActor),'PT403');
});
test('source-only evidence and open questions independently prevent approval',async()=>{
  await grant();
  let rule=await propose({...definition,evidence:[{...definition.evidence[0],kind:'SOURCE'}]});
  await fails(()=>decide(rule),'PT409');
  rule=await propose({...definition,unresolved_items:['Meaning not established']});
  await fails(()=>decide(rule),'PT409');
});
test('all review criteria require explicit true; string values do not count',async()=>{
  await grant(); const rule=await propose();
  await fails(()=>decide(rule,'APPROVED',actor,{...criteria,scope_checked:'true'}),'PT409');
  await fails(()=>decide(rule,'APPROVED',actor,{...criteria,counterexamples_checked:false}),'PT409');
});
test('approval records authority and version but does not confirm Claim or release',async()=>{
  await grant(); const rule=await propose(); await decide(rule);
  assert.equal((await db.query('select bridge_semantic_rule_status($1) as s',[rule.id])).rows[0].s,'APPROVED');
  const event=(await db.query('select * from semantic_rule_decisions where rule_version_id=$1',[rule.id])).rows[0];
  assert.equal(event.actor_id,actor); assert.equal(event.authority_id,authority);
  assert.equal((await db.query('select status from claims where id=$1',[claim])).rows[0].status,'UNPROVEN');
  assert.equal((await db.query('select count(*)::int as n from release_certificates')).rows[0].n,0);
});
test('the actual service role can execute the guarded proposal and decision RPCs',async()=>{
  await grant();await db.exec('set role service_role');
  try { const rule=await propose();await decide(rule); }
  finally { await db.exec('reset role'); }
});
test('rejected rule cannot be revived; revision preserves old version and old rejection',async()=>{
  await grant(); const first=await propose(); await decide(first,'REJECTED');
  await fails(()=>decide(first),'PT409');
  const next=await propose({...definition,justification:'New independently reviewed fixture argument'},first.id);
  assert.equal(next.rule_id,first.rule_id); assert.equal(next.version,2); assert.equal(next.status,'PROPOSED');
  assert.equal((await db.query('select bridge_semantic_rule_status($1) as s',[first.id])).rows[0].s,'REJECTED');
  await fails(()=>propose(definition,first.id),'PT409');
});
test('definitions, decisions and authority grants cannot be overwritten or deleted',async()=>{
  await grant(); const rule=await propose(); await decide(rule);
  await fails(()=>db.query('update semantic_rule_versions set question=$1 where id=$2',['Rewritten question',rule.id]),'PT409');
  await fails(()=>db.query('delete from semantic_rule_decisions where rule_version_id=$1',[rule.id]),'PT409');
  await fails(()=>db.query('update semantic_rule_authorities set target_address=$1 where id=$2',['Other target',authority]),'PT409');
});
test('browser roles cannot call the RPC or read catalogue tables; service cannot mint authority',async()=>{
  for(const role of ['anon','authenticated']){
    assert.equal((await db.query("select has_function_privilege($1,'public.bridge_propose_semantic_rule(uuid,uuid,uuid,jsonb,uuid)','EXECUTE') as p",[role])).rows[0].p,false);
    assert.equal((await db.query("select has_table_privilege($1,'public.semantic_rule_versions','SELECT') as p",[role])).rows[0].p,false);
  }
  assert.equal((await db.query("select has_table_privilege('service_role','public.semantic_rule_authorities','INSERT') as p")).rows[0].p,false);
});
test('changed candidate basis cannot be approved',async()=>{
  await grant(); const rule=await propose();
  await db.query("update conversion_candidates set proposed_value='\"STATUS=OFFEN\"' where id=$1",[candidate]);
  await fails(()=>decide(rule),'PT409');
});
test('a changed Claim meaning cannot reuse the previously proposed rule basis',async()=>{
  await grant(); const rule=await propose();
  await db.query("update claims set statement='Changed assertion with another meaning' where id=$1",[claim]);
  await fails(()=>decide(rule),'PT409');
});
test('changed Claim evidence cannot reuse the previously proposed rule basis',async()=>{
  await grant(); const rule=await propose();
  await db.query(`insert into claim_evidence_links(claim_id,evidence_type,evidence_reference,relation,directness,linked_by)
    values($1,'SOURCE','fixture://changed-basis','QUALIFIES','DIRECT',$2)`,[claim,actor]);
  await fails(()=>decide(rule),'PT409');
});
test('new catalogue tables enforce RLS and RPCs never elevate to security definer',async()=>{
  const tables=(await db.query(`select relname,relrowsecurity from pg_class where relname in
    ('semantic_rule_authorities','semantic_rule_authority_revocations','semantic_rule_versions','semantic_rule_decisions')`)).rows;
  assert.equal(tables.length,4);assert.ok(tables.every(table=>table.relrowsecurity));
  const functions=(await db.query(`select proname,prosecdef,proconfig from pg_proc where proname in
    ('bridge_propose_semantic_rule','bridge_decide_semantic_rule')`)).rows;
  assert.equal(functions.length,2);assert.ok(functions.every(fn=>!fn.prosecdef&&fn.proconfig.some(setting=>setting.startsWith('search_path='))));
});
test('expired authority blocks approval',async()=>{
  const rule=await propose();
  await db.query(`insert into semantic_rule_authorities(id,user_id,record_id,snapshot_id,target_address,role_name,
    authority_reference,granted_by,granted_at,valid_until) values($1,$2,$3,$4,'fixture:case#STATUS','Expired fixture reviewer',
    'fixture://expired-delegation',$2,now()-interval '2 days',now()-interval '1 day')`,[authority,actor,record,snapshot]);
  await fails(()=>decide(rule),'PT403');
});
test('a documented authority revocation atomically revokes approved rules',async()=>{
  await grant(); const rule=await propose(); await decide(rule);
  await db.query(`insert into semantic_rule_authority_revocations(authority_id,revoked_by,reason)
    values($1,$2,'Fixture domain delegation explicitly withdrawn')`,[authority,otherActor]);
  assert.equal((await db.query('select bridge_semantic_rule_status($1) as s',[rule.id])).rows[0].s,'REVOKED');
  const event=(await db.query('select * from semantic_rule_decisions where rule_version_id=$1 order by sequence desc limit 1',[rule.id])).rows[0];
  assert.equal(event.actor_id,otherActor);assert.equal(event.source,'authority_revocation');
  const second=await propose();await fails(()=>decide(second),'PT403');
});
test('automatic authority events cannot be forged by a direct service insert',async()=>{
  await grant(); const rule=await propose();await decide(rule);
  await fails(()=>db.query(`insert into semantic_rule_decisions(rule_version_id,actor_id,authority_id,decision,reason,source)
    values($1,$2,$3,'REVOKED','Forged automatic authority event','authority_revocation')`,[rule.id,otherActor,authority]),'PT403');
});
test('a grant for a different target cannot approve the rule',async()=>{
  const rule=await propose();
  await db.query(`insert into semantic_rule_authorities(id,user_id,record_id,snapshot_id,target_address,role_name,
    authority_reference,granted_by,valid_until) values($1,$2,$3,$4,'fixture:case#MENGE','Other field reviewer',
    'fixture://other-field-delegation',$2,now()+interval '1 day')`,[authority,actor,record,snapshot]);
  await fails(()=>decide(rule),'PT403');
});
test('a no longer current snapshot cannot be approved',async()=>{
  await grant(); const rule=await propose(); const otherSnapshot=id(99);
  await db.query("insert into ingestion_logs values($1,'processed','new-hash','{}')",[otherSnapshot]);
  await db.query('update records set ingestion_log_id=$1 where id=$2',[otherSnapshot,record]);
  await fails(()=>decide(rule),'PT409');
});
test('only the latest revision is approvable and rules cannot escape their case scope',async()=>{
  await grant();const first=await propose();await propose(definition,first.id);
  await fails(()=>decide(first),'PT409');
  await fails(()=>db.query('select bridge_decide_semantic_rule($1,$2,$3,$4,$5,$6,$7)',
    [id(99),first.id,actor,authority,'APPROVED','Long explicit reason',JSON.stringify(criteria)]),'PT404');
});
test('malformed evidence cannot be stored as a rule proposal',async()=>{
  await fails(()=>propose({...definition,evidence:[{kind:'SOURCE',reference:'',summary:'Long enough summary'}]}),'PT400');
  await fails(()=>propose({...definition,evidence:[{kind:'GUESS',reference:'fixture://x',summary:'Long enough summary'}]}),'PT400');
});
test('duplicate approval and simultaneous approved versions are rejected',async()=>{
  await grant(); const first=await propose(); await decide(first);
  await fails(()=>decide(first),'PT409');
  const next=await propose(definition,first.id);
  await fails(()=>decide(next),'PT409');
  await decide(first,'SUPERSEDED'); await decide(next);
  assert.equal((await db.query('select bridge_semantic_rule_status($1) as s',[next.id])).rows[0].s,'APPROVED');
});
test('rule revocation changes bound Claim evidence and revokes release atomically',async()=>{
  await grant(); const rule=await propose(); await decide(rule);
  await db.query(`update claims set status='CONFIRMED',confirmed_by=$1,confirmed_at=now(),rule_id=$2,rule_version='1' where id=$3`,[actor,rule.rule_id,claim]);
  const basis=(await db.query('select bridge_claims_basis($1) as b',[record])).rows[0].b;
  const cert=(await db.query("insert into release_certificates(record_id,release_status,certified_by) values($1,'trusted',$2) returning id",[record,actor])).rows[0].id;
  await decide(rule,'REVOKED');
  assert.notEqual((await db.query('select bridge_claims_basis($1) as b',[record])).rows[0].b,basis);
  assert.equal((await db.query('select new_status from release_status_history where release_certificate_id=$1',[cert])).rows[0].new_status,'revoked');
  assert.equal((await db.query('select status from claims where id=$1',[claim])).rows[0].status,'CONFIRMED');
  await fails(()=>decide(rule),'PT409');
});
test('evidence-write failure rolls back the negative rule decision as well',async()=>{
  await grant(); const rule=await propose(); await decide(rule);
  await db.query("update claims set rule_id=$1,rule_version='1' where id=$2",[rule.rule_id,claim]);
  await db.exec(`create function fail_rule_evidence() returns trigger language plpgsql as $$ begin raise exception 'Injected evidence failure'; end $$;
    create trigger fail_rule_evidence before insert on claim_evidence_links for each row execute function fail_rule_evidence();`);
  await fails(()=>decide(rule,'REVOKED'),'P0001');
  assert.equal((await db.query('select bridge_semantic_rule_status($1) as s',[rule.id])).rows[0].s,'APPROVED');
});
