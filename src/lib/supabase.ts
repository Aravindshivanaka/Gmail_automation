import { createClient } from "@supabase/supabase-js";

/**
 * Supabase admin client — SERVER-SIDE ONLY.
 *
 * Why "admin"? We use the SERVICE ROLE KEY, which bypasses Supabase's Row Level
 * Security (RLS). That's appropriate here because we store OAuth tokens and
 * need full read/write from our API routes. RLS is for protecting data from
 * untrusted browser clients; our server is trusted.
 *
 * ⚠️  This module must NEVER be imported by a Client Component (anything with
 * "use client" at the top). The service role key would leak to the browser.
 * We only import it inside Route Handlers under src/app/api/**.
 */

if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
  throw new Error("Missing env var: NEXT_PUBLIC_SUPABASE_URL");
}
if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("Missing env var: SUPABASE_SERVICE_ROLE_KEY");
}

export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  {
    // We talk to Supabase from short-lived API route invocations, so we don't
    // need the auto session-refresh logic meant for browser usage.
    auth: { persistSession: false, autoRefreshToken: false },
  },
);
