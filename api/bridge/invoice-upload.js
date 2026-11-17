import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { requireBridgeRole } from '../_lib/auth.ts';
import { inspectInvoiceFile, InvoiceUploadError } from '../../scripts/capture-invoice-case.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_BYTES = 8 * 1024 * 1024;
const bytea = buffer => buffer === null ? null : '\\x' + buffer.toString('hex');

export function createInvoiceUploadHandler(authenticate = requireBridgeRole) {
  return async function invoiceUpload(req, res) {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return res.status(405).json({ error: 'Nur POST ist erlaubt.' });
    }
    let directory;
    try {
      const context = await authenticate(req, res);
      if (!context) return;
      if (!context.role.can_review) return res.status(403).json({ error: 'Für den Import ist Review-Berechtigung erforderlich.' });
      const { recordId, expectedSnapshotId = null, contentBase64 } = req.body ?? {};
      if (typeof recordId !== 'string' || !UUID.test(recordId)
        || (expectedSnapshotId !== null && (typeof expectedSnapshotId !== 'string' || !UUID.test(expectedSnapshotId)))) {
        return res.status(400).json({ error: 'Fall oder Fassung ist ungültig.' });
      }
      if (typeof contentBase64 !== 'string' || !contentBase64.length) {
        return res.status(400).json({ error: 'Eine Rechnungsdatei ist erforderlich.' });
      }
      if (contentBase64.length > Math.ceil(MAX_BYTES / 3) * 4) return res.status(413).json({ error: 'Datei ist größer als 8 MiB.' });
      const content = Buffer.from(contentBase64, 'base64');
      if (!content.length || content.length > MAX_BYTES || content.toString('base64') !== contentBase64) {
        return res.status(400).json({ error: 'Dateiinhalt ist ungültig.' });
      }
      if (content.subarray(0, 5).toString() === '%PDF-' && process.env.PETRAPLAN_PDF_TEST_UPLOADS !== '1') {
        return res.status(415).json({ error: 'PDF-Upload ist für die lokale Testumgebung vorgesehen.' });
      }
      const jar = process.env.PETRAPLAN_KOSIT_JAR;
      const scenarios = process.env.PETRAPLAN_KOSIT_SCENARIOS;
      if (!jar || !scenarios) return res.status(503).json({ error: 'Rechnungsprüfung ist in dieser Umgebung nicht eingerichtet.' });

      directory = await mkdtemp(join(tmpdir(), 'petraplan-upload-'));
      const file = join(directory, 'invoice');
      await writeFile(file, content);
      const artifact = await inspectInvoiceFile(file, { jar, scenarios });
      const { data, error } = await context.supabase.rpc('bridge_capture_invoice_case', {
        p_record_id: recordId,
        p_expected_snapshot_id: expectedSnapshotId,
        p_actor_id: context.user.id,
        p_invoice: bytea(artifact.invoice),
        p_report: bytea(artifact.report),
        p_result: artifact.result,
        p_pdf: bytea(artifact.pdf),
      });
      if (error) {
        if (error.code === 'PT409') return res.status(409).json({ error: 'Datei konnte dem aktuellen Fallstand nicht zugeordnet werden. Lade den Fall neu.' });
        if (error.code === 'PT403') return res.status(403).json({ error: 'Für diese Falländerung fehlt eine Berechtigung.' });
        throw error;
      }
      return res.status(data.reused ? 200 : 201).json(data);
    } catch (error) {
      if (error instanceof InvoiceUploadError) return res.status(422).json({ error: error.message });
      console.error('PetraPlan invoice upload failed', error?.code ?? error?.name ?? 'unknown');
      return res.status(500).json({ error: 'Rechnung konnte nicht verarbeitet werden.' });
    } finally {
      if (directory) await rm(directory, { recursive: true, force: true }).catch(() => {});
    }
  };
}

export default createInvoiceUploadHandler();
