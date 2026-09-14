// Диагностика подписки бота MAX: куда сейчас ходят обновления и как это
// переставить.
//
// ЭТО ЗАПАСНОЙ ПУТЬ. Обычный — страница /max в самом трекере: там вставляют
// токен бота из кабинета MAX для бизнеса, и подписка на вебхук оформляется
// сама. Скрипт нужен
// там, где страницы нет под рукой: проверить, куда MAX доставляет
// обновления, или перевести бота на другое развёртывание.
//
//   node --env-file=.env.local scripts/max-setup.mjs                      # показать
//   node --env-file=.env.local scripts/max-setup.mjs https://<адрес>      # переставить
//
// Требует MAX_BOT_TOKEN и MAX_WEBHOOK_SECRET в .env.local. Если бот
// подключён через /max, токен и секрет лежат в таблице bot_settings, а не в
// переменных окружения — и тогда правильный ответ на «не приходит» тоже
// там: открыть /max и подключить заново.

const API = "https://platform-api2.max.ru";
const token = process.env.MAX_BOT_TOKEN;
const secret = process.env.MAX_WEBHOOK_SECRET;
const base = process.argv[2];

if (!token) {
  console.error("MAX_BOT_TOKEN не задан. Если бот подключали через страницу /max, токен лежит в базе — управляйте им оттуда.");
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
