import { createClient } from "@supabase/supabase-js";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

// Runs against the live production deployment (no separate staging exists
// for a single-user personal app) — safe specifically *because* this
// creates a throwaway Supabase Auth user via the admin API first (same
// technique scripts/test-rls.mjs already uses), so every row the test
// touches belongs to that isolated account, invisible to and never mixed
// with Кирилл's real data thanks to RLS. global-teardown.ts deletes the
// account afterward; `on delete cascade` takes its rows with it.
export default async function globalSetup() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY — run with --env-file=.env.local");
  }

  const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const email = `e2e-${Date.now()}@example.invalid`;
  const password = "E2e-" + Math.random().toString(36).slice(2) + "!Aa1";

  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;

  writeFileSync(
    join(__dirname, ".e2e-user.json"),
    JSON.stringify({ id: data.user.id, email, password }),
  );
}
