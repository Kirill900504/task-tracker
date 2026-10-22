import { gigaChatComplete } from "@/lib/gigachat/client";
import type { DialogLine } from "@/lib/botMemory";

// Answers a free-form question about the user's own tracker ("что горит?",
// "сколько задач на Никите?", "что у нас с Севастополем?") by handing the
// model a snapshot of the data (see buildTrackerContext) alongside the
// question.
//
// Read-only by construction: this path never creates, changes or deletes
// anything — those go through the quick-add/manage tools, which have their
// own confirmation rules. The worst a bad answer here can do is be wrong on
// screen, which is why the prompt is strict about not inventing items.
//
// 22.10.2026 («максимально общительная и умная версия»): the answer now
// sees the recent conversation, so «а у Игоря?» after a question about
// Наталья is a question about Игорь rather than about nothing, and it is
// asked to sound like a colleague — a direct answer first, then at most one
// concrete next step phrased the way the bot actually understands it. It
// used to close with «напишите это как обычное поручение», which is the bot
// describing itself instead of helping.

export async function answerTrackerQuestion(
  question: string,
  context: string,
  opts: { name?: string; dialog?: DialogLine[] } = {},
): Promise<string> {
  const dialog = opts.dialog || [];
  const system = [
    "Ты — помощник по рабочему таск-трекеру РОКАС в мессенджере. Ты отвечаешь одному человеку о ЕГО делах.",
    opts.name ? `Его зовут ${opts.name}; обращайся на «вы», по имени — изредка, не в каждом ответе.` : "Обращайся на «вы».",
    "Ниже — СНИМОК его данных. Отвечай на вопрос, опираясь ТОЛЬКО на этот снимок.",
    "",
    "Правила:",
    "- Не выдумывай задачи, встречи, имена или даты, которых нет в снимке. Если данных не хватает — так и скажи и предложи, как уточнить.",
    "- Сначала прямой ответ на вопрос, одной-двумя фразами, живым человеческим языком — как внимательный коллега, а не отчёт. Без markdown-разметки и без служебных заголовков.",
    "- Если уместен список — простыми строками, каждая с новой строки, не больше 10 пунктов. Даты пиши по-человечески («завтра», «в пятницу, 24 октября»), а не ГГГГ-ММ-ДД.",
    "- Считать умеешь: если спрашивают «сколько», бери готовые цифры из снимка и назови число.",
    "- Если вопрос про конкретного человека — фильтруй по полю «исп.» и по участникам встреч.",
    "- Если что-то горит или просрочено — скажи об этом прямо и спокойно, без нравоучений.",
    "- В конце, ЕСЛИ это действительно полезно, предложи ОДИН следующий шаг — фразой, которую человек может написать боту, в ёлочках: «Могу поторопить — напишите «поторопи Игоря по смете».» Примеры таких фраз: «перенеси смету на пятницу», «отложи отчёт до понедельника», «встреча с Игорем завтра в 11». Не предлагай ничего, если ответ и так закрыт.",
    "- Сам ты здесь ничего не создаёшь и не меняешь — только отвечаешь. Не пиши, что что-то сделано.",
    ...(dialog.length
      ? [
          "",
          "Недавний разговор (старое сверху). Вопрос может быть его продолжением — «а у Игоря?», «а завтра?» читай вместе с ним:",
          ...dialog.map((l) => `${l.role === "user" ? "Он" : "Бот"}: ${l.body.replace(/\s+/g, " ").slice(0, 300)}`),
        ]
      : []),
    "",
    "=== СНИМОК ДАННЫХ ===",
    context,
    "=== КОНЕЦ СНИМКА ===",
  ].join("\n");

  const raw = await gigaChatComplete({ system, user: question, temperature: 0.3 });
  const answer = raw.trim().replace(/\*\*(.+?)\*\*/g, "$1");
  if (!answer) throw new Error("Пустой ответ модели");
  // Telegram rejects messages over 4096 characters.
  return answer.length > 3900 ? answer.slice(0, 3900) + "…" : answer;
}
