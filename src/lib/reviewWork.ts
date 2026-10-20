import type { SupabaseClient } from "@supabase/supabase-js";
import { replyButtons, taskButtons, type ColleagueRow } from "@/lib/colleagues";
import { sendToPerson } from "@/lib/reach";
import { recordEvent } from "@/lib/itemHistory";
import { taskRef } from "@/lib/taskRef";

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
  task: { id: string; title: string; user_id: string; status?: string | null },
  action: ReviewAction,
  comment: string,
  who: { label: string; userId: string },
  // Не писать исполнителям. Нужно ровно одному случаю — своей задаче,
  // закрытой собственным отчётом (closeIfEveryoneReported): «работу
  // приняли» самому себе — это сообщение о том, что ты только что нажал.
  quiet = false,
  // Чем отправить сообщения людям. Маршрут трекера передаёт сюда after():
  // рассылка — это полёт до Telegram и до MAX в России, и человек, нажавший
  // «Вернуть», ждал его целиком, прежде чем окно закрывалось. Решение
  // записано в базу до ответа — это и есть то, что ему нужно знать сразу.
  defer?: (job: () => Promise<void>) => void,
): Promise<ReviewResult> {
  const tell = async (a: ReviewAction, t: string, unfulfilled = false) => {
    if (quiet) return;
    if (defer) defer(() => tellExecutors(admin, task, a, t, unfulfilled));
    else await tellExecutors(admin, task, a, t, unfulfilled);
  };
  const text = comment.trim();
  if (action === "return" && !text) return { ok: false, error: "Напишите, что доделать" };
  if (action === "force" && !text) return { ok: false, error: "Нужна причина" };

  // Приёмка и волевое закрытие оба ЗАКРЫВАЮТ задачу — и второй такой же
  // запрос на уже закрытую задачу не решение, а эхо первого. Без этой
  // проверки гонка (медленная сеть плюс повторное нажатие «Принять», пока
  // карточка ещё не успела закрыться) записывала приёмку дважды — с двумя
  // разными комментариями поверх друг друга — и слала исполнителям два
  // одинаковых по смыслу, но разных по тексту сообщения. Кирилл,
  // 24.09.2026, по скриншоту. Открывает задачу заново только «Открыть
  // заново» (см. REOPEN_PATCH) — поэтому здесь достаточно тихо ничего не
  // делать, а не отвечать ошибкой: то, чего человек добивался нажатием,
  // уже случилось первым запросом.
  if ((action === "approve" || action === "force") && task.status === "done") {
    return { ok: true };
  }

  // Возвращают ОТВЕТ, и вернуть можно только то, что сдали.
  //
  // 14.10.2026 Кирилл трижды подряд вернул одну задачу, между возвратами
  // отчитавшись лишь раз: возврат снимает отчёты, но карточка ещё
  // показывала «Все исполнители отчитались», и кнопка была под рукой.
  // Второй возврат без нового отчёта — второе сообщение человеку о том же
  // самом и вторая строка в хронике, которая читается как «вернули
  // дважды». Поэтому возврат требует хотя бы одного ответа (отчёта или
  // отказа) — того, что он и снимет.
  if (action === "return") {
    const { data: answered } = await admin
      .from("task_participants")
      .select("id")
      .eq("task_id", task.id)
      .eq("role", "executor")
      .or("done_at.not.is.null,declined_at.not.is.null")
      .limit(1);
    if (!answered?.length) return { ok: false, error: "Уже возвращено на доработку — ждём нового отчёта" };
  }

  // Принять можно только сданную работу. «Принять» в карточке появляется,
  // лишь когда есть хотя бы один отчёт (см. «Отказ — это ответ» в
  // CLAUDE.md), но маршрут этого не знал: аудит десяти аккаунтов
  // 20.10.2026 принял задачу, от которой единственный исполнитель
  // отказался, — и та легла в «Завершённые» как выполненная, с сообщением
  // «работу приняли» человеку, который её не делал. Закрыть такую задачу
  // можно, но словами «невыполненной» — принудительным закрытием.
  if (action === "approve") {
    const { data: answers } = await admin
      .from("task_participants")
      .select("done_at, declined_at, role")
      .eq("task_id", task.id)
      .neq("role", "watcher");
    const rows = (answers || []) as { done_at: string | null; declined_at: string | null }[];
    if (!rows.some((r) => r.done_at) && rows.some((r) => r.declined_at)) {
      return { ok: false, error: "Принимать нечего — исполнители отказались. Закройте задачу принудительно или верните её." };
    }
  }

  // Закрыть задачу, по которой не сдано ни одного отчёта, — это «закрыть
  // невыполненной» (14.10.2026, его слова: исполнитель сказал «не могу»,
  // причина уважительная — закрыть без результата, с заключительным
  // комментарием). Колонки те же, что у принудительного закрытия: новое
  // состояние было бы третьей правдой о том, что задача закрыта. Разница
  // только в словах — в хронике и в сообщении исполнителю, чтобы
  // «закрыта» не читалось как «работу приняли».
  let unfulfilled = false;
  if (action === "force") {
    const { data: reported } = await admin
      .from("task_participants")
      .select("id")
      .eq("task_id", task.id)
      .eq("role", "executor")
      .not("done_at", "is", null)
      .limit(1);
    unfulfilled = !reported?.length;
  }

  const now = new Date().toISOString();
  // Принято и закрыто — одно и то же событие, и записывается оно одной
  // строкой: «принял, но задача висит открытой» не значит ничего.
  const closed = { status: "done", completed_at: now, last_completed_on: now.slice(0, 10) };

  // Повторяющаяся задача принимается НА ЭТОТ КРУГ, а не навсегда.
  //
  // «Ежедневно спросить, как дела» после приёмки получала
  // approval_state = accepted, и это слово уже ничто не снимало: утром
  // браузер возвращал повтор в работу (refreshRecurringStatuses), а
  // «принято» оставалось. Дальше задача жила в двух состояниях сразу —
  // доска держала её в «Завершённых» с пометкой «сегодня», утренняя сводка
  // звала её просроченной по сроку первого дня, а напоминания приходили
  // по задаче, которой человек у себя не видел (отзыв Витовского,
  // 25.09.2026). Поэтому у повтора приёмка закрывает сегодняшний круг
  // (status done, last_completed_on — сегодня) и сразу готовит следующий:
  // приёмка снова открыта, отчёты этого круга сняты. Хроника и сообщение
  // исполнителю — как у обычной задачи: работу приняли, это событие.
  if (action === "approve" || action === "force") {
    const { data: row } = await admin.from("tasks").select("recur").eq("id", task.id).maybeSingle();
    const recur = (row as { recur?: string } | null)?.recur || "none";
    if (recur !== "none") {
      await admin
        .from("tasks")
        .update({ approval_state: "open", approval_comment: null, approved_at: null, force_closed_by: null, force_closed_reason: null, ...closed })
        .eq("id", task.id);
      await admin
        .from("task_participants")
        .update({ done_at: null, done_comment: null, done_files: [], declined_at: null, decline_reason: null })
        .eq("task_id", task.id)
        .eq("role", "executor");
      await recordEvent(admin, {
        actorUserId: who.userId,
        userId: task.user_id,
        kind: "task",
        itemId: task.id,
        text:
          action === "approve"
            ? `✅ ${who.label} принял работу за этот круг${text ? ": " + text : ""}`
            : `🔒 ${who.label} принудительно закрыл этот круг: ${text}`,
      });
      await tell(action, text);
      return { ok: true };
    }
  }

  if (action === "approve") {
    await admin
      .from("tasks")
      .update({ approval_state: "accepted", approval_comment: text || null, approved_at: now, ...closed })
      .eq("id", task.id);
  } else if (action === "return") {
    await admin.from("tasks").update({ approval_state: "returned", approval_comment: text, approved_at: null }).eq("id", task.id);
    // Отчёты И отказы обнуляются: иначе задача осталась бы «ответили все»,
    // и приёмка предложилась бы снова, ничего не изменив.
    //
    // Отказ попал сюда вместе с правилом «отказ — это ответ» (21.09.2026):
    // раз он уводит задачу на приёмку, то и возврат обязан его снимать —
    // иначе «Вернуть с объяснением» отправляло задачу ровно в тот же
    // тупик, из которого её пытались вывести, и кнопка выглядела
    // несработавшей. Возврат и значит «прежний ответ больше не в силе:
    // вот объяснение, попробуйте снова».
    await admin
      .from("task_participants")
      .update({ done_at: null, done_comment: null, done_files: [], declined_at: null, decline_reason: null })
      .eq("task_id", task.id)
      .eq("role", "executor");
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
    actorUserId: who.userId,
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
            : unfulfilled
              ? `🔒 ${who.label} закрыл задачу невыполненной: ${text}`
              : `🔒 ${who.label} принудительно закрыл задачу: ${text}`,
  });

  await tell(action, text, unfulfilled);
  return { ok: true };
}

// Сказать людям. Молчание после возврата на доработку — самый дорогой вид
// молчания здесь: работа стоит, и никто не знает, что она стоит.
async function tellExecutors(
  admin: SupabaseClient,
  task: { id: string; title: string; user_id: string },
  action: ReviewAction,
  comment: string,
  unfulfilled = false,
): Promise<void> {
  // Номер спрашивается здесь, а не у вызывающих: зовут сюда пять дверей
  // (трекер, бот, итог встречи…), и каждая знает задачу в своём объёме.
  const [{ data: parts }, { data: numRow }] = await Promise.all([
    admin.from("task_participants").select("assignee_id, role").eq("task_id", task.id).in("role", ["executor", "coexecutor"]),
    admin.from("tasks").select("number").eq("id", task.id).maybeSingle(),
  ]);
  const named = taskRef({ title: task.title, number: (numRow as { number?: number | null } | null)?.number ?? null });
  const ids = ((parts || []) as { assignee_id: string }[]).map((p) => p.assignee_id);
  if (!ids.length) return;

  const { data: people } = await admin.from("assignees").select("id, name, telegram_chat_id, max_user_id").in("id", ids);

  const text =
    action === "return"
      ? `↩ Вернули на доработку: ${named}\n\n${comment}`
      : action === "approve"
        ? `✅ Принято: ${named}${comment ? "\n\n" + comment : ""}`
        : action === "reopen"
          ? `🔄 Задачу открыли заново: ${named}${comment ? "\n\n" + comment : ""}`
          : `🔒 Задача закрыта${unfulfilled ? " невыполненной" : ""}: ${named}\n\n${comment}`;

  // Под возвратом — кнопки, которыми на него отвечают: сообщение, которым
  // задачу присылали, к этому моменту уже переписано, и отчитаться заново
  // было бы нечем. То же самое у заново открытой задачи: по ней снова
  // ждут отчёта. После приёмки ждать нечего — остаётся «Ответить».
  const buttons =
    action === "return" || action === "reopen" ? taskButtons(task.id, "executor") : replyButtons("task", task.id);

  // Через sendToPerson, а не по чату из строки человека: исполнителем
  // бывает и владелец, а его чат живёт не в этой строке, и рассылка,
  // написанная через chatsFor, для него молчала (см. lib/reach).
  // Всем исполнителям сразу, а не по очереди: приёмка задачи на четверых
  // ждала четыре отправки подряд, прежде чем окно закрывалось (07.10.2026).
  await Promise.all(
    ((people || []) as ColleagueRow[]).map((person) => sendToPerson(admin, task.user_id, person, text, buttons, { kind: "task", itemId: task.id })),
  );
  if (action === "approve" || action === "force") await tellUnblocked(admin, task, named);
}

// Задачи, которые ждали эту (миграция 0061), — их исполнителям «можно
// начинать». Ради этого зависимость и заводилась: исполнитель сметы узнаёт,
// что прайс готов, не из того, что заглянул в трекер, а сразу.
async function tellUnblocked(admin: SupabaseClient, task: { id: string; user_id: string }, named: string): Promise<void> {
  const { data: waiting } = await admin
    .from("tasks")
    .select("id, title, number, user_id")
    .eq("blocked_by", task.id)
    .neq("status", "done")
    .is("deleted_at", null);
  for (const w of (waiting || []) as { id: string; title: string; number: number | null; user_id: string }[]) {
    const { data: parts } = await admin.from("task_participants").select("assignee_id").eq("task_id", w.id).in("role", ["executor", "coexecutor"]);
    const ids = ((parts || []) as { assignee_id: string }[]).map((p) => p.assignee_id);
    if (!ids.length) continue;
    const { data: people } = await admin.from("assignees").select("id, name, telegram_chat_id, max_user_id").in("id", ids);
    const text = `🟢 Можно начинать: ${taskRef({ title: w.title, number: w.number })}\n\nЗадача, которую она ждала, закрыта: ${named}.`;
    await Promise.all(
      ((people || []) as ColleagueRow[]).map((person) => sendToPerson(admin, w.user_id, person, text, taskButtons(w.id, "executor"), { kind: "task", itemId: w.id })),
    );
  }
}
