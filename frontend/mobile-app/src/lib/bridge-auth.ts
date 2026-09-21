import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://yxhllviostywckxoehgf.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_5K4DaWJe1oUU5zHqbHnMLA_W_NVEUgU';

export const bridgeAuth = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

/**
 * Keep magic-link returns on one stable client route.  Do not include the
 * current deployment path, search parameters, or hash: preview/deployment
 * URLs are disposable while `/translator` is the supported entry point.
 */
export function bridgeAuthRedirectUrl(origin = window.location.origin): string {
  return new URL('/translator', origin).toString();
}

export async function currentAccessToken(): Promise<string | null> {
  const { data } = await bridgeAuth.auth.getSession();
  return data.session?.access_token ?? null;
}
