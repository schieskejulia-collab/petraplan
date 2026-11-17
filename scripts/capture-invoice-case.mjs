import { execFile } from 'node:child_process';
import { mkdtemp, open, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import pg from 'pg';

const execute = promisify(execFile);
const root = fileURLToPath(new URL('../', import.meta.url));
const maxInvoiceBytes = 8 * 1024 * 1024;

export class InvoiceUploadError extends Error {}

export async function inspectInvoiceFile(input, { jar, scenarios }) {
  const path = await mkdtemp(join(tmpdir(), 'petraplan-case-'));
  try {
    const handle = await open(input, 'r');
    let invoice;
    try {
      const buffer = Buffer.alloc(maxInvoiceBytes + 1);
      let length = 0;
      while (length < buffer.length) {
        const { bytesRead } = await handle.read({ buffer, offset: length, length: buffer.length - length });
        if (!bytesRead) break;
        length += bytesRead;
      }
      if (length > maxInvoiceBytes) throw new Error('Invoice exceeds the XML size limit');
      invoice = buffer.subarray(0, length);
    } finally {
      await handle.close();
    }
    const source = join(path, 'original.xml');
    const reportFile = join(path, 'report.xml');
    let pdf = null;
    let pdfComparison = null;
    if (invoice.subarray(0, 5).toString() === '%PDF-') {
      pdf = invoice;
      const pdfPath = join(path, 'original.pdf');
      await writeFile(pdfPath, pdf);
      try {
        const output = await execute('python3', ['-m', 'backend.ingestion.invoice_pdf', pdfPath, source],
          { cwd: root, timeout: 120_000, maxBuffer: 1024 * 1024 });
        pdfComparison = JSON.parse(output.stdout);
      } catch {
        throw new InvoiceUploadError('PDF und eingebettetes XML konnten nicht vollständig geprüft werden.');
      }
      invoice = await readFile(source);
    } else {
      await writeFile(source, invoice);
    }
    const args = ['-m', 'backend.ingestion.invoice', source, '--kosit-jar', resolve(jar),
      '--scenarios', resolve(scenarios), '--save-report', reportFile];
    let stdout;
    try {
      ({ stdout } = await execute('python3', args, { cwd: root, timeout: 120_000, maxBuffer: 96 * 1024 * 1024 }));
    } catch (error) {
      if (error.code !== 1 || !error.stdout) throw error;
      ({ stdout } = error);
    }
    const result = JSON.parse(stdout);
    if (!result.technicalEvidence) {
      throw new InvoiceUploadError(result.decision?.blockers?.join(', ') || 'Kein KoSIT-Prüfbeleg verfügbar.');
    }
    if (pdfComparison) {
      result.pdfComparison = pdfComparison;
      result.decision.status = 'BLOCKED';
      result.decision.blockers.push('PDF_VISUAL_CONFIRMATION_REQUIRED');
    }
    return { invoice, pdf, report: await readFile(reportFile), result };
  } finally {
    await rm(path, { recursive: true, force: true });
  }
}

export async function persistInvoiceCase(db, { recordId, expectedSnapshotId, actorId }, artifact) {
  const { rows } = await db.query(
    'select public.bridge_capture_invoice_case($1, $2, $3, $4, $5, $6, $7) as result',
    [recordId, expectedSnapshotId ?? null, actorId, artifact.invoice, artifact.report, artifact.result, artifact.pdf ?? null],
  );
  return rows[0].result;
}

async function main() {
  const [file, recordId, actorId, expectedSnapshotId] = process.argv.slice(2);
  const { PETRAPLAN_INVOICE_DATABASE_URL, PETRAPLAN_KOSIT_JAR, PETRAPLAN_KOSIT_SCENARIOS } = process.env;
  if (!file || !recordId || !actorId || !PETRAPLAN_INVOICE_DATABASE_URL || !PETRAPLAN_KOSIT_JAR || !PETRAPLAN_KOSIT_SCENARIOS) {
    throw new Error('Usage: node scripts/capture-invoice-case.mjs invoice.xml case-uuid actor-uuid [previous-snapshot-uuid] (configure database and KoSIT paths)');
  }
  const database = new URL(PETRAPLAN_INVOICE_DATABASE_URL);
  if (!['localhost', '127.0.0.1', '[::1]'].includes(database.hostname)) {
    throw new Error('The invoice CLI requires a local test database');
  }
  const artifact = await inspectInvoiceFile(file, { jar: PETRAPLAN_KOSIT_JAR, scenarios: PETRAPLAN_KOSIT_SCENARIOS });
  const client = new pg.Client({ connectionString: database.href });
  await client.connect();
  try {
    const result = await persistInvoiceCase(client, { recordId, expectedSnapshotId, actorId }, artifact);
    console.log(JSON.stringify(result, null, 2));
    return Number(result.status === 'BLOCKED');
  } finally {
    await client.end();
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().then(
    code => { process.exitCode = code; },
    error => { console.error(error.message); process.exitCode = 1; },
  );
}
