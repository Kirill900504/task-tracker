// How long the tracker's buttons wait for the server — measured per route.
//
// Written 07.10.2026 after «трекер работает медленно». Throwaway owner and
// manager (same technique as test-workspace.mjs), a task from one to the
// other, and every button that goes through a route is timed end to end.
// Nobody real is messaged: the people have no chats.
//
// Usage: node --env-file=.env.local scripts/route-latency.mjs [base-url]
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { randomUUID } from "node:crypto";

const base = (process.argv[2] || "https://task-tracker-beta-ebon.vercel.app").replace(/\/+$/, "");
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
const created = [];

async function makeUser(tag) {
  const email = `lat-${tag}-${Date.now()}@example.invalid`;
  const password = "Lt-" + randomUUID().slice(0, 12) + "!Aa1";
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  created.push(data.user.id);
  const jar = new Map();
  const db = createServerClient(url, anonKey, {
    cookies: {
      getAll: () => [...jar.entries()].map(([name, value]) => ({ name, value })),
      setAll: (list) => list.forEach(({ name, value }) => jar.set(name, value)),
    },
  });
  await db.auth.signInWithPassword({ email, password });
  return { id: data.user.id, email, password, db, cookie: () => [...jar.entries()].map(([n, v]) => `${n}=${encodeURIComponent(v)}`).join("; ") };
}
async function timed(actor, path, body, method = "POST") {
  const t0 = performance.now();
  const res = await fetch(base + path, {
    method,
    headers: { "Content-Type": "application/json", ...(actor ? { cookie: actor.cookie() } : {}) },
    ...(method === "POST" ? { body: JSON.stringify(body) } : {}),
  });
  const json = await res.json().catch(() => null);
  return { ms: Math.round(performance.now() - t0), status: res.status, body: json };
}
const rows = [];
function row(name, r) {
  rows.push([name, r.ms, r.status]);
  console.log(`${name.padEnd(40)} ${String(r.ms).padStart(6)} мс  [${r.status}]${r.status >= 400 ? " " + JSON.stringify(r.body).slice(0, 120) : ""}`);
}

try {
  const owner = await makeUser("owner");
  const { data: people } = await owner.db.from("assignees").insert([{ user_id: owner.id, name: "Лат Коллега" }]).select("id, name");
  const person = people[0];
  const invite = await timed(owner, "/api/workspace/invite", { assigneeId: person.id });
  const mgrAuth = { email: `lat-mgr-${Date.now()}@example.invalid`, password: "Lt-" + randomUUID().slice(0, 12) + "!Aa1" };
  const join = await timed(null, "/api/workspace/join", { code: invite.body.code, email: mgrAuth.email, password: mgrAuth.password });
  const { data: mgrUser } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  const mgrId = mgrUser.users.find((u) => u.email === mgrAuth.email)?.id;
  if (mgrId) created.push(mgrId);
  const jar = new Map();
  const mdb = createServerClient(url, anonKey, { cookies: { getAll: () => [...jar.entries()].map(([name, value]) => ({ name, value })), setAll: (l) => l.forEach(({ name, value }) => jar.set(name, value)) } });
  await mdb.auth.signInWithPassword(mgrAuth);
  const mgr = { id: mgrId, db: mdb, cookie: () => [...jar.entries()].map(([n, v]) => `${n}=${encodeURIComponent(v)}`).join("; ") };

  console.log(`\n${base}\n`);
  row("приглашение (invite)", invite);
  row("вступление (join)", join);

  for (let round = 0; round < 2; round++) {
    const taskId = "lt" + Math.random().toString(36).slice(2, 9);
    await owner.db.from("tasks").insert({ id: taskId, user_id: owner.id, title: "Замер " + round, assignee: person.name });
    await new Promise((r) => setTimeout(r, 800));
    const { data: part } = await admin.from("task_participants").select("id").eq("task_id", taskId).maybeSingle();
    console.log(`\nкруг ${round + 1}${round === 0 ? " (возможен холодный старт)" : ""}`);
    row("видел (report seen)", await timed(mgr, "/api/workspace/report", { action: "seen", participantId: part.id }));
    row("Принял (report accept)", await timed(mgr, "/api/workspace/report", { action: "accept", participantId: part.id }));
    row("Сделал (report done)", await timed(mgr, "/api/workspace/report", { action: "done", participantId: part.id, comment: "готово" }));
    const { data: comment } = await owner.db.from("item_comments").insert({ user_id: owner.id, item_kind: "task", item_id: taskId, body: "реплика", author_user_id: owner.id }).select("id").maybeSingle();
    if (comment) row("реплика в обсуждение (comment)", await timed(owner, "/api/workspace/comment", { commentId: comment.id }));
    row("Принять работу (review approve)", await timed(owner, "/api/workspace/review", { action: "approve", taskId, comment: "принято" }));
    row("Открыть заново (review reopen)", await timed(owner, "/api/workspace/review", { action: "reopen", taskId, comment: "ещё раз" }));
    row("отправить в мессенджер (telegram/send)", await timed(owner, "/api/telegram/send", { kind: "task", id: taskId, to: [person.name] }));
  }
  const t0 = performance.now();
  const page = await fetch(base + "/", { headers: { cookie: owner.cookie() } });
  await page.text();
  row("страница трекера (HTML)", { ms: Math.round(performance.now() - t0), status: page.status });
} finally {
  for (const id of created) await admin.auth.admin.deleteUser(id).catch(() => {});
}
