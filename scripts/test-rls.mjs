// RLS isolation test — creates two throwaway accounts, proves user A can
// never read/write/delete user B's rows through the normal (anon-key)
// client, then cleans everything up. Run with:
//   node --env-file=.env.local scripts/test-rls.mjs
// Needs NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, and
// SUPABASE_SERVICE_ROLE_KEY in the environment (.env.local covers all
// three already).

import { createClient } from "@supabase/supabase-js";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!URL || !ANON_KEY || !SERVICE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const admin = createClient(URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

let failures = 0;
function check(label, condition) {
  if (condition) {
    console.log("  ok   " + label);
  } else {
    console.log("  FAIL " + label);
    failures++;
  }
}

async function makeUser(tag) {
  const email = `rls-test-${tag}-${Date.now()}@example.invalid`;
  const password = "Test-" + Math.random().toString(36).slice(2) + "!Aa1";
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  const client = createClient(URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const { error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) throw signInError;
  return { id: data.user.id, client };
}

async function cleanupUser(userId) {
  await admin.auth.admin.deleteUser(userId);
}

async function testTable(table, rowFor, key = "id") {
  console.log(`\n${table}:`);
  const a = await makeUser("a");
  const b = await makeUser("b");

  try {
    const row = rowFor(a.id);
    const { data: inserted, error: insErr } = await a.client.from(table).insert(row).select().single();
    check("A can insert their own row", !insErr && inserted);
    if (insErr) {
      console.log("    insert error:", insErr.message);
      return;
    }
    const rowId = inserted[key];

    const { data: aReadsOwn } = await a.client.from(table).select(key).eq(key, rowId);
    check("A can read their own row back", (aReadsOwn || []).length === 1);

    const { data: bReadsA } = await b.client.from(table).select(key).eq(key, rowId);
    check("B cannot see A's row (select returns empty, not an error)", (bReadsA || []).length === 0);

    const { data: bUpdateA } = await b.client.from(table).update({ ...row, [key]: rowId }).eq(key, rowId).select();
    check("B's update against A's row affects 0 rows", (bUpdateA || []).length === 0);

    const { data: bDeleteA } = await b.client.from(table).delete().eq(key, rowId).select();
    check("B's delete against A's row affects 0 rows", (bDeleteA || []).length === 0);

    const { data: stillThere } = await a.client.from(table).select(key).eq(key, rowId);
    check("A's row is untouched after B's failed update/delete", (stillThere || []).length === 1);

    // Spoofing attempt: B tries to insert a row explicitly claiming A's user_id.
    const spoofRow = { ...row, user_id: a.id };
    const { error: spoofErr } = await b.client.from(table).insert(spoofRow);
    check("B cannot insert a row claiming to be A's user_id", !!spoofErr);

    await a.client.from(table).delete().eq(key, rowId);
  } finally {
    await cleanupUser(a.id);
    await cleanupUser(b.id);
  }
}

// user_prefs is keyed by the user rather than by an id, so the generic
// test above does not fit: there is one row per person and no id to
// address someone else's by.
async function testUserPrefs() {
  console.log("\nuser_prefs:");
  const a = await makeUser("a");
  const b = await makeUser("b");
  try {
    const { error: insErr } = await a.client.from("user_prefs").insert({ panel_layout: { left: ["calPanel"] } });
    check("A can save their own preferences", !insErr);

    const { data: bReads } = await b.client.from("user_prefs").select("user_id").eq("user_id", a.id);
    check("B cannot read A's preferences", (bReads || []).length === 0);

    const { data: bWrites } = await b.client.from("user_prefs").update({ panel_layout: { left: ["hacked"] } }).eq("user_id", a.id).select();
    check("B's update against A's preferences affects 0 rows", (bWrites || []).length === 0);

    const { data: stillMine } = await a.client.from("user_prefs").select("panel_layout").eq("user_id", a.id).single();
    check("A's preferences are untouched", JSON.stringify(stillMine?.panel_layout) === JSON.stringify({ left: ["calPanel"] }));

    const { error: spoofErr } = await b.client.from("user_prefs").insert({ user_id: a.id, panel_layout: {} });
    check("B cannot write preferences in A's name", !!spoofErr);
  } finally {
    await cleanupUser(a.id);
    await cleanupUser(b.id);
  }
}

// Tables only the server (service role) ever writes: a signed-in user must
// not be able to read another person's rows, or add rows at all.
async function testServerOnlyTable(table, row) {
  console.log(`\n${table} (server-only):`);
  const a = await makeUser("a");
  try {
    const { error } = await a.client.from(table).insert(row);
    check("a signed-in user cannot insert", !!error);
    const { data } = await a.client.from(table).select("*").limit(5);
    check("a signed-in user sees nothing", (data || []).length === 0);
  } finally {
    await cleanupUser(a.id);
  }
}

async function main() {
  await testTable("tasks", () => ({
    id: "rlstest" + Math.random().toString(36).slice(2),
    title: "rls test task",
    priority: "med",
    term: "short",
    status: "in_progress",
  }));

  await testTable("meetings", () => ({
    id: "rlstest" + Math.random().toString(36).slice(2),
    title: "rls test meeting",
    date: "2026-09-02",
    time: "10:00",
    participants: [],
    status: "planned",
  }));

  await testTable("ideas", () => ({
    id: "rlstest" + Math.random().toString(36).slice(2),
    text: "rls test idea",
    important: false,
    done: false,
  }));

  await testTable("sections", () => ({
    id: "rlstest" + Math.random().toString(36).slice(2),
    name: "rls test section",
    kind: "work",
    sort_order: 0,
  }));

  await testTable("assignees", () => ({
    name: "RLS Тестовый " + Math.random().toString(36).slice(2),
  }));

  await testTable("sync_errors", () => ({
    message: "rls test sync error",
  }));

  await testTable("ai_action_logs", () => ({
    source: "web",
    input_text: "rls test",
    success: true,
  }));

  // No default on user_id here: this table is written by the API routes,
  // which always pass the id explicitly.
  await testTable("api_rate_limits", (ownerId) => ({
    user_id: ownerId,
    route: "rls-test",
  }));

  // Same: link codes are issued by /api/telegram/link-code.
  await testTable(
    "telegram_link_codes",
    (ownerId) => ({
      user_id: ownerId,
      code: "rls" + Math.random().toString(36).slice(2, 8),
    }),
    "code",
  );

  await testUserPrefs();

  // telegram_accounts is linked by the webhook (service role) — a user may
  // read and unlink their own, never anyone else's, and never create one.
  await testServerOnlyTable("telegram_accounts", { telegram_chat_id: Math.floor(Math.random() * 1e9), user_id: "00000000-0000-0000-0000-000000000000" });

  await testServerOnlyTable("telegram_notifications", { telegram_chat_id: 1, kind: "task_due", ref_id: "x", notif_date: "2026-09-06" });
  await testServerOnlyTable("telegram_processed_updates", { update_id: Math.floor(Math.random() * 1e9) });

  // The MAX tables are the same shape and the same rules: written only by
  // the webhook with the service-role key, never by a signed-in browser.
  await testServerOnlyTable("max_accounts", { max_user_id: Math.floor(Math.random() * 1e9), user_id: "00000000-0000-0000-0000-000000000000" });
  await testServerOnlyTable("max_processed_updates", { update_key: "rls-" + Math.random().toString(36).slice(2) });

  console.log(`\n${failures === 0 ? "ALL PASSED" : failures + " FAILURE(S)"}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("Script error:", e);
  process.exit(1);
});
