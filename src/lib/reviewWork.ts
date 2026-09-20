import type { SupabaseClient } from "@supabase/supabase-js";
import { chatsFor, replyButtons, taskButtons, type ColleagueRow } from "@/lib/colleagues";
import { sendToColleague } from "@/lib/botDelivery";
import { recordEvent } from "@/lib/itemHistory";

// Решение постановщика — одно на трекер и на бота.
//
// Принять работу, вернуть её на доработку, закрыть волевым — это правила,
// а не три строчки в базе: приёмка закрывает задачу одной записью (иначе
// эхо realtime стирает ещё не отправленное «сделано»), возврат обнуляет
// отчёты (иначе задача навсегда остаётся «отчитались все»), и в обоих
// случаях людям надо сказать, а в хронику — записать.
//
// Пока решение принималось только из трекера, всё это жило в маршруте
// /api/workspace/review. С появлением тех же кнопок в мессенджере вариантов
// стало два: либо написать правила второй раз, либо вынести их сюда. В
// этом проекте второй экземпляр правил расходился с первым трижды (см.
// «две правды об одном факте» в CLAUDE.md), так что выбор был сделан
// заранее.
//
// Маршрут остаётся тем, чем был: он проверяет, что решение принимает тот,
// кто вправе, — и зовёт это. Бот делает то же самое своей проверкой.

export type ReviewAction = "approve" | "return" | "force" | "reopen";

export type ReviewResult = { ok: true } | { ok: false; error: string };

// Выход из «Завершённых» — и он обязан снимать РОВНО то, что задачу
// закрывало. Столбец доски выводится из двух вещей сразу (`status` и
// `approval_state`), поэтому снятая галочка «сделано» без снятой приёмки
// не возвращала задачу никуда: она оставалась в «Завершённых», а человек
// был уверен, что открыл её. Приёмку из браузера не снять — колонка
// серверная, — значит выход есть только через маршрут, и набор колонок у
// него один на все входы (трекер, бот, массовые действия).
export const REOPEN_PATCH = {
  approval_state: "open",
  approval_comment: null,
  approved_at: null,
  force_closed_by: null,
  force_closed_reason: null,
  status: "in_progress",
  completed_at: null,
  last_completed_on: null,
} as const;

export async function applyReview(
  admin: SupabaseClient,
  task: { id: string; title: string; user_id: string },
  action: ReviewAction,
  comment: string,
  who: { label: string; userId: string },
): Promise<ReviewResult> {
  const text = comment.trim();
  if (action === "return" && !text) return { ok: false, error: "Напишите, что доделать" };
  if (action === "force" && !text) return { ok: false, error: "Нужна причина" };

  const now = new Date().toISOString();
  // Принято и закрыто — одно и то же событие, и записывается оно одной
  // строкой: «принял, но задача висит открытой» не значит ничего.
  const closed = { status: "done", completed_at: now, last_completed_on: now.slice(0, 10) };

  if (action === "approve") {
    await admin
      .from("tasks")
      .update({ approval_state: "accepted", approval_comment: text || null, approved_at: now, ...closed })
      .eq("id", task.id);
  } else if (action === "return") {
    await admin.from("tasks").update({ approval_state: "returned", approval_comment: text, approved_at: null }).eq("id", task.id);
    // Отчёты обнуляются: иначе задача осталась бы «отчитались все», и
    // приёмка предложилась бы снова, ничего не изменив.
    await admin.from("task_participants").update({ done_at: null, done_comment: null }).eq("task_id", task.id).eq("role", "executor");
  } else if (action === "reopen") {
    await admin.from("tasks").update(REOPEN_PATCH).eq("id", task.id);
  } else {
    await admin
      .from("tasks")
      .update({ approval_state: "accepted", approved_at: now, force_closed_by: who.userId, force_closed_reason: text, ...closed })
      .eq("id", task.id);
  }

  // Хроника пишется до рассылки: сообщение может не уйти (нет чата, нет
  // связи), а запись о решении остаться должна в любом случае — именно её
  // потом и ищут, когда спрашивают «а что просили доделать».
  await recordEvent(admin, {
    userId: task.user_id,
    kind: "task",
    itemId: task.id,
    text:
      action === "return"
        ? `↩ ${who.label} вернул на доработку: ${text}`
        : action === "approve"
          ? `✅ ${who.label} принял работу${text ? ": " + text : ""}`
          : action === "reopen"
            ? `🔄 ${who.label} открыл задачу заново${text ? ": " + text : ""}`
            : `🔒 ${who.label} закрыл задачу волевым решением: ${text}`,
  });

  await tellExecutors(admin, task, action, text);
  return { ok: true };
}

// Сказать людям. Молчание после возврата на доработку — самый дорогой вид
// молчания здесь: работа стоит, и никто не знает, что она стоит.
async function tellExecutors(
  admin: SupabaseClient,
  task: { id: string; title: string },
  action: ReviewAction,
  comment: string,
): Promise<void> {
  const { data: parts } = await admin
    .from("task_participants")
    .select("assignee_id, role")
    .eq("task_id", task.id)
    .in("role", ["executor", "coexecutor"]);
  const ids = ((parts || []) as { assignee_id: string }[]).map((p) => p.assignee_id);
  if (!ids.length) return;

  const { data: people } = await admin.from("assignees").select("id, name, telegram_chat_id, max_user_id").in("id", ids);

  const text =
    action === "return"
      ? `↩ Вернули на доработку: «${task.title}»\n\n${comment}`
      : action === "approve"
        ? `✅ Принято: «${task.title}»${comment ? "\n\n" + comment : ""}`
        : action === "reopen"
          ? `🔄 Задачу открыли заново: «${task.title}»${comment ? "\n\n" + comment : ""}`
          : `🔒 Задача закрыта: «${task.title}»\n\n${comment}`;

  // Под возвратом — кнопки, которыми на него отвечают: сообщение, которым
  // задачу присылали, к этому моменту уже переписано, и отчитаться заново
  // было бы нечем. То же самое у заново открытой задачи: по ней снова
  // ждут отчёта. После приёмки ждать нечего — остаётся «Ответить».
  const buttons =
    action === "return" || action === "reopen" ? taskButtons(task.id, "executor") : replyButtons("task", task.id);

  for (const person of ((people || []) as ColleagueRow[])) {
    const target = chatsFor(person)[0];
    if (target) await sendToColleague(target, text, buttons);
  }
}
