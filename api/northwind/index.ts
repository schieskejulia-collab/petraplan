import { listPinnedNorthwindOrders } from '../../api-server/src/services/pinnedNorthwind.js';

/**
 * The browser and the detail view use the same operational adapter. Keeping
 * the list endpoint on that path prevents the overview from showing a stale
 * proof-only state that disagrees with the actual translated record.
 */
export default async function handler(req: any, res: any) {
  try {
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      return res.status(405).json({ error: 'Method not allowed' });
    }

    const result = await listPinnedNorthwindOrders({
      q: String(req.query?.q ?? ''),
      state: String(req.query?.state ?? ''),
      offset: Number(req.query?.offset ?? 0),
      limit: Number(req.query?.limit ?? 25),
    });

    return res.status(200).json(result);
  } catch (error) {
    console.error('PetraPlan Northwind browser failed:', error);
    return res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown Northwind browser error' });
  }
}
