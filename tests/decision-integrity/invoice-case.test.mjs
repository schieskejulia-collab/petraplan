import { createInvoicePdfHandler } from '../../api/cases/[recordId]/invoice-pdf.js';
import { createInvoiceUploadHandler } from '../../api/bridge/invoice-upload.js';
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

async function approveInvoice(db, captured, checks = { ...criteria, delivery_period_evidence: "Local test service-period document" }) {
  const basis = (await db.query('select public.bridge_claims_basis($1) as basis', [recordId])).rows[0].basis;
  return (await review(db, { record: recordId, snapshot: captured.snapshot_id,
    validation: captured.validation_id, basis, criteria: checks })).rows[0].result;
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

  const authenticate = async () => ({ user: { id: ids.actor }, role: { can_review: true }, supabase: {
    async rpc(name, args) {
      assert.equal(name, 'bridge_capture_invoice_case');
      const artifact = { invoice: Buffer.from(args.p_invoice.slice(2), 'hex'),
        report: Buffer.from(args.p_report.slice(2), 'hex'), result: args.p_result,
        pdf: args.p_pdf ? Buffer.from(args.p_pdf.slice(2), 'hex') : null };
      try {
        return { data: await persistInvoiceCase(db, { recordId: args.p_record_id,
          expectedSnapshotId: args.p_expected_snapshot_id, actorId: args.p_actor_id }, artifact) };
      } catch (error) {
        return { error };
      }
    },
  } });
  const handleUpload = createInvoiceUploadHandler(authenticate);
  async function upload(bytes, caseId, expectedSnapshotId = null) {
    const request = { method: 'POST', body: { recordId: caseId, expectedSnapshotId, contentBase64: bytes.toString('base64') } };
    let status;
    let body;
    const response = { status(value) { status = value; return response; }, json(value) { body = value; } };
    await handleUpload(request, response);
    return { status, body };
  }
  const uploaded = await upload(original, recordId);
  assert.equal(uploaded.status, 201, JSON.stringify(uploaded.body));
  const initial = uploaded.body;
  // KoSIT report timestamps differ between runs. Audit the actual stored proof.
  const initialReport = Buffer.from((await db.query('select kosit_report from bridge_invoice_evidence where snapshot_id=$1', [initial.snapshot_id])).rows[0].kosit_report);
  assert.equal(initial.record_id, recordId);
  assert.equal(initial.status, 'READY_FOR_REVIEW');
  assert.equal((await activeRelease(db)).certificate_id, null);
  assert.ok(t0.result.technicalEvidence.messages.some(message => message.code === 'BR-DE-TMP-32'));
  await assert.rejects(approveInvoice(db, initial, criteria), /requires a delivery or service period evidence/);
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
    const storedReport = index === 0 ? initialReport : artifact.report;
    assert.deepEqual(Buffer.from(versions[index].kosit_report), storedReport);
    assert.equal(versions[index].evidence.report_sha256, digest(storedReport));
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
  assert.equal(snapshots[1].proof.reportSha256, digest(initialReport));
  assert.match(snapshots[1].payable.path, /PayableAmount/);
  assert.equal(buildInvoiceCaseSnapshots(viewRows, changed.snapshot_id, [])[0].proof, null);

  const storedRecord = (await db.query('select ingestion_log_id from records where id=$1', [recordId])).rows[0];
  assert.equal(storedRecord.ingestion_log_id, changed.snapshot_id);
  const cii = await upload(await readFile(join(fixtureDirectory, '01.01a-uncefact.xml')), id(181));
  assert.equal(cii.status, 201);
  assert.equal(cii.body.status, 'READY_FOR_REVIEW');
  assert.equal(cii.body.record_id, id(181));
  const wrongCase = await upload(original, ids.record, ids.snapshot);
  assert.equal(wrongCase.status, 409);
  const wrongNumber = original.toString().replace('123456XX', 'another-invoice');
  const wrongIdentity = await upload(Buffer.from(wrongNumber), recordId, changed.snapshot_id);
  assert.equal(wrongIdentity.status, 409);

  const corrected = await persistInvoiceCase(db, { ...actor, expectedSnapshotId: changed.snapshot_id }, t0);
  assert.equal(corrected.status, 'READY_FOR_REVIEW');
  assert.equal((await activeRelease(db)).effective_status, 'revoked');
  await assert.rejects(releaseInvoice(db, corrected, approval.review_session_id), /current validation and resolution/);
  const newApproval = await approveInvoice(db, corrected);
  const newCertificate = await releaseInvoice(db, corrected, newApproval.review_session_id);
  assert.notEqual(newCertificate.certificate_id, certificate.certificate_id);
  assert.equal((await activeRelease(db)).effective_status, 'trusted');

  const parallelVariant = Buffer.from(original.toString().replace('</cbc:PayableAmount>', '2</cbc:PayableAmount>'));
  const parallel = await Promise.all([upload(altered, recordId, corrected.snapshot_id),
    upload(parallelVariant, recordId, corrected.snapshot_id)]);
  assert.deepEqual(parallel.map(item => item.status).sort(), [201, 409]);
  const last = parallel.find(item => item.status === 201).body;
  assert.equal((await db.query('select ingestion_log_id from records where id=$1', [recordId])).rows[0].ingestion_log_id, last.snapshot_id);

  for (const [caseKey, variable, status, amounts] of [
    [191, 'PETRAPLAN_PDF_MISMATCH', 'DIFFERENT', ['530.87']],
    [192, 'PETRAPLAN_PDF_OUTSIDE_WINDOW', 'NOT_COMPARABLE', ['529.87', '530.87']],
    [193, 'PETRAPLAN_PDF_CONTROL', 'NEEDS_VISUAL_CONFIRMATION', ['529.87']],
  ]) {
    if (!process.env[variable]) continue;
    const originalPdf = await readFile(process.env[variable]);
    const pdfResult = await upload(originalPdf, id(caseKey));
    assert.equal(pdfResult.status, 201, JSON.stringify(pdfResult.body));
    assert.equal(pdfResult.body.status, 'BLOCKED');
    const saved = (await db.query(`select i.extracted_schema, e.original_pdf from bridge_invoice_evidence e
      join ingestion_logs i on i.id=e.snapshot_id where e.snapshot_id=$1`, [pdfResult.body.snapshot_id])).rows[0];
    assert.deepEqual(Buffer.from(saved.original_pdf), originalPdf);
    const comparison = saved.extracted_schema.pdfComparison;
    assert.equal(comparison.status, status);
    assert.deepEqual(comparison.candidates.map(item => item.amount).filter(Boolean).sort(), amounts);
    assert.equal(comparison.xmlPayable, '529.87');
    assert.equal(saved.extracted_schema.decision.releaseAllowed, false);
  }
});

test('matching PDF needs a separately entered visual amount before explicit release', {
  skip: !(process.env.PETRAPLAN_PDF_POSITIVE && config.jar && config.scenarios)
    && 'Requires local KoSIT and PDF wrapping an accepted CII fixture',
}, async t => {
  const [db, artifact] = await Promise.all([setup(t),
    inspectInvoiceFile(process.env.PETRAPLAN_PDF_POSITIVE, config)]);
  assert.equal(artifact.result.technicalEvidence.accepted, true);
  assert.equal(artifact.result.pdfComparison.status, 'NEEDS_VISUAL_CONFIRMATION');
  assert.equal(artifact.result.decision.status, 'READY_FOR_REVIEW');
  const captured = await persistInvoiceCase(db, actor, artifact);
  assert.equal((await activeRelease(db)).certificate_id, null);
  await assert.rejects(releaseInvoice(db, captured, null), /Review changed|review/i);

  const pdfResponse = async selectedRecord => {
    const stored = (await db.query(`select encode(e.original_pdf,'hex') as hex, i.extracted_schema
      from bridge_invoice_evidence e join ingestion_logs i on i.id=e.snapshot_id
      where e.snapshot_id=$1`, [captured.snapshot_id])).rows[0];
    const handler = createInvoicePdfHandler(async () => ({ supabase: { from() {
      const filters = {};
      const query = {
        select() { return query; },
        eq(key, value) { filters[key] = value; return query; },
        async maybeSingle() {
          return { data: filters.record_id === recordId && filters.snapshot_id === captured.snapshot_id
            ? { original_pdf: String.fromCharCode(92) + 'x' + stored.hex, ingestion: stored } : null };
        },
      };
      return query;
    } } }));
    let status, body;
    const response = { setHeader() {}, status(value) { status=value; return response; },
      send(value) { body=value; }, json(value) { body=value; } };
    await handler({ method:'GET', query:{recordId:selectedRecord,snapshotId:captured.snapshot_id} }, response);
    return { status, body };
  };
  assert.equal((await pdfResponse(ids.record)).status, 404);
  assert.deepEqual(await pdfResponse(recordId), { status:200, body:artifact.pdf });

  const context = { ...criteria, delivery_period_evidence: 'Local test service-period document',
    pdf_pages_checked:true, pdf_sha256:digest(artifact.pdf), pdf_xml_sha256:digest(artifact.invoice),
    pdf_visual_amount:'336,90', pdf_visual_currency:'EUR' };
  await assert.rejects(approveInvoice(db, captured), /PDF review requires/);
  await assert.rejects(approveInvoice(db, captured, { ...context, pdf_sha256: digest(artifact.invoice) }), /PDF review requires/);
  await assert.rejects(approveInvoice(db, captured, { ...context, pdf_visual_currency:'USD' }), /PDF review requires/);
  await assert.rejects(approveInvoice(db, captured, { ...context, pdf_visual_amount:'337,90' }), /differs/);
  const approval = await approveInvoice(db, captured, context);
  assert.equal((await activeRelease(db)).certificate_id, null);
  const audit = (await db.query('select details from bridge_decision_audit where review_decision_id=$1',
    [approval.review_decision_id])).rows[0].details;
  assert.equal(audit.criteria.pdf_sha256, digest(artifact.pdf));
  assert.equal(audit.criteria.pdf_xml_sha256, digest(artifact.invoice));
  await releaseInvoice(db, captured, approval.review_session_id);
  assert.equal((await activeRelease(db)).effective_status, 'trusted');

  const bytes = await readFile(process.env.PETRAPLAN_PDF_POSITIVE);
  const revised = await persistInvoiceCase(db, { ...actor, expectedSnapshotId: captured.snapshot_id }, {
    ...artifact, pdf: Buffer.concat([bytes, Buffer.from('\n')]),
    result: { ...artifact.result, pdfComparison: { ...artifact.result.pdfComparison,
      pdfSha256:digest(Buffer.concat([bytes, Buffer.from('\n')])) } },
  });
  assert.equal((await activeRelease(db)).effective_status, 'revoked');
  await assert.rejects(approveInvoice(db, revised, context), /PDF review requires/);
  await assert.rejects(releaseInvoice(db, captured, approval.review_session_id), /snapshot has changed/);
});
