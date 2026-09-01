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

async function testTable(table, rowFor) {
  console.log(`\n${table}:`);
  const a = await makeUser("a");
  const b = await makeUser("b");

  try {
    const row = rowFor();
    const { data: inserted, error: insErr } = await a.client.from(table).insert(row).select().single();
    check("A can insert their own row", !insErr && inserted);
    if (insErr) {
      console.log("    insert error:", insErr.message);
      return;
    }
    const rowId = inserted.id;

    const { data: aReadsOwn } = await a.client.from(table).select("id").eq("id", rowId);
    check("A can read their own row back", (aReadsOwn || []).length === 1);

    const { data: bReadsA } = await b.client.from(table).select("id").eq("id", rowId);
    check("B cannot see A's row (select returns empty, not an error)", (bReadsA || []).length === 0);

    const { data: bUpdateA } = await b.client.from(table).update({ ...row, id: rowId }).eq("id", rowId).select();
    check("B's update against A's row affects 0 rows", (bUpdateA || []).length === 0);

    const { data: bDeleteA } = await b.client.from(table).delete().eq("id", rowId).select();
    check("B's delete against A's row affects 0 rows", (bDeleteA || []).length === 0);

    const { data: stillThere } = await a.client.from(table).select("id").eq("id", rowId);
    check("A's row is untouched after B's failed update/delete", (stillThere || []).length === 1);

    // Spoofing attempt: B tries to insert a row explicitly claiming A's user_id.
    const spoofRow = { ...row, user_id: a.id };
    const { error: spoofErr } = await b.client.from(table).insert(spoofRow);
    check("B cannot insert a row claiming to be A's user_id", !!spoofErr);

    await a.client.from(table).delete().eq("id", rowId);
  } finally {
    await cleanupUser(a.id);
    await cleanupUser(b.id);
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

  console.log(`\n${failures === 0 ? "ALL PASSED" : failures + " FAILURE(S)"}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("Script error:", e);
  process.exit(1);
});
