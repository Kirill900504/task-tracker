import type { SupabaseClient } from "@supabase/supabase-js";
import { maxSettings } from "@/lib/botSettings";
import { russianFetch } from "@/lib/russianCa";
import { miniAppUrl } from "@/lib/trackerUrl";

// Меню команд бота — то, что мессенджер показывает сам, до всякого
// сообщения.
//
// Весь остальной интерфейс бота живёт под сообщениями: кнопка приходит
// вместе с задачей и уезжает вверх вместе с ней. Человек, открывший чат
// спустя неделю, не видит ни одной — и единственный способ узнать, что
// здесь вообще что-то можно, это угадать слово. Меню команд — то место,
// которое не прокручивается: оно стоит в самом мессенджере, у поля ввода.
//
// Команды латиницей не по выбору, а по требованию обоих API. Русские слова
// для тех же действий работают как раньше — см. matchColleagueCommand и
// matchQueryCommand: меню подсказывает, а не заменяет.

export type BotCommand = { command: string; description: string };

// Один набор на всех. Владельцу «мои задачи» покажет его задачи, коллеге —
// его; два разных меню в одном боте развести всё равно нечем, а команда,
// которой у человека нет, отвечает понятной фразой вместо тишины.
export const BOT_COMMANDS: BotCommand[] = [
  // «Меню» первым: это единственная команда, после которой видно все
  // остальные кнопки, и человеку, открывшему чат впервые, достаточно её.
  { command: "menu", description: "Меню" },
  { command: "tasks", description: "Мои задачи" },
  { command: "today", description: "Что на сегодня" },
  { command: "overdue", description: "Что просрочено" },
  { command: "meetings", description: "Ближайшие встречи" },
  { command: "review", description: "Что сдано и что вернули" },
  { command: "help", description: "Что я умею" },
];

// Best-effort в обе стороны: не выставилось меню — бот работает ровно так
// же, как работал, а вторая попытка будет завтра (см. cron/reminders).
export async function setTelegramCommands(): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return false;
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/setMyCommands`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ commands: BOT_COMMANDS }),
    });
    if (!res.ok) return false;
  } catch {
    return false;
  }
  return setTelegramMenuButton();
}

// Кнопка «Меню» слева от поля ввода.
//
// Список команд по «/» — это подсказка для того, кто уже знает, что
// команды бывают. Кирилл прислал 20.09.2026 снимки чужого бота именно с
// этой кнопкой: она стоит у поля ввода всегда, не уезжает вверх вместе с
// перепиской и видна человеку, открывшему чат впервые. Его слова о том,
// зачем это: «если люди вне офиса им не всегда будет кайф открывать
// приложения, а мессенджеры у них ОТКРЫТЫ ВСЕГДА».
//
// `chatId` отсутствует — ставим значение ПО УМОЛЧАНИЮ, на все чаты разом.
// С ним — только этому чату, и это разные вещи: по умолчанию у всех
// команды, а у тех, у кого есть вход в трекер, — мини-приложение
// (syncTelegramAppButtons ниже).
export async function setTelegramMenuButton(
  menuButton: Record<string, unknown> = { type: "commands" },
  chatId?: number,
): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return false;
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/setChatMenuButton`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...(chatId ? { chat_id: chatId } : {}), menu_button: menuButton }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// Тем, у кого есть вход в трекер, та же кнопка открывает сам трекер.
//
// Это и есть то, что Кирилл показал на снимках: кнопка у поля ввода
// открывает не список команд, а приложение. Разница с чужим ботом в том,
// что у нас за ней стоит вход, и у половины людей его нет, — поэтому
// кнопка ставится ПОИМЕННО, а не всем сразу. Получателю задач остаётся
// значение по умолчанию (команды): мини-приложение ответило бы ему
// отказом, и кнопка, ведущая к отказу, хуже отсутствующей.
//
// Зовётся из ежедневного крона рядом с остальными настройками бота:
// пригласили человека — на следующий день кнопка у него появилась сама.
// Ждать дольше суток незачем, а делать это на каждое сообщение значит
// вызывать API Telegram там, где человек ждёт ответа.
export async function syncTelegramAppButtons(admin: SupabaseClient): Promise<number> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return 0;

  const chats = new Set<number>();

  // Владелец: его чат живёт в таблице аккаунтов.
  const { data: accounts } = await admin.from("telegram_accounts").select("telegram_chat_id");
  for (const row of ((accounts || []) as { telegram_chat_id: number | null }[])) {
    if (row.telegram_chat_id) chats.add(row.telegram_chat_id);
  }

  // Остальные: чат на строке человека, но только при активном членстве —
  // оно и означает «у него есть вход».
  const { data: members } = await admin
    .from("workspace_members")
    .select("assignee_id, member_id, status")
    .eq("status", "active");
  const ids = ((members || []) as { assignee_id: string | null; member_id: string | null }[])
    .filter((m) => m.member_id && m.assignee_id)
    .map((m) => m.assignee_id as string);
  if (ids.length) {
    const { data: people } = await admin.from("assignees").select("telegram_chat_id").in("id", ids);
    for (const row of ((people || []) as { telegram_chat_id: number | null }[])) {
      if (row.telegram_chat_id) chats.add(row.telegram_chat_id);
    }
  }

  const button = { type: "web_app", text: "Трекер", web_app: { url: miniAppUrl() } };
  let set = 0;
  for (const chatId of chats) {
    if (await setTelegramMenuButton(button, chatId)) set++;
  }
  return set;
}

// У MAX это часть профиля бота: PATCH /me с тем же списком. И, как всё
// остальное к *.max.ru, через russianFetch — иначе вызов умирает двумя
// словами «fetch failed» на боевом и прекрасно работает отсюда.
export async function setMaxCommands(): Promise<boolean> {
  const settings = await maxSettings();
  if (!settings) return false;
  try {
    const res = await russianFetch("https://platform-api2.max.ru/me", {
      method: "PATCH",
      headers: { Authorization: settings.token, "Content-Type": "application/json" },
      body: JSON.stringify({ commands: BOT_COMMANDS.map((c) => ({ name: c.command, description: c.description })) }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
