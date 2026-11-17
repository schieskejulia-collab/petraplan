import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { inspectInvoiceFile, persistInvoiceCase } from '../../scripts/capture-invoice-case.mjs';
import { criteria, id, ids, read, review, seedAtomicReviewFixture } from './atomic-review-fixture.mjs';
import { installTrustedEvidenceFixture } from './trusted-evidence-fixture.mjs';
import { buildInvoiceCaseSnapshots } from '../../api-server/src/services/invoiceCaseRead.ts';

const recordId = id(177);
const actor = { recordId, actorId: ids.actor };
const digest = data => createHash('sha256').update(data).digest('hex');

async function setup(t) {
  const db = new PGlite();
  t.after(() => db.close());
  await installTrustedEvidenceFixture(db);
  const releaseMigration = await read('../../supabase/migrations/20261002141136_chinch64_claim_freshness_guard.sql');
  // The rest of this older migration is already represented in the observed
  // fixture. Install the release RPC without replaying its schema changes.
  const releaseStart = releaseMigration.indexOf('create or replace function public.bridge_release_case(');
  assert.ok(releaseStart >= 0);
  await db.exec(releaseMigration.slice(releaseStart));
  // The observed review fixture omits resolution actions. Mirror the columns
  // used by the existing ingest writer and keep its foreign key to conflicts.
  await db.exec(`create table public.resolution_actions (
    id uuid primary key default gen_random_uuid(), conflict_id uuid not null references public.conflicts(id),
    action_type text not null, action_payload jsonb not null, actor_type text not null,
    actor_id text not null, reason text not null
  ); grant all on public.resolution_actions to service_role;`);
  await db.exec(await read('../../supabase/migrations/20261117100000_invoice_case_evidence.sql'));
  const observed = JSON.parse(await read('../../docs/verification/2026-10-26-original-schema-observations.json'));
  const truthGate = observed.triggers.find(trigger => trigger.function === 'enforce_release_truth_gate');
  await db.exec(`create schema extensions;
    create function extensions.digest(value text, algorithm text) returns bytea
    language sql immutable as 'select sha256(convert_to(value, ''UTF8''))';
    grant usage on schema extensions to service_role;`);
  await db.exec(truthGate.body);
  await db.exec(truthGate.definition);
  await seedAtomicReviewFixture(db);
  await db.exec('set role service_role');
  return db;
}

const activeRelease = async db => (await db.query(
  'select public.bridge_current_release($1) as result', [recordId],
)).rows[0].result;

async function approveInvoice(db, captured) {
  const basis = (await db.query('select public.bridge_claims_basis($1) as basis', [recordId])).rows[0].basis;
  return (await review(db, { record: recordId, snapshot: captured.snapshot_id,
    validation: captured.validation_id, basis, criteria })).rows[0].result;
}

const releaseInvoice = async (db, captured, sessionId) => (await db.query(
  'select public.bridge_release_case($1,$2,$3,$4,$5,$6) as result',
  [recordId, captured.snapshot_id, captured.validation_id, sessionId, ids.actor, 'Explicit test release'],
)).rows[0].result;

const fixtureDirectory = process.env.PETRAPLAN_INVOICE_FIXTURES;
const config = { jar: process.env.PETRAPLAN_KOSIT_JAR, scenarios: process.env.PETRAPLAN_KOSIT_SCENARIOS };

test('invoice capture rejects callers and artifacts outside its trust boundary', async t => {
  const db = await setup(t);
  const invoice = Buffer.from('<invoice/>');
  const report = Buffer.from('<report/>');
  const result = { contract: 'en16931-invoice-v1', syntax: 'UBL', fields: {}, sourceSha256: digest(invoice),
    technicalEvidence: { invoiceSha256: digest(invoice), reportSha256: '0'.repeat(64), accepted: false },
    decision: { status: 'BLOCKED', releaseAllowed: false } };
  const artifact = { invoice, report, result };
  await db.exec('set role authenticated');
  await assert.rejects(persistInvoiceCase(db, actor, artifact), { code: '42501' });
  await db.exec('set role service_role');
  await assert.rejects(persistInvoiceCase(db, actor, artifact), /byte hashes/);
  assert.equal((await db.query('select id from records where id=$1', [recordId])).rows.length, 0);
});

test('real invoice validation, review, release and atomic revocation preserve both source versions', {
  skip: !(fixtureDirectory && config.jar && config.scenarios) && 'Requires local KoSIT and original UBL fixture',
}, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'petraplan-case-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const originalFile = join(fixtureDirectory, '01.01a.xml');
  const original = await readFile(originalFile);
  const altered = Buffer.from(original.toString().replace('</cbc:PayableAmount>', '1</cbc:PayableAmount>'));
  assert.notDeepEqual(altered, original);
  const alteredFile = join(directory, 'altered.xml');
  await writeFile(alteredFile, altered);
  const [db, t0, t1, retry] = await Promise.all([
    setup(t), inspectInvoiceFile(originalFile, config), inspectInvoiceFile(alteredFile, config),
    inspectInvoiceFile(originalFile, config),
  ]);

  const initial = await persistInvoiceCase(db, actor, t0);
  assert.equal(initial.status, 'READY_FOR_REVIEW');
  assert.equal((await activeRelease(db)).certificate_id, null);
  const approval = await approveInvoice(db, initial);
  const certificate = await releaseInvoice(db, initial, approval.review_session_id);
  assert.equal((await activeRelease(db)).effective_status, 'trusted');
  const repeated = await persistInvoiceCase(db, actor, retry);
  assert.equal(repeated.snapshot_id, initial.snapshot_id);
  assert.equal(repeated.reused, true);
  assert.equal((await activeRelease(db)).effective_status, 'trusted');

  await assert.rejects(persistInvoiceCase(db, actor, t1), /snapshot changed/);
  const revision = { ...actor, expectedSnapshotId: initial.snapshot_id };
  await db.query('update bridge_actor_roles set can_revoke=false where user_id=$1', [ids.actor]);
  await assert.rejects(persistInvoiceCase(db, revision, t1), /Revocation permission required/);
  assert.equal((await activeRelease(db)).effective_status, 'trusted');
  assert.equal((await db.query('select snapshot_id from bridge_invoice_evidence')).rows.length, 1);
  await db.query('update bridge_actor_roles set can_revoke=true where user_id=$1', [ids.actor]);

  const changed = await persistInvoiceCase(db, revision, t1);
  assert.equal(changed.status, 'BLOCKED');
  assert.equal(changed.revocation.certificateId, certificate.certificate_id);
  assert.equal(changed.revocation.effectiveStatus, 'revoked');
  assert.equal((await activeRelease(db)).effective_status, 'revoked');
  await assert.rejects(approveInvoice(db, changed), /passing validation/);
  await assert.rejects(releaseInvoice(db, initial, approval.review_session_id), /snapshot has changed/);
  assert.equal((await persistInvoiceCase(db, revision, t1)).reused, true);
  await assert.rejects(db.query('update bridge_invoice_evidence set invoice_xml=$1', [t1.invoice]), { code: '42501' });
  const versions = (await db.query(`select e.previous_snapshot_id, e.invoice_xml, e.kosit_report, v.status, v.evidence
    from bridge_invoice_evidence e join validation_results v on v.id=e.validation_id order by e.created_at`)).rows;
  assert.equal(versions.length, 2);
  assert.deepEqual(versions.map(v => v.status), ['passed', 'failed']);
  assert.equal(versions[1].previous_snapshot_id, initial.snapshot_id);
  for (const [index, artifact] of [t0, t1].entries()) {
    assert.deepEqual(Buffer.from(versions[index].invoice_xml), artifact.invoice);
    assert.deepEqual(Buffer.from(versions[index].kosit_report), artifact.report);
    assert.equal(versions[index].evidence.report_sha256, digest(artifact.report));
  }
  assert.deepEqual((await db.query(`select new_status from release_status_history
    where release_certificate_id=$1 order by created_at`, [certificate.certificate_id])).rows.map(row => row.new_status),
  ['trusted', 'revoked']);
  const audit = (await db.query("select validation_result_id from bridge_decision_audit where record_id=$1 and action='revoke'", [recordId])).rows;
  assert.deepEqual(audit, [{ validation_result_id: changed.validation_id }]);

  const viewRows = (await db.query(`select e.snapshot_id, e.validation_id, e.created_at::text,
    jsonb_build_object('source_hash', i.source_hash, 'extracted_schema', i.extracted_schema) ingestion
    from bridge_invoice_evidence e join ingestion_logs i on i.id=e.snapshot_id
    order by e.created_at desc`)).rows;
  const validations = (await db.query('select id, evidence from validation_results')).rows;
  const snapshots = buildInvoiceCaseSnapshots(viewRows, changed.snapshot_id, validations);
  assert.deepEqual(snapshots.map(snapshot => snapshot.current), [true, false]);
  assert.deepEqual(snapshots.map(snapshot => snapshot.proof.accepted), [false, true]);
  assert.ok(snapshots[0].proof.messages.some(message => message.code === 'BR-CO-16'));
  assert.equal(snapshots[1].proof.reportSha256, digest(t0.report));
  assert.match(snapshots[1].payable.path, /PayableAmount/);
  assert.equal(buildInvoiceCaseSnapshots(viewRows, changed.snapshot_id, [])[0].proof, null);

  const corrected = await persistInvoiceCase(db, { ...actor, expectedSnapshotId: changed.snapshot_id }, t0);
  assert.equal(corrected.status, 'READY_FOR_REVIEW');
  assert.equal((await activeRelease(db)).effective_status, 'revoked');
  await assert.rejects(releaseInvoice(db, corrected, approval.review_session_id), /current validation and resolution/);
  const newApproval = await approveInvoice(db, corrected);
  const newCertificate = await releaseInvoice(db, corrected, newApproval.review_session_id);
  assert.notEqual(newCertificate.certificate_id, certificate.certificate_id);
  assert.equal((await activeRelease(db)).effective_status, 'trusted');
});
