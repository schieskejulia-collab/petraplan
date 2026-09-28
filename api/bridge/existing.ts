import { createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { getPinnedNorthwindOrder } from '../../api-server/src/services/pinnedNorthwind.js';

function authToken(req: any) {
  const header = String(req.headers?.authorization ?? '');
  return header.startsWith('Bearer ') ? header.slice(7).trim() : '';
}

function sourceHash(value: unknown) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export default async function handler(req: any, res: any) {
  try {
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      return res.status(405).json({ error: 'Method not allowed' });
    }

    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !supabaseSecretKey) {
      return res.status(500).json({ error: 'Server configuration incomplete' });
    }

    const token = authToken(req);
    if (!token) return res.status(401).json({ error: 'Authentication required' });

    const supabase = createClient(supabaseUrl, supabaseSecretKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: userData, error: userError } = await supabase.auth.getUser(token);
    if (userError || !userData.user) return res.status(401).json({ error: 'Invalid or expired session' });

    const { data: role, error: roleError } = await supabase
      .from('bridge_actor_roles')
      .select('user_id')
      .eq('user_id', userData.user.id)
      .eq('active', true)
      .maybeSingle();
    if (roleError) throw roleError;
    if (!role) return res.status(403).json({ error: 'No active Bridge role' });

    const orderId = Number(req.query?.northwind_order_id);
    if (!Number.isInteger(orderId)) {
      return res.status(400).json({ error: 'Invalid northwind_order_id' });
    }

    const northwind = await getPinnedNorthwindOrder(orderId);
    if (!northwind || !northwind.evaluation || !northwind.adaptation || northwind.sourceSchemaGate !== 'ACCEPTED') {
      return res.status(404).json({ error: 'Pinned Northwind order not found or not accepted' });
    }

    const sourceSystem = northwind.envelope.source;
    const sourceReference = `A-${orderId}`;
    const hash = sourceHash(northwind.envelope);

    const { data: ingestions, error: ingestionError } = await supabase
      .from('ingestion_logs')
      .select('id, created_at')
      .eq('source_system', sourceSystem)
      .eq('source_reference', sourceReference)
      .eq('source_hash', hash)
      .eq('status', 'processed')
      .order('created_at', { ascending: true })
      .limit(50);
    if (ingestionError) throw ingestionError;

    const ingestionIds = (ingestions ?? []).map((item: any) => String(item.id));
    if (!ingestionIds.length) {
      return res.status(200).json({ exists: false });
    }

    const { data: records, error: recordError } = await supabase
      .from('records')
      .select('id, ingestion_log_id, created_at')
      .in('ingestion_log_id', ingestionIds);
    if (recordError) throw recordError;

    const recordsByIngestion = new Map(
      (records ?? []).map((record: any) => [String(record.ingestion_log_id), record]),
    );

    const canonicalIngestion = (ingestions ?? []).find((item: any) => recordsByIngestion.has(String(item.id)));
    if (!canonicalIngestion) {
      return res.status(200).json({ exists: false });
    }

    const canonicalRecord = recordsByIngestion.get(String(canonicalIngestion.id));
    return res.status(200).json({
      exists: true,
      reused: true,
      record_id: canonicalRecord.id,
      ingestion_id: canonicalIngestion.id,
      source_system: sourceSystem,
      source_reference: sourceReference,
      source_hash: hash,
    });
  } catch (error) {
    console.error('PetraPlan existing-case lookup failed:', error);
    return res.status(500).json({ error: error instanceof Error ? error.message : 'Existing-case lookup failed' });
  }
}
