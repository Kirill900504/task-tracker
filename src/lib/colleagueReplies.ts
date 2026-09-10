import type { SupabaseClient } from "@supabase/supabase-js";
import { fmtDate } from "@/lib/taskDisplay";
import type { CallbackAction } from "@/lib/colleagues";
import { findColleagueByChat } from "@/lib/colleagues";
import { uid } from "@/lib/uid";
import type { BotChannelConfig } from "@/lib/botTransport";

// What happens when a colleague presses a button under a task or a meeting.
//
// The button carries only an id, and every check happens here against the
// database: the chat has to belong to a colleague, that colleague has to be
// the person the item is actually addressed to, and the item has to belong
// to their owner. Nothing is taken from the message itself — a callback can
// be replayed or forged, an id is not a permission.
//
// Which messenger the press came from is passed in: the checks are the same
// in Telegram and in MAX, only the column that identifies the chat differs.

export type CallbackOutcome = {
  // Shown as a small toast on the button the person tapped, where the
  // messenger has toasts (MAX does not — see maxTransport).
  toast: string;
  // The message is rewritten to this, so the chat shows what happened
  // instead of buttons that no longer do anything.
  rewriteTo?: string;
  // The owner hears about it — in every messenger he is connected to, which
  // the caller resolves (see botDelivery.notifyOwner).
  notifyOwner?: string;
};

export function colleagueHelp(name: string): string {
  return (
    `${name}, сюда приходят задачи и встречи — отвечать можно кнопками под сообщением.\n\n` +
    "«🏁 Сделал» и «⛔ Не могу» после нажатия попросят одно сообщение: что именно сделано или почему не выйдет. " +
    "Оно уходит постановщику.\n\n" +
    "Просто написанное сообщение попадёт в обсуждение вашей последней открытой задачи — я скажу, какой именно.\n\n" +
    "Свои задачи здесь пока не заводятся."
  );
}

export async function handleColleagueCallback(
  admin: SupabaseClient,
  chatId: number,
  action: CallbackAction,
  channel: BotChannelConfig,
): Promise<CallbackOutcome> {
  const colleague = await findColleagueByChat(admin, chatId, channel);
  if (!colleague) return { toast: "Этот чат не подключён" };

  if (action.kind === "task") {
    const { data: task } = await admin
      .from("tasks")
      .select("id, title, assignee, user_id, status")
      .eq("id", action.id)
      .is("deleted_at", null)
      .maybeSingle();
    // Addressed to someone else, or belonging to another owner: the same
    // answer either way, so a stray id tells the presser nothing.
    if (!task || task.user_id !== colleague.user_id) return { toast: "Эта задача уже не ваша" };

    // Since a task can be shared, "is this yours" is a row in
    // task_participants — and, for everything created before that table
    // existed, still the name in tasks.assignee. Both are accepted: the
    // second is not legacy cruft, it is how a task with a single executor
    // is written to this day.
    const { data: part } = await admin
      .from("task_participants")
      .select("id, role, done_at")
      .eq("task_id", task.id)
      .eq("assignee_id", colleague.id)
      .maybeSingle();
    const participant = part as { id: string; role: string; done_at: string | null } | null;
    if (!participant && task.assignee !== colleague.name) return { toast: "Эта задача уже не ваша" };

    if (action.action === "acc") {
      if (participant) {
        await admin.from("task_participants").update({ accepted_at: new Date().toISOString() }).eq("id", participant.id);
      }
      // Written in both places while both exist: the card reads the task's
      // own accepted_at, and rewriting only one of the two would make the
      // screen and the messenger disagree about the same fact.
      await admin.from("tasks").update({ accepted_at: new Date().toISOString() }).eq("id", task.id);
      return {
        toast: "Принято",
        rewriteTo: `📋 ${task.title}\n\n✅ Принято в работу`,
        notifyOwner: `✅ ${colleague.name} принял в работу: «${task.title}»`,
      };
    }

    if (action.action === "done") {
      if (participant) {
        // done_comment stays empty on purpose: it is what the next message
        // from this person fills (see handleColleagueText). An unfinished
        // row IS the "waiting for a comment" state — no second table, and
        // nothing to clean up if he never answers.
        await admin
          .from("task_participants")
          .update({ done_at: new Date().toISOString(), done_comment: null, declined_at: null, decline_reason: null })
          .eq("id", participant.id);
        const closed = await closeIfEveryoneReported(admin, task.id);
        return {
          toast: "Отмечено",
          rewriteTo: `📋 ${task.title}\n\n🏁 Отмечено выполненным.\nНапишите одним сообщением, что именно сделано — это увидит постановщик.`,
          notifyOwner: closed
            ? `🏁 ${colleague.name} выполнил: «${task.title}» — отчитались все, задача ждёт вашей приёмки`
            : `🏁 ${colleague.name} выполнил свою часть: «${task.title}»`,
        };
      }

      // Один исполнитель, участников нет — прежнее поведение целиком.
      await admin
        .from("tasks")
        .update({ status: "done", completed_at: new Date().toISOString() })
        .eq("id", task.id);
      return {
        toast: "Отмечено выполненным",
        rewriteTo: `📋 ${task.title}\n\n🏁 Выполнено`,
        notifyOwner: `🏁 ${colleague.name} выполнил: «${task.title}»`,
      };
    }

    if (action.action === "no") {
      if (!participant) {
        // Отказаться от задачи, у которой нет строки участника, значит
        // отказаться неизвестно за кого — писать в саму задачу «не могу»
        // некуда, поэтому это остаётся сообщением постановщику.
        return {
          toast: "Передал",
          rewriteTo: `📋 ${task.title}\n\n⛔ Отмечено: не сможете\nНапишите одним сообщением, почему — это увидит постановщик.`,
          notifyOwner: `⛔ ${colleague.name} не может выполнить: «${task.title}»`,
        };
      }
      await admin
        .from("task_participants")
        .update({ declined_at: new Date().toISOString(), decline_reason: null, done_at: null, done_comment: null })
        .eq("id", participant.id);
      return {
        toast: "Передал",
        rewriteTo: `📋 ${task.title}\n\n⛔ Отмечено: не сможете\nНапишите одним сообщением, почему — это увидит постановщик.`,
        notifyOwner: `⛔ ${colleague.name} не может выполнить: «${task.title}»`,
      };
    }
  }

  if (action.kind === "meeting" && (action.action === "yes" || action.action === "no")) {
    const { data: meeting } = await admin
      .from("meetings")
      .select("id, title, date, time, participants, confirmed_by, user_id, vote_round")
      .eq("id", action.id)
      .is("deleted_at", null)
      .maybeSingle();
    const participants = (meeting?.participants as string[]) || [];
    if (!meeting || meeting.user_id !== colleague.user_id || !participants.includes(colleague.name)) {
      return { toast: "Эта встреча уже не ваша" };
    }

    const when = fmtDate(meeting.date as string) + (meeting.time ? ", " + meeting.time : "");
    const round = Number((meeting as { vote_round?: number }).vote_round ?? 1) || 1;
    const coming = action.action === "yes";

    // Ответ пишется в строку голосования — там же, где его ждёт карточка.
    // Раунд обязателен: ответ принадлежит тому времени, о котором спросили,
    // и после переноса он перестаёт считаться подтверждением сам собой.
    const { data: existing } = await admin
      .from("meeting_participants")
      .select("id")
      .eq("meeting_id", meeting.id)
      .eq("assignee_id", colleague.id)
      .maybeSingle();

    const patch = {
      response: coming ? "yes" : "no",
      reason: null,
      responded_at: new Date().toISOString(),
      round,
    };
    if (existing) await admin.from("meeting_participants").update(patch).eq("id", (existing as { id: string }).id);
    else await admin.from("meeting_participants").insert({ meeting_id: meeting.id, assignee_id: colleague.id, role: "participant", ...patch });

    // confirmed_by остаётся в согласии со строками, пока его кто-то читает.
    const confirmed = ((meeting.confirmed_by as string[]) || []).filter((n) => n !== colleague.name);
    await admin
      .from("meetings")
      .update({ confirmed_by: coming ? [...confirmed, colleague.name] : confirmed })
      .eq("id", meeting.id);

    if (coming) {
      return {
        toast: "Отметил, что будете",
        rewriteTo: `📅 ${meeting.title}\n${when}\n\n✅ Вы подтвердили участие`,
        notifyOwner: `✅ ${colleague.name} будет на встрече «${meeting.title}» (${when})`,
      };
    }
    return {
      toast: "Передал",
      rewriteTo: `📅 ${meeting.title}\n${when}\n\n❌ Вы не сможете\nНапишите одним сообщением, почему — это увидит организатор.`,
      notifyOwner: `❌ ${colleague.name} не сможет быть на встрече «${meeting.title}» (${when})`,
    };
  }

  if (action.kind === "idea" && action.action === "task") {
    const { data: idea } = await admin
      .from("ideas")
      .select("id, text, user_id")
      .eq("id", action.id)
      .is("deleted_at", null)
      .maybeSingle();
    if (!idea || idea.user_id !== colleague.user_id) return { toast: "Эта мысль уже не ваша" };

    // Мысль, взятая в работу, перестаёт быть мыслью. Задача заводится в
    // том же пространстве, с этим человеком исполнителем и без срока:
    // срок ставит тот, кто спросит, а не тот, кто взялся.
    const title = String(idea.text || "").trim().slice(0, 200) || "Из мысли";
    const taskId = uid();
    const { error: taskError } = await admin.from("tasks").insert({
      id: taskId,
      user_id: idea.user_id,
      title,
      assignee: colleague.name,
    });
    if (taskError) return { toast: "Не получилось завести задачу" };

    await admin.from("task_participants").insert({
      task_id: taskId,
      assignee_id: colleague.id,
      role: "executor",
      accepted_at: new Date().toISOString(),
    });
    await admin
      .from("idea_recipients")
      .update({ converted_task_id: taskId, seen_at: new Date().toISOString() })
      .eq("idea_id", idea.id)
      .eq("assignee_id", colleague.id);

    return {
      toast: "Завёл задачу",
      rewriteTo: `💡 ${title}\n\n➕ Взято в работу — теперь это ваша задача`,
      notifyOwner: `➕ ${colleague.name} взял мысль в работу: «${title}»`,
    };
  }

  return { toast: "Это действие больше не доступно" };
}

// Все ли исполнители отчитались — и если да, задача уходит на приёмку.
//
// Приёмка не закрывает задачу сама: B4 — «он отчитался» и «я проверил» это
// разные события, и второе принадлежит человеку, а не боту. Поэтому здесь
// выставляется только состояние ожидания, а `status` не трогается вовсе:
// им владеет синхронизация трекера, и запись мимо неё откатится первой же
// открытой вкладкой.
export async function closeIfEveryoneReported(admin: SupabaseClient, taskId: string): Promise<boolean> {
  const { data } = await admin.from("task_participants").select("role, done_at").eq("task_id", taskId);
  const executors = ((data as { role: string; done_at: string | null }[]) || []).filter((p) => p.role === "executor");
  if (!executors.length || executors.some((p) => !p.done_at)) return false;
  await admin.from("tasks").update({ approval_state: "awaiting_review" }).eq("id", taskId);
  return true;
}

// Сообщение от коллеги, когда с него ждут комментарий или причину.
//
// The pending state is not stored anywhere separately: a row with done_at
// and no comment, or declined_at and no reason, IS the question waiting for
// an answer. That keeps the flow to one table and means an unanswered
// question simply shows up in the tracker as «сделал (без комментария)» —
// visible, rather than lost in a queue somebody has to remember to drain.
export async function handleColleagueText(
  admin: SupabaseClient,
  colleague: { id: string; name: string; user_id: string },
  text: string,
  // Из какого мессенджера пришло: в обсуждении это видно строкой «из
  // Telegram», и подменять её на другую значит врать в записи.
  source: "telegram" | "max" = "telegram",
): Promise<{ reply: string; notifyOwner?: string } | null> {
  const body = text.trim();
  if (!body) return null;

  const { data } = await admin
    .from("task_participants")
    .select("id, task_id, done_at, done_comment, declined_at, decline_reason, tasks(title)")
    .eq("assignee_id", colleague.id)
    .eq("user_id", colleague.user_id);

  type Row = {
    id: string;
    task_id: string;
    done_at: string | null;
    done_comment: string | null;
    declined_at: string | null;
    decline_reason: string | null;
    tasks: { title: string } | { title: string }[] | null;
  };

  const rows = ((data as Row[]) || []).filter(
    (r) => (r.done_at && !r.done_comment) || (r.declined_at && !r.decline_reason),
  );

  // Причина отказа от встречи ждёт ответа ровно так же — незаполненная
  // строка и есть заданный вопрос.
  if (!rows.length) return (await handleMeetingReason(admin, colleague, body)) ?? handleChatMessage(admin, colleague, body, source);

  // Самая свежая: человек отвечает на то, что нажал только что.
  rows.sort((a, b) => Date.parse(b.done_at || b.declined_at || "") - Date.parse(a.done_at || a.declined_at || ""));
  const row = rows[0];
  const title = Array.isArray(row.tasks) ? row.tasks[0]?.title || "" : row.tasks?.title || "";

  if (row.done_at && !row.done_comment) {
    await admin.from("task_participants").update({ done_comment: body }).eq("id", row.id);
    return {
      reply: `Записал по задаче «${title}»: ${body}`,
      notifyOwner: `🏁 ${colleague.name} по задаче «${title}»: ${body}`,
    };
  }

  await admin.from("task_participants").update({ decline_reason: body }).eq("id", row.id);
  return {
    reply: `Записал: не сможете «${title}» — ${body}`,
    notifyOwner: `⛔ ${colleague.name} не может «${title}»: ${body}`,
  };
}


// Причина, по которой человек не придёт на встречу.
//
// Отдельная функция, а не ещё одна ветка выше: у задач и встреч разные
// таблицы и разные слова, а общий у них только приём — вопрос хранится
// как незаполненное поле, а не как запись в очереди.
async function handleMeetingReason(
  admin: SupabaseClient,
  colleague: { id: string; name: string; user_id: string },
  body: string,
): Promise<{ reply: string; notifyOwner?: string } | null> {
  const { data } = await admin
    .from("meeting_participants")
    .select("id, response, reason, responded_at, meetings(title, date, time)")
    .eq("assignee_id", colleague.id)
    .eq("user_id", colleague.user_id)
    .eq("response", "no")
    .is("reason", null);

  type Row = {
    id: string;
    responded_at: string | null;
    meetings: { title: string; date: string; time: string | null } | { title: string; date: string; time: string | null }[] | null;
  };

  const rows = ((data as Row[]) || []).slice();
  if (!rows.length) return null;
  rows.sort((a, b) => Date.parse(b.responded_at || "") - Date.parse(a.responded_at || ""));
  const row = rows[0];
  const m = Array.isArray(row.meetings) ? row.meetings[0] : row.meetings;
  const title = m?.title || "";
  const when = m ? fmtDate(m.date) + (m.time ? ", " + m.time : "") : "";

  await admin.from("meeting_participants").update({ reason: body }).eq("id", row.id);
  return {
    reply: `Записал: не будете на «${title}» — ${body}`,
    notifyOwner: `❌ ${colleague.name} не придёт на «${title}» (${when}): ${body}`,
  };
}


// Сообщение, которое никуда не отвечает, попадает в обсуждение задачи.
//
// Отвечать из мессенджера обязательно: руководитель вне офиса иначе
// выпадает из разговора о собственной задаче, а разговор уходит туда, где
// его никто потом не найдёт. Какой именно задачи — определяется по самой
// свежей открытой, и в ответе прямо называется: угадывание, о котором
// сказали вслух, человек поправит сам следующим сообщением.
async function handleChatMessage(
  admin: SupabaseClient,
  colleague: { id: string; name: string; user_id: string },
  body: string,
  source: "telegram" | "max",
): Promise<{ reply: string; notifyOwner?: string } | null> {
  const { data } = await admin
    .from("task_participants")
    .select("task_id, created_at, tasks(title, status, deleted_at)")
    .eq("assignee_id", colleague.id)
    .eq("user_id", colleague.user_id)
    .order("created_at", { ascending: false })
    .limit(10);

  type Row = {
    task_id: string;
    created_at: string;
    tasks: { title: string; status: string | null; deleted_at: string | null } | { title: string; status: string | null; deleted_at: string | null }[] | null;
  };

  const rows = ((data as Row[]) || []).map((r) => ({
    taskId: r.task_id,
    task: Array.isArray(r.tasks) ? r.tasks[0] : r.tasks,
  }));
  const open = rows.find((r) => r.task && !r.task.deleted_at && r.task.status !== "done");
  if (!open || !open.task) return null;

  // Первое сообщение в обсуждении уходит владельцу сразу, остальные —
  // копятся и попадают в утреннюю сводку. Четырнадцать человек, каждый со
  // своей перепиской по каждой задаче, иначе превращают мессенджер в
  // ленту, которую перестают читать целиком — вместе со «сделал» и
  // «не могу», ради которых всё и затевалось.
  //
  // «Первое» считается по паузе, а не по счётчику: разговор, возобновлённый
  // через два часа, — это новый разговор, и о нём стоит знать.
  const { data: previous } = await admin
    .from("item_comments")
    .select("created_at")
    .eq("item_kind", "task")
    .eq("item_id", open.taskId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(1);

  const last = (previous as { created_at: string }[] | null)?.[0]?.created_at;
  const QUIET_GAP_MS = 2 * 60 * 60 * 1000;
  const isNewConversation = !last || Date.now() - Date.parse(last) > QUIET_GAP_MS;

  await admin.from("item_comments").insert({
    item_kind: "task",
    item_id: open.taskId,
    body,
    author_assignee_id: colleague.id,
    source,
  });

  return {
    reply: `Записал в обсуждение задачи «${open.task.title}».`,
    notifyOwner: isNewConversation ? `💬 ${colleague.name} по задаче «${open.task.title}»: ${body}` : undefined,
  };
}
