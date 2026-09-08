// Integration check for both webhooks after the shared-pipeline refactor.
//
// Creates a throwaway Supabase auth user (same technique as e2e/global-setup),
// then drives each webhook through the connection handshake and one message,
// asserting the database effects. Sends to the real messengers fail (the chat
// ids are invented) — that is fine and deliberate: what is under test is the
// route wiring and the shared pipeline, not the delivery.
//
// Usage: npm run test:bots            (against http://localhost:3100)
//        npm run test:bots -- <url>   (against any deployment)
import { createClient } from "@supabase/supabase-js";

const base = process.argv[2] || "http://localhost:3100";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

let failures = 0;
function check(name, ok, detail) {
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${ok || detail === undefined ? "" : " — " + JSON.stringify(detail)}`);
  if (!ok) failures++;
}

const { data: created, error: userError } = await admin.auth.admin.createUser({
  email: `bot-check-${Date.now()}@example.invalid`,
  password: "Bot-" + Math.random().toString(36).slice(2) + "!Aa1",
  email_confirm: true,
});
if (userError) throw userError;
const userId = created.user.id;

const tgChat = Math.floor(Math.random() * 1e9) + 1e9;
const maxUser = Math.floor(Math.random() * 1e9) + 2e9;

async function makeCode(channel, assigneeId) {
  const code = "T" + Math.random().toString(36).slice(2, 9).toUpperCase().replace(/[01OI]/g, "2");
  const { error } = await admin.from("telegram_link_codes").insert({ code, user_id: userId, channel, assignee_id: assigneeId ?? null });
  if (error) throw error;
  return code;
}

async function post(path, body, headers) {
  const res = await fetch(base + path, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

try {
  // ---- Telegram: the owner connects with a code ----
  console.log("\nTelegram webhook:");
  const tgSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
  const tgCode = await makeCode("telegram");
  const start = await post(
    "/api/telegram/webhook",
    { update_id: Math.floor(Math.random() * 1e9), message: { chat: { id: tgChat }, from: { username: "checker" }, text: "/start " + tgCode } },
    { "x-telegram-bot-api-secret-token": tgSecret },
  );
  check("responds 200 to /start", start.status === 200, start);

  const { data: tgAccount } = await admin.from("telegram_accounts").select("user_id").eq("telegram_chat_id", tgChat).maybeSingle();
  check("links the chat to the account", tgAccount?.user_id === userId, tgAccount);

  const { data: usedCode } = await admin.from("telegram_link_codes").select("code").eq("code", tgCode).maybeSingle();
  check("burns the code", usedCode === null, usedCode);

  const forbidden = await post("/api/telegram/webhook", { message: { chat: { id: tgChat }, text: "привет" } }, { "x-telegram-bot-api-secret-token": "wrong" });
  check("refuses a request without the right secret", forbidden.status === 403, forbidden);

  // A read-only command: no model call, but it goes through account lookup,
  // the rate limit and the shared pipeline.
  const query = await post(
    "/api/telegram/webhook",
    { update_id: Math.floor(Math.random() * 1e9), message: { chat: { id: tgChat }, text: "сегодня" } },
    { "x-telegram-bot-api-secret-token": tgSecret },
  );
  check("answers a query command", query.status === 200, query);

  // ---- Telegram: a colleague connects and presses a button ----
  const { data: assignee } = await admin.from("assignees").insert({ user_id: userId, name: "Проверочный Коллега" }).select("id").single();
  const colleagueChat = tgChat + 7;
  const colleagueCode = await makeCode("telegram", assignee.id);
  await post(
    "/api/telegram/webhook",
    { update_id: Math.floor(Math.random() * 1e9), message: { chat: { id: colleagueChat }, text: "/start " + colleagueCode } },
    { "x-telegram-bot-api-secret-token": tgSecret },
  );
  const { data: linkedColleague } = await admin.from("assignees").select("telegram_chat_id").eq("id", assignee.id).maybeSingle();
  check("links a colleague to their own chat", Number(linkedColleague?.telegram_chat_id) === colleagueChat, linkedColleague);

  const taskId = "chk" + Math.random().toString(36).slice(2, 8);
  await admin.from("tasks").insert({ id: taskId, user_id: userId, title: "Проверка кнопки", assignee: "Проверочный Коллега", status: "in_progress" });
  const press = await post(
    "/api/telegram/webhook",
    {
      update_id: Math.floor(Math.random() * 1e9),
      callback_query: { id: "cbq1", data: "t:acc:" + taskId, message: { chat: { id: colleagueChat }, message_id: 5 } },
    },
    { "x-telegram-bot-api-secret-token": tgSecret },
  );
  check("accepts a pressed button", press.status === 200, press);
  const { data: acceptedTask } = await admin.from("tasks").select("accepted_at").eq("id", taskId).maybeSingle();
  check("records «принял» on the task", !!acceptedTask?.accepted_at, acceptedTask);

  // ---- MAX ----
  console.log("\nMAX webhook:");
  const maxSecret = process.env.MAX_WEBHOOK_SECRET;
  const maxCode = await makeCode("max");
  const started = await post(
    "/api/max/webhook",
    { update_type: "bot_started", timestamp: Date.now(), user: { user_id: maxUser, username: "checker" }, payload: maxCode },
    { "x-max-bot-api-secret": maxSecret },
  );
  // Where no MAX bot exists (no token — creating one needs a verified
  // organisation profile), the webhook says so and there is nothing to test.
  if (started.body?.skipped) {
    console.log("  --   MAX не настроен на этом сервере, проверка пропущена");
  } else {
  check("responds 200 to bot_started", started.status === 200, started);

  const { data: maxAccount } = await admin.from("max_accounts").select("user_id").eq("max_user_id", maxUser).maybeSingle();
  check("links the MAX chat to the account", maxAccount?.user_id === userId, maxAccount);

  const maxForbidden = await post("/api/max/webhook", { update_type: "message_created" }, { "x-max-bot-api-secret": "wrong" });
  check("refuses a request without the right secret", maxForbidden.status === 403, maxForbidden);

  const mid = "mid." + Math.random().toString(36).slice(2);
  const maxQuery = await post(
    "/api/max/webhook",
    {
      update_type: "message_created",
      timestamp: Date.now(),
      message: { sender: { user_id: maxUser }, recipient: { chat_id: -1, chat_type: "dialog" }, body: { mid, seq: 1, text: "сегодня" } },
    },
    { "x-max-bot-api-secret": maxSecret },
  );
  check("answers a query command", maxQuery.status === 200, maxQuery);

  // The same update again: a redelivery must be dropped, not re-run.
  const { data: seen } = await admin.from("max_processed_updates").select("update_key").eq("update_key", "msg:" + mid).maybeSingle();
  check("remembers the update so a redelivery is ignored", !!seen, seen);

  // A wrong-messenger code: issued for Telegram, offered to MAX.
  const crossCode = await makeCode("telegram");
  await post(
    "/api/max/webhook",
    { update_type: "bot_started", timestamp: Date.now(), user: { user_id: maxUser + 1 }, payload: crossCode },
    { "x-max-bot-api-secret": maxSecret },
  );
  const { data: crossAccount } = await admin.from("max_accounts").select("user_id").eq("max_user_id", maxUser + 1).maybeSingle();
  check("refuses a code issued for the other messenger", crossAccount === null, crossAccount);
  }
} finally {
  await admin.auth.admin.deleteUser(userId);
  console.log(`\n${failures === 0 ? "ALL PASSED" : failures + " FAILURE(S)"}`);
  process.exit(failures === 0 ? 0 : 1);
}
