import { createClient } from '@supabase/supabase-js';

const JWT_FUTURE_RETRY_DELAYS_MS = [150, 500, 1000] as const;

export function authToken(req: any): string {
  const header = String(req.headers?.authorization ?? '');
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || '';
}

function isJwtIssuedAtFuture(status: number, body: string): boolean {
  if (status !== 401 && status !== 403) return false;
  return /PGRST303/i.test(body) || /JWT issued at future/i.test(body);
}

async function retryingSupabaseFetch(input: any, init?: any): Promise<Response> {
  let response = await fetch(input, init);

  for (const delayMs of JWT_FUTURE_RETRY_DELAYS_MS) {
    const body = await response.clone().text().catch(() => '');
    if (!isJwtIssuedAtFuture(response.status, body)) return response;

    console.warn(`PetraPlan auth: transient Supabase JWT clock-skew response, retrying in ${delayMs}ms`);
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    response = await fetch(input, init);
  }

  return response;
}

export async function requireBridgeRole(req: any, res: any) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseSecretKey) {
    console.error('PetraPlan auth: server configuration incomplete');
    res.status(500).json({ error: 'Server configuration incomplete' });
    return null;
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(supabaseUrl);
  } catch {
    console.error('PetraPlan auth: SUPABASE_URL is invalid');
    res.status(500).json({ error: 'Server configuration invalid' });
    return null;
  }

  if (parsedUrl.protocol !== 'https:') {
    console.error('PetraPlan auth: SUPABASE_URL must use https');
    res.status(500).json({ error: 'Server configuration invalid' });
    return null;
  }

  const token = authToken(req);
  if (!token) {
    res.status(401).json({ error: 'Authentication required' });
    return null;
  }

  const supabase = createClient(supabaseUrl, supabaseSecretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: retryingSupabaseFetch },
  });

  const { data: authData, error: authError } = await supabase.auth.getUser(token);
  if (authError || !authData.user) {
    res.status(401).json({ error: 'Invalid or expired session' });
    return null;
  }

  const { data: role, error: roleError } = await supabase
    .from('bridge_actor_roles')
    .select('*')
    .eq('user_id', authData.user.id)
    .eq('active', true)
    .maybeSingle();

  if (roleError) {
    console.error('PetraPlan auth: role lookup failed', roleError);
    res.status(500).json({ error: 'Internal server error' });
    return null;
  }

  if (!role) {
    res.status(403).json({ error: 'No active Bridge role' });
    return null;
  }

  return { supabase, user: authData.user, role };
}
