import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from '../config/env';
import type { Database } from '../types/database';

/**
 * Server-side Supabase client authenticated with the service-role key.
 * RLS is enabled on every table with no policies, so this backend is the
 * only party able to read or write data.
 */
export const supabase: SupabaseClient<Database> = createClient<Database>(
  env.SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      headers: { 'x-application-name': 'edushorts-backend' },
    },
  },
);
