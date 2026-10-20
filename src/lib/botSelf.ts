import type { SkillContext, SkillReply } from "@/lib/botSkills";
import { findItems, type TaskToMove } from "@/lib/botMoveFlow";
import { actorScope, authorFilter } from "@/lib/botActor";
import { encodeCallback } from "@/lib/colleagues";
import { navRow } from "@/lib/botMenu";
import { parseWhen } from "@/lib/botWhen";
import { parseAwayDate, awayPhrase, type AwayKind } from "@/lib/away";
import { dateStr, moscowNow } from "@/lib/taskLogic";
import { fmtDate } from "@/lib/taskDisplay";
import { numbered } from "@/lib/taskRef";
import { isSelfAssignee } from "@/lib/trackerRows";

// Два умения бота, которые касаются ТОЛЬКО самого пишущего, — поэтому
// делаются сразу, без «да» (то же правило, что у напоминания себе в
// lib/botSkills). Аудит ботов 20.10.2026: в трекере это кнопки «Отложить»
// и «Меня не будет…», а в боте их не было вовсе — ни словом, ни кнопкой, —
// хотя именно вне офиса о них и вспоминают.

function today(): string {
  return dateStr(moscowNow());
}

function short(text: string, limit: number): string {
  return text.length > limit ? text.slice(0, limit - 1) + "…" : text;
}

// ------------------------------------------------------------ отложить

// «Отложи смету до понедельника». Отложенность — свойство доски ТОГО, КТО
// ПОСТАВИЛ (TasksPanel.snoozedMine — authored): исполнитель задачу видит
// как видел. Поэтому откладывает только автор, и задача ищется среди
// поставленных им (findItems по актору с фильтром автора). Колонка
// `snoozed_until` — колонка движка синхронизации; серверная правка
// доезжает до вкладки подпиской так же, как перенос срока из бота.
export async function planSnooze(ctx: SkillContext, input: Record<string, unknown>): Promise<SkillReply> {
  const query = String(input.query || "").trim();
  // «На доску» и «не откладывай» в самой фразе — всегда возврат, что бы ни
  // ответила модель. На боевом 20.10.2026 «верни отчёт для банка на доску»
  // сразу после «отложи … до 26.10» разобралось с датой из памяти разговора
  // (lib/botMemory) — и задача осталась отложенной. Слова человека сильнее
  // контекста.
  const back = input.back === true || /на\s+доску|не\s+отклад/i.test(ctx.phrase);
  const { tasks, found } = await findItems(ctx.admin, ctx.actor, { itemType: "task", query, replyText: ctx.reply?.text, replyItem: ctx.reply?.item });
  const hits = found.filter((f): f is { kind: "task"; t: TaskToMove } => f.kind === "task").map((f) => f.t);
  const button = (t: TaskToMove) => [{ text: `📋 ${short(numbered(t), 32)}`, data: encodeCallback("task", "oshow", t.id) }];
  if (hits.length !== 1) {
    if (!tasks.length) return { text: "Не нашёл открытых задач, которые вы поставили: откладывает тот, кто поставил задачу." };
    if (!hits.length) return { text: `Не нашёл задачу${query ? ` «${query}»` : ""} среди поставленных вами.`, buttons: [...tasks.slice(0, 6).map(button), ...navRow("assigner")] };
    return { text: "Нашёл несколько — какую? Назовите точнее:", buttons: hits.slice(0, 6).map(button) };
  }
  const task = hits[0];
  const now = today();

  if (back) {
    await ctx.admin.from("tasks").update({ snoozed_until: null }).eq("id", task.id).match(actorScope(ctx.actor)).or(authorFilter(ctx.actor));
    return { text: `↩ ${numbered(task)} — снова на доске.` };
  }

  const date = parseWhen(String(input.until || "") || ctx.phrase, now).date;
  if (!date) return { text: `До какого дня отложить ${numbered(task)}? Например: «до понедельника», «до 27.10», «на неделю».` };
  if (date <= now) return { text: "Отложить можно только на будущий день — назовите день позже сегодняшнего." };

  const { error } = await ctx.admin.from("tasks").update({ snoozed_until: date }).eq("id", task.id).match(actorScope(ctx.actor)).or(authorFilter(ctx.actor));
  if (error) return { text: "Не получилось отложить — попробуйте ещё раз." };
  // Срок раньше дня возврата — задача вернётся уже просроченной. Сказать
  // сейчас, а не в день возврата (то же предупреждение, что у кнопки в
  // трекере, components/tracker/snoozeAsk).
  const late = task.deadline && task.deadline < date ? `\n⚠ Срок ${fmtDate(task.deadline)} — раньше: вернётся уже просроченной.` : "";
  return { text: `💤 ${numbered(task)} — отложена до ${fmtDate(date)}, в этот день вернётся на доску сама.${late}\nВернуть раньше — «верни ${short(task.title, 30)} на доску».` };
}

// ------------------------------------------------------- меня не будет

const KIND_WORDS: [RegExp, AwayKind][] = [
  [/отпуск/i, "vacation"],
  [/больнич|заболел|болею|болен/i, "sick"],
  [/командиров/i, "trip"],
];

// «Меня не будет до пятницы», «я в отпуске до 30.10», «я вернулся».
// Отметка на своей строке людей (миграция 0047), как «Меня не будет…» в
// личном кабинете: это знание, а не запрет — поручать можно, ступени
// просрочки не будят. Отмечает человек только себя (то же правило, что у
// маршрута /api/workspace/away).
export async function planAway(ctx: SkillContext, input: Record<string, unknown>): Promise<SkillReply> {
  const now = today();
  // Своя строка: у руководителя — по членству (actor.assigneeId), у
  // владельца — строка «(я)».
  let rowId = ctx.actor.assigneeId;
  if (ctx.actor.isOwner || !rowId) {
    const { data } = await ctx.admin.from("assignees").select("id, name").eq("user_id", ctx.actor.spaceId);
    rowId = ((data || []) as { id: string; name: string }[]).find((p) => isSelfAssignee(p.name))?.id || "";
  }
  if (!rowId) return { text: "Не нашёл вашу строку в списке людей — отметьте отсутствие в трекере, в личном кабинете." };

  // То же правило, что у «на доску»: «вернулся» во фразе — возврат.
  if (input.back === true || /вернул(ся|ась)|снова\s+на\s+месте|уже\s+на\s+месте/i.test(ctx.phrase)) {
    await ctx.admin.from("assignees").update({ away_until: null, away_kind: null }).eq("id", rowId);
    return { text: "С возвращением — отметку «нет на месте» снял." };
  }

  const words = String(input.until || "") || ctx.phrase;
  const date = parseAwayDate(words.replace(/^\s*до\s+/i, ""), now) || parseWhen(words, now).date;
  if (!date) return { text: "До какого дня вас не будет? Например: «до пятницы», «до 30.10». Дата — последний день отсутствия." };
  if (date < now) return { text: "Этот день уже прошёл — назовите последний день отсутствия." };
  const kind = KIND_WORDS.find(([re]) => re.test(ctx.phrase))?.[1] || ((["vacation", "sick", "trip"] as string[]).includes(String(input.kind)) ? (input.kind as AwayKind) : "other");

  const { error } = await ctx.admin.from("assignees").update({ away_until: date, away_kind: kind }).eq("id", rowId);
  if (error) return { text: "Не получилось отметить — попробуйте ещё раз." };
  return {
    text:
      `🌴 Отметил: вы ${awayPhrase(kind, date)} (включительно).\n` +
      "Поручать вам можно — коллеги увидят отметку у имени. Напоминания о просрочке пока вас нет не будят.\n" +
      "Вернулись раньше — напишите «я вернулся».",
  };
}
