import 'server-only';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * The only database client in the system.
 *
 * It holds the service-role key, which bypasses row level security entirely.
 * Row level security is enabled on every table with zero policies, so this is
 * not one of two ways to reach the data — it is the only way. The browser's
 * Supabase client exists solely to subscribe to a broadcast channel and can read
 * nothing.
 *
 * The `server-only` import at the top is load-bearing: if any client component
 * ever pulls this module into its graph, the build fails rather than shipping
 * the service-role key to a browser.
 */

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(
      `${name} is not set. Copy .env.example to .env.local and fill in your Supabase project details.`,
    );
  }
  return value;
}

let client: SupabaseClient | null = null;

export function db(): SupabaseClient {
  if (client === null) {
    client = createClient(
      required('NEXT_PUBLIC_SUPABASE_URL'),
      required('SUPABASE_SERVICE_ROLE_KEY'),
      {
        auth: { persistSession: false, autoRefreshToken: false },
      },
    );
  }
  return client;
}

/**
 * Infrastructure failures throw; rule violations are returned. A failed query is
 * the former — there is nothing the player did wrong and nothing they can do
 * about it, so it becomes a 500 with a generic message and the detail stays in
 * the server log.
 */
export function failed(operation: string, error: { message: string } | null): never {
  throw new Error(`${operation} failed: ${error?.message ?? 'unknown error'}`);
}
