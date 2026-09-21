export default async function handler(req: any, res: any) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const startedAt = Date.now();
  try {
    const { listPinnedNorthwindOrders } = await import('../../../api-server/src/services/pinnedNorthwind.js');
    const result = await listPinnedNorthwindOrders({ offset: 0, limit: 3 });
    return res.status(200).json({
      sourceId: 'northwind-830',
      status: 'ready',
      checkedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt,
      summary: result.summary,
      sample: result.items.map((item: any) => ({
        orderId: item.orderId,
        recordId: item.recordId,
        customerId: item.customerId,
        companyName: item.companyName,
      })),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown source read error';
    console.error('PetraPlan Northwind source check failed:', error);
    return res.status(500).json({ error: `Northwind source check failed: ${message}` });
  }
}
