// How long it takes for one person's answer to reach the OTHER person's
// screen — the delay that only F5 used to cure.
//
// Written 14.10.2026 after «после того как с аккаунта Кирилл Кучеренко я
// нажал „выполнил“, у меня перешло в колонку „на приёмке“ только после F5».
// route-latency.mjs times the button; this times the echo: a throwaway
// owner and manager each hold the same realtime subscriptions the tracker
// holds (tasks by space, task_participants unfiltered), and every step of
// report → return → report is timed from the button to the moment each
// side hears about it. "—" means the event never came within the wait,
// which is exactly the case where the screen sits still until a reload.
//
// Usage: node --env-file=.env.local scripts/realtime-latency.mjs [base-url]
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { randomUUID } from "node:crypto";

const base = (process.argv[2] || "https://task-tracker-beta-ebon.vercel.app").replace(/\/+$/, "");
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
const created = [];
const WAIT_MS = 8000;

async function signIn(email, password, id) {
  const jar = new Map();
  const ssr = createServerClient(url, anonKey, {
    cookies: {
      getAll: () => [...jar.entries()].map(([name, value]) => ({ name, value })),
      setAll: (list) => list.forEach(({ name, value }) => jar.set(name, value)),
    },
  });
  await ssr.auth.signInWithPassword({ email, password });
  // A separate plain client for the websocket, signed in as the same person.
  const live = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  await live.auth.signInWithPassword({ email, password });
  return { id, db: ssr, live, cookie: () => [...jar.entries()].map(([n, v]) => `${n}=${encodeURIComponent(v)}`).join("; ") };
}

async function makeOwner() {
  const email = `rt-owner-${Date.now()}@example.invalid`;
  const password = "Rt-" + randomUUID().slice(0, 12) + "!Aa1";
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  created.push(data.user.id);
  return signIn(email, password, data.user.id);
}

async function post(actor, path, body) {
  const res = await fetch(base + path, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie: actor.cookie() },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

// Every event either side receives, with its arrival time.
function listen(who, actor, ownerId) {
  const events = [];
  const ch = actor.live
    .channel("rt-" + who + Math.random().toString(36).slice(2))
    .on("postgres_changes", { event: "*", schema: "public", table: "tasks", filter: `user_id=eq.${ownerId}` }, (p) =>
      events.push({ table: "tasks", at: performance.now(), row: p.new }),
    )
    .on("postgres_changes", { event: "*", schema: "public", table: "task_participants" }, (p) =>
      events.push({ table: "task_participants", at: performance.now(), row: p.new }),
    );
  const ready = new Promise((resolve) => ch.subscribe((s) => s === "SUBSCRIBED" && resolve()));
  return { events, ready, stop: () => actor.live.removeChannel(ch) };
}

async function firstAfter(events, t0, table, test) {
  const until = t0 + WAIT_MS;
  while (performance.now() < until) {
    const hit = events.find((e) => e.at >= t0 && e.table === table && test(e.row || {}));
    if (hit) return Math.round(hit.at - t0);
    await new Promise((r) => setTimeout(r, 20));
  }
  return null;
}

const fmt = (ms) => (ms == null ? "     —" : String(ms).padStart(6) + " мс");

try {
  const owner = await makeOwner();
  const { data: people } = await owner.db.from("assignees").insert([{ user_id: owner.id, name: "Рт Коллега" }]).select("id, name");
  const person = people[0];
  const invite = await post(owner, "/api/workspace/invite", { assigneeId: person.id });
  const mgrEmail = `rt-mgr-${Date.now()}@example.invalid`;
  const mgrPassword = "Rt-" + randomUUID().slice(0, 12) + "!Aa1";
  await fetch(base + "/api/workspace/join", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code: invite.body.code, email: mgrEmail, password: mgrPassword }),
  });
  const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  const mgrId = list.users.find((u) => u.email === mgrEmail)?.id;
  if (mgrId) created.push(mgrId);
  const mgr = await signIn(mgrEmail, mgrPassword, mgrId);

  const ownerEars = listen("owner", owner, owner.id);
  const mgrEars = listen("mgr", mgr, owner.id);
  await Promise.all([ownerEars.ready, mgrEars.ready]);

  const taskId = "rt" + Math.random().toString(36).slice(2, 9);
  await owner.db.from("tasks").insert({ id: taskId, user_id: owner.id, title: "Замер эха", assignee: person.name });
  await new Promise((r) => setTimeout(r, 1200));
  const { data: part } = await admin.from("task_participants").select("id").eq("task_id", taskId).maybeSingle();

  console.log(`\n${base}\n${"".padEnd(34)}  постановщик   исполнитель`);
  async function step(name, actor, path, body, checks) {
    const t0 = performance.now();
    const r = await post(actor, path, body);
    const button = Math.round(performance.now() - t0);
    console.log(`${name} — кнопка ${button} мс${r.status >= 400 ? ", " + r.status + " " + JSON.stringify(r.body) : ""}`);
    for (const [label, table, test] of checks) {
      const [a, b] = await Promise.all([firstAfter(ownerEars.events, t0, table, test), firstAfter(mgrEars.events, t0, table, test)]);
      console.log(`   ${label.padEnd(31)} ${fmt(a)}   ${fmt(b)}`);
    }
  }

  for (let round = 1; round <= 2; round++) {
    console.log(`круг ${round}`);
    if (round === 1)
      await step("Принял", mgr, "/api/workspace/report", { action: "accept", participantId: part.id }, [
        ["строка участия", "task_participants", (row) => row.id === part.id && row.accepted_at],
      ]);
    await step("Сделал", mgr, "/api/workspace/report", { action: "done", participantId: part.id, comment: "готово" }, [
      ["строка участия", "task_participants", (row) => row.id === part.id && row.done_at],
      ["задача → на приёмке", "tasks", (row) => row.id === taskId && row.approval_state === "awaiting_review"],
    ]);
    await step("Вернуть на доработку", owner, "/api/workspace/review", { action: "return", taskId, comment: "доделать" }, [
      ["строка участия", "task_participants", (row) => row.id === part.id && !row.done_at],
      ["задача → возвращена", "tasks", (row) => row.id === taskId && row.approval_state === "returned"],
    ]);
  }
  ownerEars.stop();
  mgrEars.stop();
} finally {
  for (const id of created) await admin.auth.admin.deleteUser(id).catch(() => {});
}
