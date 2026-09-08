// Points the MAX bot at this deployment's webhook, and shows what it is
// pointed at now.
//
// Run once, after MAX_BOT_TOKEN and MAX_WEBHOOK_SECRET are set:
//   node --env-file=.env.local scripts/max-setup.mjs https://task-tracker-beta-ebon.vercel.app
//
// Without arguments it only reports the current subscriptions, which is the
// safe thing to run when something is not arriving.
//
// The token is issued by MAX only to a verified organisation profile on
// «MAX для партнёров» (dev.max.ru) — an individual cannot create a bot there,
// so this script is useless until that profile exists. It says so plainly
// rather than failing with an HTTP error.

const API = "https://platform-api2.max.ru";
const token = process.env.MAX_BOT_TOKEN;
const secret = process.env.MAX_WEBHOOK_SECRET;
const base = process.argv[2];

if (!token) {
  console.error("MAX_BOT_TOKEN не задан — бот в MAX ещё не создан (нужен профиль организации на dev.max.ru).");
  process.exit(1);
}

const headers = { Authorization: token, "Content-Type": "application/json" };

async function show() {
  const res = await fetch(`${API}/subscriptions`, { headers });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    console.error("Не удалось прочитать подписки:", body?.message || res.status);
    process.exit(1);
  }
  const list = body?.subscriptions || [];
  if (!list.length) console.log("Подписок нет — вебхук не настроен.");
  for (const s of list) console.log("Вебхук:", s.url, s.update_types ? "· " + s.update_types.join(", ") : "");
}

if (!base) {
  await show();
  process.exit(0);
}

if (!secret) {
  console.error("MAX_WEBHOOK_SECRET не задан — без него вебхук будет отклонять все запросы.");
  process.exit(1);
}

const url = base.replace(/\/+$/, "") + "/api/max/webhook";
const res = await fetch(`${API}/subscriptions`, {
  method: "POST",
  headers,
  body: JSON.stringify({
    url,
    // Everything the tracker acts on: a message, a pressed button, and the
    // first opening of the bot (which carries the connection code).
    update_types: ["message_created", "message_callback", "bot_started"],
    secret,
  }),
});
const body = await res.json().catch(() => null);
if (!res.ok || body?.success === false) {
  console.error("Не удалось подписать вебхук:", body?.message || res.status);
  process.exit(1);
}
console.log("Вебхук установлен:", url);
await show();
