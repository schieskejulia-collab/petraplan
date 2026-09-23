import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://yxhllviostywckxoehgf.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_5K4DaWJe1oUU5zHqbHnMLA_W_NVEUgU';
const PRODUCTION_ORIGIN = 'https://petraplan-eight.vercel.app';

export const bridgeAuth = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

/**
 * Keep magic-link returns on one stable production domain. Deployment-specific
 * Vercel URLs are immutable snapshots and must not become the auth callback.
 * Local development keeps its local origin.
 */
export function bridgeAuthRedirectUrl(origin = window.location.origin): string {
  const parsed = new URL(origin);
  const isLocal = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
  const redirectOrigin = isLocal ? origin : PRODUCTION_ORIGIN;
  return new URL('/translator', redirectOrigin).toString();
}

export async function currentAccessToken(): Promise<string | null> {
  const { data } = await bridgeAuth.auth.getSession();
  return data.session?.access_token ?? null;
}
