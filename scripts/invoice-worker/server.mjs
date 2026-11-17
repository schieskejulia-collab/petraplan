import { createServer } from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
import { constants, access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { InvoiceUploadError } from '../capture-invoice-case.mjs';
import {
  BodyLimitError, inspectInvoiceBytes, isPdf, MAX_INVOICE_BYTES, MAX_WORKER_RESPONSE_BYTES, readBounded,
} from './protocol.mjs';

const digest = value => createHash('sha256').update(value).digest();

export function createInvoiceWorker({ token, jar, scenarios, allowPdf = false, inspect = inspectInvoiceBytes }) {
  if (!token || !jar || !scenarios) throw new Error('Worker token and KoSIT configuration are required.');
  const authorization = digest(`Bearer ${token}`);
  let busy = false;
  return createServer({ requestTimeout: 30_000 }, async (req, res) => {
    const json = (status, body) => {
      res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(body);
    };
    if (req.method === 'GET' && req.url === '/health') return json(200, '{"status":"up"}');
    if (req.url !== '/v1/inspect') return json(404, '{"error":"NOT_FOUND"}');
    if (req.method !== 'POST') return json(405, '{"error":"METHOD_NOT_ALLOWED"}');
    if (!timingSafeEqual(digest(req.headers.authorization ?? ''), authorization)) {
      return json(401, '{"error":"UNAUTHORIZED"}');
    }
    if (req.headers['content-type'] !== 'application/octet-stream') {
      return json(415, '{"error":"CONTENT_TYPE_UNSUPPORTED"}');
    }
    if (Number(req.headers['content-length']) > MAX_INVOICE_BYTES) {
      return json(413, '{"error":"PAYLOAD_TOO_LARGE"}');
    }
    if (busy) return json(503, '{"error":"WORKER_BUSY"}');
    busy = true;
    try {
      const bytes = await readBounded(req.iterator({ destroyOnReturn: false }), MAX_INVOICE_BYTES);
      if (!bytes.length) return json(400, '{"error":"EMPTY_FILE"}');
      if (!allowPdf && isPdf(bytes)) return json(415, '{"error":"PDF_UPLOAD_DISABLED"}');
      const { invoice, report, result } = await inspect(bytes, { jar, scenarios });
      const response = JSON.stringify({ invoice: invoice.toString('base64'), report: report.toString('base64'), result });
      if (Buffer.byteLength(response) > MAX_WORKER_RESPONSE_BYTES) return json(422, '{"error":"PROOF_TOO_LARGE"}');
      return json(200, response);
    } catch (error) {
      if (error instanceof BodyLimitError) {
        req.resume();
        return json(413, '{"error":"PAYLOAD_TOO_LARGE"}');
      }
      if (error instanceof InvoiceUploadError) return json(422, '{"error":"INSPECTION_REJECTED"}');
      console.error('PetraPlan invoice worker failed', error?.code ?? error?.name ?? 'unknown');
      return json(500, '{"error":"INSPECTION_FAILED"}');
    } finally {
      busy = false;
    }
  });
}

async function main() {
  const { PETRAPLAN_INVOICE_WORKER_TOKEN: token, PETRAPLAN_KOSIT_JAR: jar,
    PETRAPLAN_KOSIT_SCENARIOS: scenarios, PETRAPLAN_PDF_TEST_UPLOADS, PORT = '8080' } = process.env;
  const server = createInvoiceWorker({ token, jar, scenarios, allowPdf: PETRAPLAN_PDF_TEST_UPLOADS === '1' });
  await Promise.all([access(jar, constants.R_OK), access(scenarios, constants.R_OK)]);
  server.listen(Number(PORT), '0.0.0.0', () => console.log('PetraPlan invoice worker listening'));
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
