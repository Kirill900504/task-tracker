import { maxSettings } from "@/lib/botSettings";
import { russianFetch } from "@/lib/russianCa";

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
    return res.ok;
  } catch {
    return false;
  }
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
