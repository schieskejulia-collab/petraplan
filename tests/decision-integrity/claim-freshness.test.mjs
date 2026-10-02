import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { before, beforeEach, afterEach, after, test } from 'node:test';
import assert from 'node:assert/strict';

const db = new PGlite();
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const [record, snapshot, actor, candidate, address, conflict, resolution, validation, review, session, decision, structure, criterion] =
  Array.from({ length: 13 }, (_, i) => id(i + 1));
const read = path => readFile(new URL(path, import.meta.url), 'utf8');
const migrations = [
  '20260927222002_chinch64_decision_integrity',
  '20260927222450_chinch64_existing_basis_guard',
  '20260928123500_chinch64_revoked_release_terminal',
  '20261002120000_chinch64_claim_freshness_guard',
];

before(async () => {
  await db.exec(await read('./schema.sql'));
  await db.exec(`create schema auth;
    create table auth.users (id uuid primary key);
    alter table release_certificates alter column certified_by type text using certified_by::text;
    alter table release_status_history alter column changed_by type text using changed_by::text;
    alter table release_status_history alter column changed_by set not null;
    alter table bridge_actor_roles add constraint bridge_actor_roles_user_id_fkey
      foreign key (user_id) references auth.users(id);
    alter table bridge_decision_audit alter column actor_user_id set not null;
    alter table bridge_decision_audit add constraint bridge_decision_audit_actor_user_id_fkey
      foreign key (actor_user_id) references auth.users(id);`);
  await db.exec((await read('../../db/address_layer.sql')).replace('create extension if not exists pgcrypto;', ''));
  await db.exec((await read('../../db/claim_layer.sql')).replace('create extension if not exists pgcrypto;', ''));
  for (const name of migrations) await db.exec(await read(`../../supabase/migrations/${name}.sql`));
  await db.exec('grant all on all tables in schema public to service_role');
});
beforeEach(async () => {
  await db.exec('begin');
  await db.query(`insert into ingestion_logs values ($1,'processed','source-hash','{"untouched":true}')`, [snapshot]);
  await db.query('insert into records values ($1,$2)', [record, snapshot]);
  await db.query('insert into auth.users values ($1)', [actor]);
  await db.query('insert into bridge_actor_roles values ($1,true,true,true)', [actor]);
  await db.query(`insert into address_registry
    (id,source_id,first_snapshot_id,first_record_id,address,kind,source_path,registered_at)
    values ($1,'northwind',$2,$3,'order.STATUS','field','order.ShippedDate',now())`,
    [address, snapshot, record]);
  await db.query(`insert into conversion_candidates
    (id,candidate_key,record_id,snapshot_id,source_address_id,source_path,conversion_kind,evidence,state,created_at)
    values ($1,'STATUS-DERIVATION',$2,$3,$4,'order.ShippedDate','derive','test evidence','candidate',now())`,
    [candidate, record, snapshot, address]);
  await db.query('insert into conflicts values ($1,$2)', [conflict, record]);
  await db.query('insert into resolution_records values ($1,$2)', [resolution, conflict]);
  await db.query(`insert into validation_results (id,conflict_id,resolution_record_id,status,created_at)
    values ($1,$2,$3,'passed','2026-09-01T00:00:00Z')`, [validation, conflict, resolution]);
  await db.query('insert into review_records values ($1,$2,$3)', [review, resolution, validation]);
  await db.query('insert into review_sessions (id,review_record_id,structure_id,validation_result_id) values ($1,$2,$3,$4)',
    [session, review, structure, validation]);
  const emptyBasis = await basis();
  await db.query(`insert into review_decisions
    (id,review_session_id,decision,final,reviewer_authorized,reviewer_id,authorization_level,
     evidence_checked,criteria_checked,reason,decided_at,validation_result_id,evidence_refs)
    values ($1,$2,'approved',true,true,$3,'reviewer',true,true,'Reviewed evidence',now(),$4,$5)`,
    [decision, session, actor, validation, [`ingestion:${snapshot}`, `validation:${validation}`, `claims:${emptyBasis}`]]);
  await db.query('insert into review_criteria values ($1,$2,true)', [criterion, structure]);
  await db.query('insert into review_criterion_results (review_session_id,criterion_id,passed) values ($1,$2,true)',
    [session, criterion]);
});
afterEach(() => db.exec('rollback'));
after(() => db.close());

const release = (validationId = validation, sessionId = session) => db.query('select bridge_release_case($1,$2,$3,$4,$5,$6) as result',
  [record, snapshot, validationId, sessionId, actor, 'Explicit test release']);
const basis = async () => (await db.query('select bridge_claims_basis($1) as b', [record])).rows[0].b;
const claimIsAfter = async validationId => (await db.query(
  'select bridge_claims_after_validation($1,$2) as stale', [record, validationId])).rows[0].stale;
const rejectCandidate = () => db.query('select bridge_decide_candidate($1,$2,$3,$4,$5,$6,$7)',
  [record, candidate, snapshot, actor, 'rejected', 'Explicit test decision', null]);
const addClaim = async (createdAt = '2026-09-02T00:00:00Z', createdBy = actor) => (await db.query(`insert into claims
  (claim_family_id,claim_type,subject_address,predicate,statement,status,scope_type,record_id,snapshot_id,created_by,created_at)
  values (gen_random_uuid(),'SEMANTIC_MAPPING','order.STATUS','means','Initial claim','UNPROVEN','CASE_ONLY',$1,$2,$3,$4)
  returning id`, [record, snapshot, createdBy, createdAt])).rows[0].id;
const addEvidence = claimId => db.query(`insert into claim_evidence_links
  (claim_id,evidence_type,evidence_reference,relation,directness,linked_by)
  values ($1,'SOURCE_SNAPSHOT',$2,'SUPPORTS','DIRECT',$3) returning id`, [claimId, snapshot, actor]);
async function reviewedBasis() {
  const current = await basis();
  await db.query('update review_decisions set evidence_refs = evidence_refs || $2::text[] where id=$1',
    [decision, [`claims:${current}`]]);
  return current;
}
async function addValidationAndReview(claimsBasis) {
  const newValidation = id(80), newReview = id(81), newSession = id(82), newDecision = id(83);
  await db.query(`insert into validation_results (id,conflict_id,resolution_record_id,status,created_at)
    values ($1,$2,$3,'passed','2026-09-03T00:00:00Z')`, [newValidation, conflict, resolution]);
  await db.query('insert into review_records values ($1,$2,$3)', [newReview, resolution, newValidation]);
  await db.query('insert into review_sessions (id,review_record_id,structure_id,validation_result_id) values ($1,$2,$3,$4)',
    [newSession, newReview, structure, newValidation]);
  await db.query(`insert into review_decisions
    (id,review_session_id,decision,final,reviewer_authorized,reviewer_id,authorization_level,
     evidence_checked,criteria_checked,reason,decided_at,validation_result_id,evidence_refs)
    values ($1,$2,'approved',true,true,$3,'reviewer',true,true,'Revalidated and reviewed',now(),$4,$5)`,
    [newDecision, newSession, actor, newValidation,
      [`ingestion:${snapshot}`, `validation:${newValidation}`, `claims:${claimsBasis}`]]);
  await db.query('insert into review_criterion_results (review_session_id,criterion_id,passed) values ($1,$2,true)',
    [newSession, criterion]);
  return { validationId: newValidation, sessionId: newSession };
}
async function fails(fn, code) {
  await db.exec('savepoint expected_failure');
  await assert.rejects(fn, e => e.code === code);
  await db.exec('rollback to expected_failure');
}
const status = async cert => (await db.query(`select new_status from release_status_history
  where release_certificate_id=$1 order by created_at desc,id desc limit 1`, [cert])).rows[0].new_status;

test('claim arriving after review blocks release', async () => {
  await rejectCandidate();
  await addClaim();
  await fails(release, 'PT409');
});

test('claim revocation helper is callable by service role but not API client roles', async () => {
  const result = await db.query(`select
    has_function_privilege('anon', 'public.bridge_revoke_release_for_claim_change(uuid,uuid,text,text)', 'EXECUTE') as anon,
    has_function_privilege('authenticated', 'public.bridge_revoke_release_for_claim_change(uuid,uuid,text,text)', 'EXECUTE') as authenticated,
    has_function_privilege('service_role', 'public.bridge_revoke_release_for_claim_change(uuid,uuid,text,text)', 'EXECUTE') as service`);
  assert.deepEqual(result.rows[0], { anon: false, authenticated: false, service: true });
});

test('claim created after validation cannot be laundered into an approved review fingerprint', async () => {
  await rejectCandidate();
  const claimId = await addClaim();
  await addEvidence(claimId);
  await fails(reviewedBasis, 'PT409');
  assert.equal(await claimIsAfter(validation), true);
  await fails(release, 'PT409');
});

test('database refuses an approved review if a claim arrived after its validation', async () => {
  const claimId = await addClaim();
  await addEvidence(claimId);
  const current = await basis();
  await fails(() => db.query(`insert into review_decisions
    (id,review_session_id,decision,final,reviewer_authorized,reviewer_id,authorization_level,
     evidence_checked,criteria_checked,reason,decided_at,validation_result_id,evidence_refs)
    values ($1,$2,'approved',true,true,$3,'reviewer',true,true,'Reviewed current claim',now(),$4,$5)`,
    [id(90), session, actor, validation,
      [`ingestion:${snapshot}`, `validation:${validation}`, `claims:${current}`]]), 'PT409');
});

test('a claim created before validation is accepted by a later reviewed validation basis', async () => {
  await rejectCandidate();
  const claimId = await addClaim('2026-08-31T00:00:00Z');
  await addEvidence(claimId);
  const current = await reviewedBasis();
  assert.equal(await claimIsAfter(validation), false);
  const { validationId, sessionId } = await addValidationAndReview(current);
  assert.equal(await claimIsAfter(validationId), false);
  const cert = (await release(validationId, sessionId)).rows[0].result.certificate_id;
  const stored = (await db.query("select truth_snapshot->>'claims_basis' as b from release_certificates where id=$1",
    [cert])).rows[0].b;
  assert.equal(stored, current);
});

test('change in claim statement after review changes basis and blocks release', async () => {
  await rejectCandidate();
  const claimId = await addClaim('2026-08-31T00:00:00Z');
  const previous = await reviewedBasis();
  await db.query("update claims set statement='Changed assertion' where id=$1", [claimId]);
  assert.notEqual(await basis(), previous);
  await fails(release, 'PT409');
});

test('evidence link added after review changes basis and blocks release', async () => {
  await rejectCandidate();
  const claimId = await addClaim('2026-08-31T00:00:00Z');
  const previous = await reviewedBasis();
  await addEvidence(claimId);
  assert.notEqual(await basis(), previous);
  await fails(release, 'PT409');
});

test('claim status change and evidence edit revoke an existing release', async () => {
  await rejectCandidate();
  const claimId = await addClaim('2026-08-31T00:00:00Z');
  const link = (await addEvidence(claimId)).rows[0].id;
  await reviewedBasis();
  const cert = (await release()).rows[0].result.certificate_id;
  await db.query("update claim_evidence_links set note='New evidence detail' where id=$1", [link]);
  assert.equal(await status(cert), 'revoked');
  await db.query("update claims set status='CONTESTED' where id=$1", [claimId]);
  await fails(release, 'PT409');
  const audits = (await db.query(`select count(*)::int as n from bridge_decision_audit
    where action='revoke' and release_certificate_id=$1`, [cert])).rows[0].n;
  assert.equal(audits, 1);
});

test('a system-produced claim revokes the release with a valid audit actor', async () => {
  await rejectCandidate();
  const cert = (await release()).rows[0].result.certificate_id;
  await addClaim('2026-09-02T00:00:00Z', 'claim-pipeline');
  assert.equal(await status(cert), 'revoked');
  const history = (await db.query(`select changed_by from release_status_history
    where release_certificate_id=$1 and new_status='revoked'`, [cert])).rows[0];
  assert.equal(history.changed_by, 'claim_freshness_invalidation');
  const audit = (await db.query(`select actor_user_id,details from bridge_decision_audit
    where release_certificate_id=$1 and action='revoke'`, [cert])).rows[0];
  assert.equal(audit.actor_user_id, actor);
  assert.equal(audit.details.claim_producer, 'claim-pipeline');
});

test('a legacy system certificate has an automatic audit event without a made-up user', async () => {
  await rejectCandidate();
  const cert = (await release()).rows[0].result.certificate_id;
  await db.query("update release_certificates set certified_by='legacy-system' where id=$1", [cert]);
  await addClaim('2026-09-02T00:00:00Z', 'claim-pipeline');
  assert.equal(await status(cert), 'revoked');
  const logs = (await db.query(`select count(*)::int as n from release_logs
    where release_certificate_id=$1 and event_type='revoked'`, [cert])).rows[0].n;
  const audits = (await db.query(`select actor_user_id,details from bridge_decision_audit
    where release_certificate_id=$1 and action='revoke'`, [cert])).rows;
  assert.equal(logs, 1);
  assert.equal(audits.length, 1);
  assert.equal(audits[0].actor_user_id, null);
  assert.equal(audits[0].details.automatic, true);
});

test('audit failure rolls back new claim and revocation together', async () => {
  await rejectCandidate();
  const cert = (await release()).rows[0].result.certificate_id;
  await db.exec(`create function fail_audit() returns trigger language plpgsql as $$
    begin raise exception 'forced audit failure'; end $$;
    create trigger fail_audit before insert on bridge_decision_audit
    for each row execute function fail_audit();`);
  await fails(addClaim, 'P0001');
  assert.equal((await db.query('select count(*)::int as n from claims')).rows[0].n, 0);
  assert.equal(await status(cert), 'trusted');
});

test('a case without claims has an explicit empty basis and still releases', async () => {
  await rejectCandidate();
  const cert = (await release()).rows[0].result.certificate_id;
  assert.match(await basis(), /^[0-9a-f]{64}$/);
  assert.equal(await status(cert), 'trusted');
});
