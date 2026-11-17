import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { test } from 'node:test';
import { createInvoiceWorker } from '../../scripts/invoice-worker/server.mjs';
import {
  inspectViaWorker, InvoiceWorkerUnavailable, MAX_INVOICE_BYTES,
} from '../../scripts/invoice-worker/protocol.mjs';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const token = 'test-only-invoice-worker';
const config = { token, jar: 'fixture.jar', scenarios: 'fixture.xml' };
const invoice = Buffer.from('<Invoice/>');
const report = Buffer.from('<Report/>');

function proof(source) {
  return { invoice: source, report, result: {
    sourceSha256: digest(source),
    technicalEvidence: { invoiceSha256: digest(source), reportSha256: digest(report) },
  } };
}

async function start(t, options) {
  const worker = createInvoiceWorker({ ...config, ...options });
  worker.listen(0, '127.0.0.1');
  await once(worker, 'listening');
  t.after(() => new Promise((resolve, reject) => worker.close(error => error ? reject(error) : resolve())));
  return `http://127.0.0.1:${worker.address().port}`;
}

test('worker authenticates requests before reading original documents', async t => {
  let calls = 0;
  const origin = await start(t, { inspect: async bytes => { calls++; return proof(bytes); } });
  assert.equal((await fetch(origin + '/health')).status, 200);
  const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/octet-stream' };
  assert.equal((await fetch(origin + '/v1/inspect', { method: 'POST', body: invoice,
    headers: { ...headers, authorization: 'Bearer wrong-token' } })).status, 401);
  assert.equal((await fetch(origin + '/v1/inspect', { method: 'POST', headers,
    body: Buffer.from('%PDF-1.4') })).status, 415);
  assert.equal((await fetch(origin + '/v1/inspect', { method: 'POST', headers,
    body: Buffer.alloc(MAX_INVOICE_BYTES + 1) })).status, 413);
  assert.equal(calls, 0);
  assert.deepEqual(await inspectViaWorker(invoice, { origin, token }), { ...proof(invoice), pdf: null });
  assert.equal(calls, 1);
});

test('worker client requires a proof bound to the submitted original and returned report', async t => {
  const wrongOriginal = await start(t, { inspect: async () => proof(Buffer.from('<OtherInvoice/>')) });
  await assert.rejects(inspectViaWorker(invoice, { origin: wrongOriginal, token }), InvoiceWorkerUnavailable);
  const wrongReport = await start(t, { inspect: async bytes => ({ ...proof(bytes), report: Buffer.from('<OtherReport/>') }) });
  await assert.rejects(inspectViaWorker(invoice, { origin: wrongReport, token }), InvoiceWorkerUnavailable);
  await assert.rejects(inspectViaWorker(invoice, { origin: 'http://invoice.example', token },
    async () => assert.fail('Remote HTTP request must not be sent')), InvoiceWorkerUnavailable);
});
