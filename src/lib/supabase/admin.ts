import { createClient as createSupabaseClient } from "@supabase/supabase-js";

// Service-role client — bypasses RLS entirely. Server-only, never imported
// by client components. Used exactly where there is no browser session to
// authenticate with: the Telegram webhook (acting on behalf of an account
// already linked via /api/telegram/link-code) and that link-code lookup.
// Every query built with this client MUST filter by an explicitly known
// user_id itself — there is no auth.uid() to fall back on.
export function createAdminClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}
