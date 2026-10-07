// How long the bot takes to answer a press — measured, not felt.
//
// Written 07.10.2026 after «мессенджеры при нажатии любых кнопок тупят». A
// throwaway owner and a throwaway colleague are linked to INVENTED Telegram
// chats (same technique as test-bots.mjs: delivery to those chats fails, and
// that is fine — what is timed is our webhook from request to response, which
// is exactly the time Telegram waits before it shows the answer). Each press is
// repeated so a cold start does not pass for the normal case.
//
// Usage: node --env-file=.env.local scripts/bot-latency.mjs [base-url] [rounds]
import { createClient } from "@supabase/supabase-js";

const base = (process.argv[2] || "https://task-tracker-beta-ebon.vercel.app").replace(/\/+$/, "");
const rounds = Number(process.argv[3] || 3);
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const secret = process.env.TELEGRAM_WEBHOOK_SECRET;

const { data: created, error } = await admin.auth.admin.createUser({
  email: `bot-latency-${Date.now()}@example.invalid`,
  password: "Lat-" + Math.random().toString(36).slice(2) + "!Aa1",
  email_confirm: true,
});
if (error) throw error;
const userId = created.user.id;
const ownerChat = Math.floor(Math.random() * 1e9) + 1e9;
const colleagueChat = ownerChat + 11;

async function code(assigneeId) {
  const c = "L" + Math.random().toString(36).slice(2, 9).toUpperCase().replace(/[01OI]/g, "2");
  await admin.from("telegram_link_codes").insert({ code: c, user_id: userId, channel: "telegram", assignee_id: assigneeId ?? null });
  return c;
}
let upd = Math.floor(Math.random() * 1e8);
async function hook(body) {
  const t0 = performance.now();
  const res = await fetch(base + "/api/telegram/webhook", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-telegram-bot-api-secret-token": secret },
    body: JSON.stringify({ update_id: ++upd, ...body }),
  });
  await res.text();
  return { ms: Math.round(performance.now() - t0), status: res.status, region: res.headers.get("x-vercel-id") || "" };
}
const press = (chat, data, mid = 100) => hook({ callback_query: { id: "cb" + upd, data, from: { id: chat }, message: { chat: { id: chat }, message_id: mid } } });
const { data: botRow } = await admin.from("bot_settings").select("max_webhook_secret").eq("id", true).maybeSingle();
const maxSecret = process.env.MAX_WEBHOOK_SECRET || botRow?.max_webhook_secret || "";
async function maxHook(body) {
  const t0 = performance.now();
  const res = await fetch(base + "/api/max/webhook", { method: "POST", headers: { "Content-Type": "application/json", "x-max-bot-api-secret": maxSecret }, body: JSON.stringify({ timestamp: Date.now(), ...body }) });
  await res.text();
  return { ms: Math.round(performance.now() - t0), status: res.status, region: res.headers.get("x-vercel-id") || "" };
}
const maxPress = (user, payload) => maxHook({ update_type: "message_callback", callback: { callback_id: "cb" + ++upd + Math.random(), payload, user: { user_id: user } } });
const maxOwner = Math.floor(Math.random() * 1e9) + 3e9;
const say = (chat, text) => hook({ message: { chat: { id: chat }, from: { id: chat, username: "lat" }, text } });

try {
  await say(ownerChat, "/start " + (await code()));
  await maxHook({ update_type: "bot_started", user: { user_id: maxOwner, username: "lat" }, payload: await (async () => { const c2 = "M" + Math.random().toString(36).slice(2, 9).toUpperCase().replace(/[01OI]/g, "2"); await admin.from("telegram_link_codes").insert({ code: c2, user_id: userId, channel: "max" }); return c2; })() });
  const { data: person } = await admin.from("assignees").insert({ user_id: userId, name: "Замер Коллега" }).select("id").single();
  await say(colleagueChat, "/start " + (await code(person.id)));
  const ids = [];
  for (let i = 0; i < 6; i++) {
    const id = "lat" + i + Math.random().toString(36).slice(2, 7);
    ids.push(id);
    await admin.from("tasks").insert({ id, user_id: userId, title: "Замер " + i, assignee: "Замер Коллега", deadline: new Date().toISOString().slice(0, 10) });
  }
  await new Promise((r) => setTimeout(r, 1500));

  const cases = [
    ["владелец: ☰ Меню", () => press(ownerChat, "t:~omenu:x")],
    ["владелец: 📋 Задачи", () => press(ownerChat, "t:~olist:all")],
    ["владелец: 📌 Сегодня", () => press(ownerChat, "t:~olist:today")],
    ["владелец: карточка задачи", () => press(ownerChat, "t:~oshow:" + ids[0])],
    ["владелец: 📅 Встречи", () => press(ownerChat, "m:~olist:all")],
    ["коллега: ☰ Меню", () => press(colleagueChat, "t:~list:menu")],
    ["коллега: 📋 Мои задачи", () => press(colleagueChat, "t:~list:my")],
    ["коллега: карточка", () => press(colleagueChat, "t:~show:" + ids[1])],
    ["коллега: ✅ Принял", () => press(colleagueChat, "t:acc:" + ids[2])],
    ["MAX владелец: ☰ Меню", () => maxPress(maxOwner, "t:~omenu:x")],
    ["MAX владелец: 📋 Задачи", () => maxPress(maxOwner, "t:~olist:all")],
    ["MAX владелец: карточка", () => maxPress(maxOwner, "t:~oshow:" + ids[3])],
    ["владелец: текст «сегодня»", () => say(ownerChat, "сегодня")],
    ["коллега: текст «мои задачи»", () => say(colleagueChat, "мои задачи")],
  ];
  console.log(`\n${base} — ${rounds} круга, мс (первый — с холодным стартом)\n`);
  for (const [name, fn] of cases) {
    const times = [];
    let region = "", status = 0;
    for (let r = 0; r < rounds; r++) {
      const res = await fn();
      times.push(res.ms);
      region = res.region;
      status = res.status;
    }
    const sorted = [...times].sort((a, b) => a - b);
    console.log(`${name.padEnd(30)} ${times.join(" / ").padEnd(22)} медиана ${sorted[Math.floor(sorted.length / 2)]}  [${status}] ${region}`);
  }
} finally {
  await admin.auth.admin.deleteUser(userId);
}
