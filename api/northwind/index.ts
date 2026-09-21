import { listPinnedNorthwindOrders } from '../../api-server/src/services/pinnedNorthwind.js';

export default async function handler(req: any, res: any) {
  try {
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      return res.status(405).json({ error: 'Method not allowed' });
    }
    const rawLimit = Number(req.query?.limit ?? 25);
    const rawOffset = Number(req.query?.offset ?? 0);
    const result = await listPinnedNorthwindOrders({
      q: String(req.query?.q ?? ''),
      state: String(req.query?.state ?? ''),
      limit: Number.isFinite(rawLimit) ? rawLimit : 25,
      offset: Number.isFinite(rawOffset) ? rawOffset : 0,
    });
    return res.status(200).json(result);
  } catch (error) {
    console.error('PetraPlan Northwind browser failed:', error);
    return res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown Northwind browser error' });
  }
}
