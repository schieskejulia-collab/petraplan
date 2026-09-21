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

export async function currentAccessToken(): Promise<string | null> {
  const { data } = await bridgeAuth.auth.getSession();
  return data.session?.access_token ?? null;
}
