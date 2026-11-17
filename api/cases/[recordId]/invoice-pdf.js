import { createHash } from 'node:crypto';
import { requireBridgeRole } from '../../_lib/auth.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function createInvoicePdfHandler(authenticate = requireBridgeRole) {
  return async function invoicePdf(req, res) {
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      return res.status(405).json({ error: 'Nur GET ist erlaubt.' });
    }
    const { recordId, snapshotId } = req.query ?? {};
    if (typeof recordId !== 'string' || !UUID.test(recordId)
      || typeof snapshotId !== 'string' || !UUID.test(snapshotId)) {
      return res.status(400).json({ error: 'Fall oder Fassung ist ungültig.' });
    }
    try {
      const context = await authenticate(req, res);
      if (!context) return;
      const { data, error } = await context.supabase.from('bridge_invoice_evidence')
        .select('original_pdf, ingestion:ingestion_logs!bridge_invoice_evidence_snapshot_id_fkey(extracted_schema)')
        .eq('record_id', recordId).eq('snapshot_id', snapshotId).maybeSingle();
      if (error) throw error;
      if (!data?.original_pdf) return res.status(404).json({ error: 'Original-PDF nicht verfügbar.' });
      const hex = data.original_pdf;
      if (typeof hex !== 'string' || !/^\\x(?:[a-f\d]{2})+$/i.test(hex)) {
        return res.status(409).json({ error: 'Original-PDF konnte nicht geprüft werden.' });
      }
      const bytes = Buffer.from(hex.slice(2), 'hex');
      if (createHash('sha256').update(bytes).digest('hex') !== data.ingestion?.extracted_schema?.pdfComparison?.pdfSha256) {
        return res.status(409).json({ error: 'Prüfsumme des Original-PDF stimmt nicht.' });
      }
      res.setHeader('Cache-Control', 'private, no-store');
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'attachment; filename="rechnung-original.pdf"');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      return res.status(200).send(bytes);
    } catch (error) {
      console.error('PetraPlan invoice PDF read failed', error?.code ?? error?.name ?? 'unknown');
      return res.status(500).json({ error: 'Original-PDF konnte nicht geladen werden.' });
    }
  };
}

export default createInvoicePdfHandler();
