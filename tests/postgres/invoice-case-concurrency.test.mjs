import { before, beforeEach, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { setTimeout as pause } from 'node:timers/promises';
import pg from 'pg';
import { installInvoiceCaseFixture } from '../decision-integrity/invoice-case-fixture.mjs';
import { criteria, id, ids, review } from '../decision-integrity/atomic-review-fixture.mjs';
import { persistInvoiceCase } from '../../scripts/capture-invoice-case.mjs';

const databaseUrl = new URL(process.env.PETRAPLAN_TEST_DATABASE_URL ?? 'invalid:');
if (!['localhost', '127.0.0.1', '[::1]'].includes(databaseUrl.hostname)
  || databaseUrl.pathname !== '/petraplan_test') {
  throw new Error('Invoice races require the explicit local petraplan_test database.');
}
const pool = new pg.Pool({ connectionString: databaseUrl.href, max: 6, statement_timeout: 15000 });
const db = { query: (...args) => pool.query(...args), exec: sql => pool.query(sql) };
const adapt = client => ({ query: (...args) => client.query(...args), exec: sql => client.query(sql) });
const recordId = id(177);
const actor = { recordId, actorId: ids.actor };
let original;

// Synthetic worker artifacts isolate transaction ordering from the KoSIT
// process. XML/PDF validation and HTTP intake have their own integration tests.
function artifact(revision, accepted) {
  const invoice = Buffer.from(`<Invoice revision="${revision}"/>`);
  const report = Buffer.from(`<Report revision="${revision}"/>`);
  const hash = bytes => createHash('sha256').update(bytes).digest('hex');
  return {
    invoice, report,
    result: {
      contract: 'en16931-invoice-v1', syntax: 'UBL', sourceSha256: hash(invoice),
      fields: {
        'BT-1': { status: 'observed', values: [{ original: 'CONCURRENT-INV-1' }] },
        'BT-27': { status: 'observed', values: [{ original: 'Concurrent test supplier' }] },
      },
      technicalEvidence: {
        invoiceSha256: hash(invoice), reportSha256: hash(report),
        accepted, validatorDecision: accepted ? 'accept' : 'reject', messages: [],
      },
      decision: { status: accepted ? 'READY_FOR_REVIEW' : 'BLOCKED',
        releaseAllowed: false, blockers: accepted ? [] : ['KOSIT_NOT_ACCEPTED'] },
    },
  };
}

before(async () => {
  assert.match((await db.query('show server_version')).rows[0].server_version, /^17\./);
});
beforeEach(async () => {
  await db.exec('drop schema public cascade; drop schema if exists auth cascade; drop schema if exists extensions cascade; create schema public;');
  await installInvoiceCaseFixture(db);
  original = await persistInvoiceCase(db, actor, artifact('original', true));
  const basis = (await db.query('select public.bridge_claims_basis($1) basis', [recordId])).rows[0].basis;
  const approval = (await review(db, { record: recordId, snapshot: original.snapshot_id,
    validation: original.validation_id, basis, criteria })).rows[0].result;
  await db.query('select public.bridge_release_case($1,$2,$3,$4,$5,$6)',
    [recordId, original.snapshot_id, original.validation_id, approval.review_session_id, ids.actor,
      'Explicit concurrency fixture release']);
});
after(() => pool.end());

async function waitForCaseLock(pid) {
  const deadline = Date.now() + 7000;
  while (Date.now() < deadline) {
    const activity = (await db.query(
      'select wait_event_type from pg_stat_activity where pid=$1', [pid],
    )).rows[0];
    if (activity?.wait_event_type === 'Lock') return;
    await pause(20);
  }
  throw new Error('Second invoice connection did not wait on the transaction lock.');
}

async function race(firstArtifact, secondArtifact, finish = 'commit') {
  const first = await pool.connect();
  const second = await pool.connect();
  let waiting;
  try {
    await first.query('set role service_role');
    await second.query('set role service_role');
    await first.query('begin');
    const revisedActor = { ...actor, expectedSnapshotId: original.snapshot_id };
    const firstResult = await persistInvoiceCase(adapt(first), revisedActor, firstArtifact);
    const pid = (await second.query('select pg_backend_pid() pid')).rows[0].pid;
    assert.notEqual(pid, (await first.query('select pg_backend_pid() pid')).rows[0].pid);
    waiting = persistInvoiceCase(adapt(second), revisedActor, secondArtifact)
      .then(value => ({ value }), error => ({ error }));
    await waitForCaseLock(pid);
    await first.query(finish);
    return { first: firstResult, second: await waiting };
  } finally {
    await first.query('rollback').catch(() => {});
    if (waiting) await waiting;
    await first.query('reset role').catch(() => {});
    await second.query('reset role').catch(() => {});
    first.release();
    second.release();
  }
}

async function assertCommittedRevision(snapshotId, count = 2) {
  assert.equal((await db.query('select ingestion_log_id from records where id=$1', [recordId])).rows[0].ingestion_log_id, snapshotId);
  assert.equal((await db.query('select count(*)::int n from bridge_invoice_evidence where record_id=$1', [recordId])).rows[0].n, count);
  assert.equal((await db.query('select count(*)::int n from bridge_decision_audit where record_id=$1 and action=\'revoke\'', [recordId])).rows[0].n, 1);
  assert.equal((await db.query('select public.bridge_current_release($1) result', [recordId])).rows[0].result.effective_status, 'revoked');
}

test('separate connections cannot commit different revisions of the same invoice basis', async () => {
  const outcome = await race(artifact('revision-a', false), artifact('revision-b', false));
  assert.equal(outcome.second.error?.code, 'PT409');
  assert.match(outcome.second.error.message, /snapshot changed/);
  await assertCommittedRevision(outcome.first.snapshot_id);
  const snapshots = (await db.query(`select i.source_hash from bridge_invoice_evidence e
    join ingestion_logs i on i.id=e.snapshot_id where e.record_id=$1`, [recordId])).rows;
  assert.ok(!snapshots.some(row => row.source_hash === artifact('revision-b', false).result.sourceSha256));
});

test('separate connections reuse an identical committed invoice revision and revoke once', async () => {
  const revised = artifact('same-revision', false);
  const outcome = await race(revised, revised);
  assert.equal(outcome.second.error, undefined);
  assert.equal(outcome.second.value.reused, true);
  assert.equal(outcome.second.value.snapshot_id, outcome.first.snapshot_id);
  await assertCommittedRevision(outcome.first.snapshot_id);
});

test('a rolled-back revision leaves the waiting connection a usable original basis', async () => {
  const outcome = await race(artifact('rolled-back', false), artifact('committed', false), 'rollback');
  assert.equal(outcome.second.error, undefined);
  assert.equal(outcome.second.value.reused, false);
  await assertCommittedRevision(outcome.second.value.snapshot_id);
  assert.equal((await db.query('select count(*)::int n from ingestion_logs where id=$1',
    [outcome.first.snapshot_id])).rows[0].n, 0);
  const revocation = (await db.query("select validation_result_id from bridge_decision_audit where record_id=$1 and action='revoke'", [recordId])).rows[0];
  assert.equal(revocation.validation_result_id, outcome.second.value.validation_id);
});
