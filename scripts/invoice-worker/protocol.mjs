import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inspectInvoiceFile, InvoiceUploadError } from '../capture-invoice-case.mjs';

export const MAX_INVOICE_BYTES = 8 * 1024 * 1024;
const MAX_REPORT_BYTES = 32 * 1024 * 1024;
export const MAX_WORKER_RESPONSE_BYTES = 96 * 1024 * 1024;
export const WORKER_TIMEOUT_MS = 245_000;

export class BodyLimitError extends Error {}
export class InvoiceWorkerUnavailable extends Error {
  constructor() {
    super('Rechnungsprüfung ist in dieser Umgebung nicht verfügbar.');
  }
}

export async function readBounded(body, limit) {
  if (!body) return Buffer.alloc(0);
  const chunks = [];
  let size = 0;
  for await (const chunk of body) {
    size += chunk.length;
    if (size > limit) throw new BodyLimitError();
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, size);
}

export const isPdf = bytes => bytes.subarray(0, 5).toString() === '%PDF-';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

export async function inspectInvoiceBytes(bytes, config) {
  const directory = await mkdtemp(join(tmpdir(), 'petraplan-upload-'));
  try {
    const file = join(directory, 'invoice');
    await writeFile(file, bytes);
    return await inspectInvoiceFile(file, config);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function decode(value, limit) {
  if (typeof value !== 'string' || value.length > Math.ceil(limit / 3) * 4) throw new InvoiceWorkerUnavailable();
  const bytes = Buffer.from(value, 'base64');
  if (!bytes.length || bytes.length > limit || bytes.toString('base64') !== value) throw new InvoiceWorkerUnavailable();
  return bytes;
}

function workerEndpoint(origin) {
  const url = new URL(origin);
  const local = ['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname);
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/'
    || !(url.protocol === 'https:' || (local && url.protocol === 'http:'))) throw new InvoiceWorkerUnavailable();
  return new URL('/v1/inspect', url);
}

export async function inspectViaWorker(bytes, { origin, token }, request = fetch) {
  if (!token) throw new InvoiceWorkerUnavailable();
  try {
    const response = await request(workerEndpoint(origin), {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/octet-stream' },
      body: bytes,
      redirect: 'error',
      signal: AbortSignal.timeout(WORKER_TIMEOUT_MS),
    });
    if (!response.ok) {
      await response.body?.cancel();
      if (response.status === 415 || response.status === 422) {
        throw new InvoiceUploadError('Originaldatei konnte nicht vollständig geprüft werden.');
      }
      throw new InvoiceWorkerUnavailable();
    }
    const payload = JSON.parse((await readBounded(response.body, MAX_WORKER_RESPONSE_BYTES)).toString('utf8'));
    const invoice = decode(payload.invoice, MAX_INVOICE_BYTES);
    const report = decode(payload.report, MAX_REPORT_BYTES);
    const pdf = isPdf(bytes) ? bytes : null;
    const { result } = payload;
    const invoiceHash = hash(invoice);
    if (result?.sourceSha256 !== invoiceHash || result?.technicalEvidence?.invoiceSha256 !== invoiceHash
      || result.technicalEvidence.reportSha256 !== hash(report)
      || (pdf ? result.pdfComparison?.pdfSha256 !== hash(pdf) : !bytes.equals(invoice) || result.pdfComparison)) {
      throw new InvoiceWorkerUnavailable();
    }
    return { invoice, report, pdf, result };
  } catch (error) {
    if (error instanceof InvoiceUploadError) throw error;
    throw new InvoiceWorkerUnavailable();
  }
}

export async function inspectConfiguredInvoice(bytes, env = process.env) {
  if (env.PETRAPLAN_INVOICE_WORKER_URL || env.PETRAPLAN_INVOICE_WORKER_TOKEN) {
    return inspectViaWorker(bytes, {
      origin: env.PETRAPLAN_INVOICE_WORKER_URL,
      token: env.PETRAPLAN_INVOICE_WORKER_TOKEN,
    });
  }
  const jar = env.PETRAPLAN_KOSIT_JAR;
  const scenarios = env.PETRAPLAN_KOSIT_SCENARIOS;
  if (!jar || !scenarios) throw new InvoiceWorkerUnavailable();
  return inspectInvoiceBytes(bytes, { jar, scenarios });
}
