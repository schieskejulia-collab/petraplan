export default async function handler(req: any, res: any) {
  try {
    // Keep the detail route's initialization behavior aligned with the list
    // route so Vercel can report module-loading failures as JSON responses.
    const { getPinnedNorthwindOrder } = await import('../../api-server/src/services/pinnedNorthwind.js');

    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      return res.status(405).json({ error: 'Method not allowed' });
    }
    const orderId = Number(req.query?.orderId);
    if (!Number.isInteger(orderId)) return res.status(400).json({ error: 'Invalid orderId' });
    const result = await getPinnedNorthwindOrder(orderId);
    if (!result) return res.status(404).json({ error: 'Pinned Northwind order not found' });
    if (!result.evaluation || !result.adaptation) return res.status(200).json(result);
    return res.status(200).json({
      orderId: result.orderId,
      envelope: result.envelope,
      sourceSchemaGate: result.sourceSchemaGate,
      sourceSchemaIssues: result.sourceSchemaIssues,
      adaptation: {
        raw: result.adaptation.raw,
        issues: result.adaptation.issues,
        evidence: result.adaptation.evidence,
      },
      evaluation: {
        state: result.evaluation.state,
        mapped: result.evaluation.mapped,
        constraints: result.evaluation.constraints,
        release: result.evaluation.release,
        trace: result.evaluation.trace,
        report: result.evaluation.report,
        provenance: result.evaluation.provenance,
      },
    });
  } catch (error) {
    console.error('PetraPlan Northwind order detail failed:', error);
    return res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown Northwind order detail error' });
  }
}
