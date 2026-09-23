import type { SupabaseClient } from "@supabase/supabase-js";
import { fmtDate } from "@/lib/taskDisplay";
import type { CallbackAction } from "@/lib/colleagues";
import { findColleagueByChat, meetingButtons, rescheduleButtons, RESCHEDULE_OPTIONS } from "@/lib/colleagues";
import { uid } from "@/lib/uid";
import { recordEvent } from "@/lib/itemHistory";
import { newTaskRow } from "@/lib/newTask";
import { deliverComment } from "@/lib/commentDelivery";
import { confirmIfEveryoneAgreed } from "@/lib/meetingConfirm";
import { colleagueCommandsHelp, matchColleagueCommand, meetingCard, meetingRoster, replyForColleague, taskCard } from "@/lib/colleagueQueries";
import type { ColleagueQuery } from "@/lib/colleagueQueries";
import type { BotButton, BotChannelConfig } from "@/lib/botTransport";
import type { Notice } from "@/lib/noticeQueue";

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
  // Чем заменить кнопки. Пусто — снять совсем; для ответа на встречу они,
  // наоборот, обязаны остаться: передумать можно до начала.
  rewriteButtons?: BotButton[][];
  // Отдельным сообщением вслед, не вместо. Нужно там, где нажатие ничего в
  // задаче не изменило и переписывать сообщение не за что, а сказать надо —
  // «Ответить», список задач, открытая карточка. В MAX это ещё и
  // единственный способ: всплывающих подсказок там нет, и toast не
  // показывается никому.
  say?: string;
  sayButtons?: BotButton[][];
  // The owner hears about it — in every messenger he is connected to, which
  // the caller resolves (see botDelivery.notifyOwner).
  notifyOwner?: string;
  // Кому именно. Пусто — владельцу; иначе тому, кто поручил (его id из
  // created_by). Кнопка в мессенджере и кнопка на экране руководителя
  // обязаны делать одно и то же, а /api/workspace/report уже адресует
  // ответ постановщику.
  notifyTo?: string | null;
  // Вид события для сводки: с ним строка ляжет в очередь и выйдет одним
  // письмом вместе с соседними, а не отдельным сообщением в ленту.
  notice?: Notice;
};

// Ответ бота на сообщение коллеги. Кнопки здесь потому же, почему они есть
// под задачей: список без кнопок — это отчёт о том, сколько накопилось, а
// не то, из чего можно ответить.
export type ColleagueTextResult = {
  reply: string;
  buttons?: BotButton[][];
  notifyOwner?: string;
  notifyTo?: string | null;
  notice?: Notice;
};

// Куда направлен следующий текст этого человека.
//
// Намерение живёт два часа (миграция 0028) и только до первого сообщения:
// нажал, отвлёкся, написал совсем о другом — и это «другое» должно попасть
// туда же, куда попало бы без нажатия, а не в задачу, о которой он уже
// забыл.
const AIM_LIFETIME_MS = 2 * 60 * 60 * 1000;

async function aimReply(
  admin: SupabaseClient,
  colleague: { id: string; name: string; user_id: string },
  kind: "task" | "meeting",
  itemId: string,
): Promise<CallbackOutcome> {
  const table = kind === "task" ? "tasks" : "meetings";
  const { data } = await admin
    .from(table)
    .select("id, title, user_id")
    .eq("id", itemId)
    .is("deleted_at", null)
    .maybeSingle();
  const item = data as { id: string; title: string; user_id: string } | null;
  if (!item || item.user_id !== colleague.user_id) return { toast: "Это обсуждение уже не ваше" };

  await admin
    .from("assignees")
    .update({ pending_reply_kind: kind, pending_reply_id: itemId, pending_reply_at: new Date().toISOString() })
    .eq("id", colleague.id);

  // Сообщение не переписывается: под ним остаются кнопки задачи, и человек,
  // передумавший писать, ничего не теряет.
  return {
    toast: "Пишите — отправлю в обсуждение",
    say: `💬 Следующее сообщение уйдёт в обсуждение ${kind === "task" ? "задачи" : "встречи"} «${item.title}».\nЕго увидят все участники.`,
  };
}

// Не остыло ли намерение. Заодно снимает его: направление действует на одно
// сообщение, иначе человек, ответивший однажды, писал бы в ту же задачу до
// скончания века.
async function takeAim(
  admin: SupabaseClient,
  colleagueId: string,
): Promise<{ kind: "task" | "meeting"; id: string } | null> {
  const { data } = await admin
    .from("assignees")
    .select("pending_reply_kind, pending_reply_id, pending_reply_at")
    .eq("id", colleagueId)
    .maybeSingle();
  const row = data as { pending_reply_kind: "task" | "meeting" | null; pending_reply_id: string | null; pending_reply_at: string | null } | null;
  if (!row?.pending_reply_kind || !row.pending_reply_id) return null;

  await admin
    .from("assignees")
    .update({ pending_reply_kind: null, pending_reply_id: null, pending_reply_at: null })
    .eq("id", colleagueId);

  const at = Date.parse(row.pending_reply_at || "");
  if (!at || Date.now() - at > AIM_LIFETIME_MS) return null;
  return { kind: row.pending_reply_kind, id: row.pending_reply_id };
}

// Справка — одна на весь бот, и живёт она там же, где команды, о которых
// рассказывает (colleagueQueries): две справки разошлись бы в первый же
// раз, когда команду добавят.
export function colleagueHelp(name: string): string {
  return colleagueCommandsHelp(name);
}

// Какой список просит кнопка. Вид встречи всегда означает встречи —
// у них подвидов нет; у задач подвид несёт третье поле. Незнакомое слово
// падает в «мои задачи», а не в ошибку: кнопка из старого сообщения,
// уехавшего вверх, должна открывать хоть что-то.
function listView(action: CallbackAction): ColleagueQuery {
  if (action.kind === "meeting") return "meetings";
  const known: ColleagueQuery[] = ["today", "overdue", "review", "menu", "help"];
  return known.find((v) => v === action.id) ?? "tasks";
}

export async function handleColleagueCallback(
  admin: SupabaseClient,
  chatId: number,
  action: CallbackAction,
  channel: BotChannelConfig,
): Promise<CallbackOutcome> {
  const colleague = await findColleagueByChat(admin, chatId, channel);
  if (!colleague) return { toast: "Этот чат не подключён" };

  // «Ответить» ничего не меняет в задаче — оно только направляет следующее
  // сообщение. Поэтому стоит до всех проверок состояния: ответить можно и
  // по закрытой задаче, и по той, где ты наблюдатель.
  if (action.action === "msg" && (action.kind === "task" || action.kind === "meeting")) {
    return aimReply(admin, colleague, action.kind, action.id);
  }

  // Списки и карточки — чтение. Они тоже ничего не меняют, поэтому идут
  // рядом с «Ответить», а не среди действий. Именно из-за их отсутствия
  // кнопка жила только под тем сообщением, которым задачу прислали: стоило
  // переписке уехать вверх — и ответить было нечем.
  if (action.action === "list") {
    const today = new Date().toISOString().slice(0, 10);
    // Третье поле кнопки — какой именно список. Раньше оно не читалось
    // вовсе: списков было два, задачи и встречи, и вид угадывался по виду
    // кнопки. Меню (lib/botMenu) спрашивает «сегодня», «просрочено», «на
    // приёмке» — выборки, которые давно написаны и до которых не было
    // кнопки.
    const reply = await replyForColleague(admin, colleague, listView(action), today);
    return { toast: "Открываю", say: reply.text, sayButtons: reply.buttons };
  }

  if (action.action === "show") {
    const today = new Date().toISOString().slice(0, 10);
    const card =
      action.kind === "meeting"
        ? await meetingCard(admin, colleague, action.id)
        : await taskCard(admin, colleague, action.id, today);
    if (!card) return { toast: action.kind === "meeting" ? "Эта встреча уже не ваша" : "Эта задача уже не ваша" };
    return { toast: "Открываю", say: card.text, sayButtons: card.buttons };
  }

  if (action.kind === "task") {
    const { data: task } = await admin
      .from("tasks")
      .select("id, title, assignee, user_id, status, created_by")
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

    // Роль проверяется здесь, а не только при отправке: кнопка могла
    // прийти раньше, чем человека перевели в наблюдатели, а нажатие живёт
    // в сообщении сколько угодно.
    if (participant && participant.role === "watcher") {
      return { toast: "Вы на этой задаче наблюдатель — отвечать не нужно" };
    }

    if (action.action === "acc") {
      if (participant) {
        await admin.from("task_participants").update({ accepted_at: new Date().toISOString() }).eq("id", participant.id);
      }
      // Written in both places while both exist: the card reads the task's
      // own accepted_at, and rewriting only one of the two would make the
      // screen and the messenger disagree about the same fact.
      await admin.from("tasks").update({ accepted_at: new Date().toISOString() }).eq("id", task.id);
      await recordEvent(admin, {
        userId: task.user_id,
        kind: "task",
        itemId: task.id,
        text: `✅ ${colleague.name} принял в работу`,
      });
      return {
        toast: "Принято",
        rewriteTo: `📋 ${task.title}\n\n✅ Принято в работу`,
        notifyTo: task.created_by,
        notifyOwner: `✅ ${colleague.name} принял в работу: «${task.title}»`,
        notice: { kind: "accepted", item: task.title, who: colleague.name },
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
          notifyTo: task.created_by,
          notice: { kind: closed ? "reported_all" : "reported", item: task.title, who: colleague.name },
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
      await recordEvent(admin, {
        userId: task.user_id,
        kind: "task",
        itemId: task.id,
        text: `🏁 ${colleague.name} отметил выполненной`,
      });
      return {
        toast: "Отмечено выполненным",
        rewriteTo: `📋 ${task.title}\n\n🏁 Выполнено`,
        notifyTo: task.created_by,
        notifyOwner: `🏁 ${colleague.name} выполнил: «${task.title}»`,
        notice: { kind: "reported_all", item: task.title, who: colleague.name },
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
          notifyTo: task.created_by,
          notifyOwner: `⛔ ${colleague.name} не может выполнить: «${task.title}»`,
          notice: { kind: "declined", item: task.title, who: colleague.name },
        };
      }
      await admin
        .from("task_participants")
        .update({ declined_at: new Date().toISOString(), decline_reason: null, done_at: null, done_comment: null })
        .eq("id", participant.id);
      // Отказ — ответ, и задача после него ждёт постановщика: то же, что
      // делает кнопка «Не могу» в трекере (см. api/workspace/report). Две
      // двери в одно действие обязаны оставлять задачу в одном состоянии —
      // иначе отказ из мессенджера двигал бы её, а отказ из трекера нет.
      const answered = await closeIfEveryoneReported(admin, task.id);
      return {
        toast: "Передал",
        rewriteTo: `📋 ${task.title}\n\n⛔ Отмечено: не сможете\nНапишите одним сообщением, почему — это увидит постановщик.`,
        notifyTo: task.created_by,
        notifyOwner: answered
          ? `⛔ ${colleague.name} не может выполнить: «${task.title}» — ответили все, задача ждёт вашего решения`
          : `⛔ ${colleague.name} не может выполнить: «${task.title}»`,
        notice: { kind: "declined", item: task.title, who: colleague.name },
      };
    }

    // «Прошу перенос»: сперва на сколько, потом почему.
    //
    // Два шага, а не один, потому что срок и причина — разные вещи, и
    // спрошенные вместе они приходят одной фразой, из которой дату
    // пришлось бы вытаскивать моделью. Кнопки отвечают на «насколько»
    // точно и бесплатно.
    if (action.action === "mv") {
      if (!participant) return { toast: "Эта задача уже не ваша" };
      return {
        toast: "На сколько перенести?",
        say: `📅 На сколько перенести «${task.title}»?\nПосле выбора напишите, что мешает успеть — без причины это не просьба, а просто новая дата.`,
        sayButtons: rescheduleButtons(task.id),
      };
    }

    const shift = RESCHEDULE_OPTIONS.find((o) => action.action === "mv" + o.days);
    if (shift) {
      if (!participant) return { toast: "Эта задача уже не ваша" };
      // Считается от сегодняшнего дня, а не от прежнего срока: просьба
      // «на неделю» у просроченной задачи означает неделю от сегодня, а не
      // неделю от даты, которая уже прошла.
      const to = new Date();
      to.setDate(to.getDate() + shift.days);
      const date = to.toISOString().slice(0, 10);
      // Незаполненная причина при заполненном reschedule_requested_at и
      // есть заданный вопрос — тот же приём, что у «Сделал» и «Не могу».
      await admin
        .from("task_participants")
        .update({ reschedule_requested_at: new Date().toISOString(), reschedule_to: date, reschedule_reason: null })
        .eq("id", participant.id);
      return {
        toast: "Записал дату",
        say: `📅 Прошу перенести «${task.title}» на ${fmtDate(date)}.\nНапишите одним сообщением, что мешает успеть — это увидит постановщик, и решение за ним.`,
      };
    }
  }

  if (action.kind === "meeting" && (action.action === "yes" || action.action === "no" || action.action === "late")) {
    const { data: meeting } = await admin
      .from("meetings")
      .select("id, title, date, time, participants, confirmed_by, user_id, vote_round, created_by")
      .eq("id", action.id)
      .is("deleted_at", null)
      .maybeSingle();
    const participants = (meeting?.participants as string[]) || [];
    if (!meeting || meeting.user_id !== colleague.user_id || !participants.includes(colleague.name)) {
      return { toast: "Эта встреча уже не ваша" };
    }

    const when = fmtDate(meeting.date as string) + (meeting.time ? ", " + meeting.time : "");
    const round = Number((meeting as { vote_round?: number }).vote_round ?? 1) || 1;
    // Опоздавший — это пришедший: встречу из-за него не переносят и кворум
    // он не ломает (см. миграцию 0029). Поэтому для подсчёта он «yes», а то,
    // что он придёт позже, живёт отдельной колонкой.
    const late = action.action === "late";
    const coming = action.action === "yes" || late;

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
      late,
    };
    if (existing) await admin.from("meeting_participants").update(patch).eq("id", (existing as { id: string }).id);
    else await admin.from("meeting_participants").insert({ meeting_id: meeting.id, assignee_id: colleague.id, role: "participant", ...patch });

    await recordEvent(admin, {
      userId: meeting.user_id,
      kind: "meeting",
      itemId: meeting.id,
      text: late ? `🕐 ${colleague.name} будет, но опоздает` : coming ? `✅ ${colleague.name} будет` : `❌ ${colleague.name} не сможет`,
    });

    // confirmed_by остаётся в согласии со строками, пока его кто-то читает.
    const confirmed = ((meeting.confirmed_by as string[]) || []).filter((n) => n !== colleague.name);
    await admin
      .from("meetings")
      .update({ confirmed_by: coming ? [...confirmed, colleague.name] : confirmed })
      .eq("id", meeting.id);

    // Предложение, на которое согласились все, становится встречей само.
    // Правило общее с трекером (lib/meetingConfirm): ответить «буду» можно
    // и кнопкой в мессенджере, и в карточке, а встреча от этого должна
    // появляться одинаково.
    const scheduled = coming ? (await confirmIfEveryoneAgreed(admin, meeting.id as string)).confirmed : false;

    if (coming) {
      return {
        toast: scheduled ? "Все согласились — встреча назначена" : late ? "Отметил, что опоздаете" : "Отметил, что будете",
        rewriteTo:
          `📅 ${meeting.title}\n${when}\n\n` +
          (late ? "🕐 Вы придёте, но опоздаете" : "✅ Вы подтвердили участие") +
          (scheduled ? "\nВсе ответили — встреча назначена." : "") +
          "\nПередумали? Нажмите другую кнопку — ответ можно менять до начала.",
        // Кнопки остаются: «передумать можно до начала» — решение проекта, и
        // без них оно не действует.
        rewriteButtons: meetingButtons(meeting.id as string),
        notifyTo: meeting.created_by,
        notice: { kind: late ? "vote_late" : "vote_yes", item: meeting.title as string, who: colleague.name, what: when },
        notifyOwner: late
          ? `🕐 ${colleague.name} будет на встрече «${meeting.title}» (${when}), но опоздает`
          : `✅ ${colleague.name} будет на встрече «${meeting.title}» (${when})`,
      };
    }
    // Организатору сразу говорится и то, что причины пока нет: иначе
    // «не сможет» без объяснения выглядит как весь ответ целиком, и он либо
    // идёт спрашивать сам, либо не спрашивает вовсе. Причина придёт вторым
    // сообщением, а если человек промолчит — его спросят ещё раз вместе с
    // напоминанием о встрече (см. cron/reminders).
    return {
      toast: "Передал. Напишите, почему",
      rewriteTo:
        `📅 ${meeting.title}\n${when}\n\n❌ Вы не сможете\n` +
        "Напишите одним сообщением, почему — это увидит организатор.\n" +
        "Передумали? Нажмите другую кнопку — ответ можно менять до начала.",
      rewriteButtons: meetingButtons(meeting.id as string),
      notifyTo: meeting.created_by,
      notifyOwner: `❌ ${colleague.name} не сможет быть на встрече «${meeting.title}» (${when})\nСпросил, почему — пришлю, как ответит.`,
      notice: { kind: "vote_no", item: meeting.title as string, who: colleague.name, what: `${when} — причину спросил` },
    };
  }

  // «Кто идёт» — тот же расклад, что видит карточка в трекере.
  if (action.kind === "meeting" && action.action === "who") {
    const roster = await meetingRoster(admin, colleague, action.id);
    if (!roster) return { toast: "Эта встреча уже не ваша" };
    return { toast: "Показываю", say: roster, sayButtons: meetingButtons(action.id) };
  }

  if (action.kind === "idea" && action.action === "task") {
    const { data: idea } = await admin
      .from("ideas")
      .select("id, text, user_id, created_by")
      .eq("id", action.id)
      .is("deleted_at", null)
      .maybeSingle();
    if (!idea || idea.user_id !== colleague.user_id) return { toast: "Эта мысль уже не ваша" };

    // Мысль, взятая в работу, перестаёт быть мыслью. Задача заводится в
    // том же пространстве, с этим человеком исполнителем и без срока:
    // срок ставит тот, кто спросит, а не тот, кто взялся.
    const title = String(idea.text || "").trim().slice(0, 200) || "Из мысли";
    const taskId = uid();
    const { error: taskError } = await admin
      .from("tasks")
      .insert(newTaskRow({ id: taskId, userId: idea.user_id, title, assignee: colleague.name }));
    if (taskError) return { toast: "Не получилось завести задачу" };

    // upsert, а не insert: имя исполнителя стоит в самой задаче, и строку
    // по нему успевает завести триггер (миграция 0024) — простая вставка
    // тут же упёрлась бы в уникальность и оставила задачу без отметки
    // «принял», хотя человек её именно что взял.
    await admin.from("task_participants").upsert(
      {
        task_id: taskId,
        assignee_id: colleague.id,
        role: "executor",
        accepted_at: new Date().toISOString(),
      },
      { onConflict: "task_id,assignee_id" },
    );
    await admin
      .from("idea_recipients")
      .update({ converted_task_id: taskId, seen_at: new Date().toISOString() })
      .eq("idea_id", idea.id)
      .eq("assignee_id", colleague.id);

    return {
      toast: "Завёл задачу",
      rewriteTo: `💡 ${title}\n\n➕ Взято в работу — теперь это ваша задача`,
      notifyTo: idea.created_by,
      notifyOwner: `➕ ${colleague.name} взял мысль в работу: «${title}»`,
      notice: { kind: "idea_taken", item: title, who: colleague.name },
    };
  }

  return { toast: "Это действие больше не доступно" };
}

// Все ли исполнители ОТВЕТИЛИ — и если да, задача уходит на приёмку.
//
// Ответ — это отчёт ИЛИ отказ. Слова Кирилла 21.09.2026: «после отказа
// задача не переносится „на приёмку“». Он прав, и дело не в столбце: пока
// отказ не считался ответом, задача оставалась в состоянии «ждём
// исполнителя» — а ждать было некого, человек уже сказал «не могу» и ждал
// решения. Принимать в таком случае нечего, но решать есть что: вернуть с
// объяснением, перенести срок, отдать другому или закрыть волевым
// решением. Всё это — приёмка, то есть слово постановщика.
//
// Приёмка не закрывает задачу сама: B4 — «он отчитался» и «я проверил» это
// разные события, и второе принадлежит человеку, а не боту. Поэтому здесь
// выставляется только состояние ожидания, а `status` не трогается вовсе:
// им владеет синхронизация трекера, и запись мимо неё откатится первой же
// открытой вкладкой.
//
// То же правило живёт в браузере (taskProgress.allAnswered → lib/kanban), и
// обе половины обязаны говорить одно: разойдись они — карточка стояла бы в
// «На приёмке», а approval_state молчал бы, и утренняя сводка постановщика
// об этой задаче не сказала бы ничего.
export async function closeIfEveryoneReported(admin: SupabaseClient, taskId: string): Promise<boolean> {
  const { data } = await admin
    .from("task_participants")
    .select("role, done_at, declined_at")
    .eq("task_id", taskId);
  type Row = { role: string; done_at: string | null; declined_at: string | null };
  const executors = ((data as Row[]) || []).filter((p) => p.role === "executor");
  // Отказ, отменённый собственным отчётом, отказом больше не считается —
  // то же правило, что в hasDeclined: отчёт новее.
  const answered = (p: Row) => !!p.done_at || !!p.declined_at;
  if (!executors.length || executors.some((p) => !answered(p))) return false;
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
  // Может ли этот человек поручать. У руководителя свободный текст — это
  // поручение, как у владельца, а не реплика: чтобы написать в обсуждение,
  // он нажимает «Ответить». У коллеги без входа в трекер наоборот —
  // поручать ему нечего, и его слова идут в обсуждение.
  //
  // Развести это обязательно: иначе фраза «поручи Игорю смету» от
  // руководителя молча ложилась бы репликой в последнюю открытую задачу.
  canDictate = false,
): Promise<ColleagueTextResult | null> {
  const body = text.trim();
  if (!body) return null;

  const { data } = await admin
    .from("task_participants")
    .select(
      "id, task_id, done_at, done_comment, declined_at, decline_reason, " +
        "reschedule_requested_at, reschedule_to, reschedule_reason, tasks(title, created_by)",
    )
    .eq("assignee_id", colleague.id)
    .eq("user_id", colleague.user_id);

  type Row = {
    id: string;
    task_id: string;
    done_at: string | null;
    done_comment: string | null;
    declined_at: string | null;
    decline_reason: string | null;
    reschedule_requested_at: string | null;
    reschedule_to: string | null;
    reschedule_reason: string | null;
    tasks: { title: string; created_by: string | null } | { title: string; created_by: string | null }[] | null;
  };

  const rows = ((data as unknown as Row[]) || []).filter(
    (r) =>
      (r.done_at && !r.done_comment) ||
      (r.declined_at && !r.decline_reason) ||
      (r.reschedule_requested_at && !r.reschedule_reason),
  );

  // Нажатое «Ответить» сильнее незакрытого вопроса: человек только что
  // указал пальцем, куда пишет, и спорить с этим значит снова угадывать.
  const aim = await takeAim(admin, colleague.id);
  if (aim) return writeToDiscussion(admin, colleague, aim.kind, aim.id, body, source);

  // Команда — это то, что человек пишет, когда его ни о чём не спрашивали.
  // Порядок здесь и есть всё правило: сперва незакрытый вопрос (отчёт,
  // причина), потом указанный пальцем адрес, и только потом слово-команда.
  // Иначе «сегодня», написанное в ответ на «что именно сделано?», уехало бы
  // списком дел, а человек остался бы с отчётом без единого слова —
  // уверенный, что отчитался.
  const command = matchColleagueCommand(body);
  if (!rows.length && command) {
    const today = new Date().toISOString().slice(0, 10);
    const answer = await replyForColleague(admin, colleague, command, today);
    return { reply: answer.text, buttons: answer.buttons };
  }

  // Причина отказа от встречи ждёт ответа ровно так же — незаполненная
  // строка и есть заданный вопрос.
  if (!rows.length) {
    const meetingReason = await handleMeetingReason(admin, colleague, body);
    if (meetingReason) return meetingReason;
    // Угадывание обсуждения — только для тех, кто поручать не может.
    return canDictate ? null : handleChatMessage(admin, colleague, body, source);
  }

  // Самая свежая: человек отвечает на то, что нажал только что.
  const askedAt = (r: Row) => Date.parse(r.done_at || r.declined_at || r.reschedule_requested_at || "") || 0;
  rows.sort((a, b) => askedAt(b) - askedAt(a));
  const row = rows[0];
  const taskRef = Array.isArray(row.tasks) ? row.tasks[0] : row.tasks;
  const title = taskRef?.title || "";

  if (row.reschedule_requested_at && !row.reschedule_reason) {
    await admin.from("task_participants").update({ reschedule_reason: body }).eq("id", row.id);
    const to = row.reschedule_to ? ` на ${fmtDate(row.reschedule_to)}` : "";
    await recordEvent(admin, {
      userId: colleague.user_id,
      kind: "task",
      itemId: row.task_id,
      text: `📅 ${colleague.name} просит перенос${to}: ${body}`,
    });
    return {
      reply: `Передал: просите перенести «${title}»${to} — ${body}.\nСрок двигает постановщик, я скажу, когда он ответит.`,
      notifyTo: taskRef?.created_by ?? null,
      notifyOwner: `📅 ${colleague.name} просит перенести «${title}»${to}: ${body}`,
      notice: { kind: "reschedule", item: title, who: colleague.name, what: `${to.trim() || "на другой срок"} — ${body}` },
    };
  }

  if (row.done_at && !row.done_comment) {
    await admin.from("task_participants").update({ done_comment: body }).eq("id", row.id);
    // Отчёт словами — самое ценное в хронике: именно его стирает возврат на
    // доработку, и именно его потом ищут.
    await recordEvent(admin, {
      userId: colleague.user_id,
      kind: "task",
      itemId: row.task_id,
      text: `🏁 ${colleague.name} отчитался: ${body}`,
    });
    return {
      reply: `Записал по задаче «${title}»: ${body}`,
      notifyTo: taskRef?.created_by ?? null,
      notifyOwner: `🏁 ${colleague.name} по задаче «${title}»: ${body}`,
      notice: { kind: "reported", item: title, who: colleague.name, what: body },
    };
  }

  await admin.from("task_participants").update({ decline_reason: body }).eq("id", row.id);
  await recordEvent(admin, {
    userId: colleague.user_id,
    kind: "task",
    itemId: row.task_id,
    text: `⛔ ${colleague.name} не может: ${body}`,
  });
  return {
    reply: `Записал: не сможете «${title}» — ${body}`,
    notifyTo: taskRef?.created_by ?? null,
    notifyOwner: `⛔ ${colleague.name} не может «${title}»: ${body}`,
    notice: { kind: "declined", item: title, who: colleague.name, what: body },
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
): Promise<ColleagueTextResult | null> {
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
    notice: { kind: "vote_no", item: title, who: colleague.name, what: body },
  };
}


// Фотография или документ из мессенджера — в обсуждение той же задачи.
//
// В трекере файлы у обсуждения были с самого начала (миграция 0020), а из
// мессенджера не доходили вовсе: вебхук читал только текст и голос. При
// этом «покажи, что сделал» на практике означает именно фотографию, и она
// пропадала молча — человек был уверен, что показал.
//
// Адресуется так же, как текст: нажатое «Ответить» сильнее, иначе самая
// свежая открытая задача. Подпись под фотографией становится сообщением;
// без подписи остаётся один файл, и `commentText` скажет «📎 файл» вместо
// пустой строки.
export async function handleColleagueFile(
  admin: SupabaseClient,
  colleague: { id: string; name: string; user_id: string },
  file: { bytes: ArrayBuffer; name: string; type: string },
  caption: string,
  source: "telegram" | "max",
): Promise<ColleagueTextResult | null> {
  const aim = await takeAim(admin, colleague.id);
  const target = aim ?? (await guessOpenTask(admin, colleague));
  if (!target) return null;

  // Путь начинается с пространства: по первому сегменту права корзины и
  // решают, чей это файл (миграция 0020).
  const safe = file.name.replace(/[^\w.\-]+/g, "_").slice(-80) || "file";
  const path = `${colleague.user_id}/${target.kind}/${target.id}/${Date.now()}-${Math.random().toString(36).slice(2, 7)}-${safe}`;
  const { error: upError } = await admin.storage
    .from("item-files")
    .upload(path, file.bytes, { contentType: file.type || "application/octet-stream", upsert: false });
  if (upError) return { reply: "Не получилось сохранить файл: " + upError.message };

  const { data: inserted, error } = await admin
    .from("item_comments")
    .insert({
      item_kind: target.kind,
      item_id: target.id,
      body: caption.trim(),
      attachments: [{ path, name: file.name, size: file.bytes.byteLength, type: file.type }],
      author_assignee_id: colleague.id,
      source,
    })
    .select("id")
    .maybeSingle();
  if (error || !inserted) return { reply: "Не получилось записать файл — попробуйте ещё раз." };

  await deliverComment(admin, (inserted as { id: string }).id);
  const title = await titleOf(admin, target.kind, target.id);
  return {
    reply:
      `📎 Приложил к ${target.kind === "task" ? "задаче" : "встрече"} «${title}».` +
      (aim ? "" : "\nНе та? Нажмите «💬 Ответить» под нужной задачей и пришлите ещё раз."),
  };
}

async function titleOf(admin: SupabaseClient, kind: "task" | "meeting", id: string): Promise<string> {
  const { data } = await admin.from(kind === "task" ? "tasks" : "meetings").select("title").eq("id", id).maybeSingle();
  return (data as { title: string } | null)?.title || "";
}

// Самая свежая открытая задача этого человека — запасной адрес, когда
// «Ответить» не нажимали.
async function guessOpenTask(
  admin: SupabaseClient,
  colleague: { id: string; user_id: string },
): Promise<{ kind: "task"; id: string } | null> {
  const { data } = await admin
    .from("task_participants")
    .select("task_id, created_at, tasks(status, deleted_at)")
    .eq("assignee_id", colleague.id)
    .eq("user_id", colleague.user_id)
    .order("created_at", { ascending: false })
    .limit(10);
  type Row = { task_id: string; tasks: { status: string | null; deleted_at: string | null } | { status: string | null; deleted_at: string | null }[] | null };
  for (const r of ((data as unknown as Row[]) || [])) {
    const t = Array.isArray(r.tasks) ? r.tasks[0] : r.tasks;
    if (t && !t.deleted_at && t.status !== "done") return { kind: "task", id: r.task_id };
  }
  return null;
}

// Записать сообщение в обсуждение и рассказать о нём всем, кого оно
// касается.
//
// Одно место на оба пути — и на адресный ответ по кнопке, и на угаданный.
// Рассылка тоже одна (см. commentDelivery): раньше сообщение из мессенджера
// уходило только владельцу, и трое других исполнителей той же задачи о нём
// не узнавали вовсе, хотя обсуждение заводилось ровно ради них.
async function writeToDiscussion(
  admin: SupabaseClient,
  colleague: { id: string; name: string; user_id: string },
  kind: "task" | "meeting",
  itemId: string,
  body: string,
  source: "telegram" | "max",
): Promise<{ reply: string; notifyOwner?: string; notifyTo?: string | null }> {
  const table = kind === "task" ? "tasks" : "meetings";
  const { data: item } = await admin.from(table).select("title").eq("id", itemId).maybeSingle();
  const title = (item as { title: string } | null)?.title || "";

  const { data: inserted, error } = await admin
    .from("item_comments")
    .insert({
      item_kind: kind,
      item_id: itemId,
      body,
      author_assignee_id: colleague.id,
      source,
    })
    .select("id")
    .maybeSingle();

  // Молчать нельзя: человек считает, что ответил, а его слов нигде нет.
  if (error || !inserted) {
    return { reply: "Не получилось записать сообщение — попробуйте ещё раз." };
  }

  await deliverComment(admin, (inserted as { id: string }).id);
  // notifyOwner здесь не возвращается намеренно: владельцу уже сказала
  // рассылка, и второе сообщение о том же было бы эхом.
  return { reply: `Записал в обсуждение ${kind === "task" ? "задачи" : "встречи"} «${title}».` };
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
): Promise<ColleagueTextResult | null> {
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

  // Запись и рассылка — общие с адресным ответом (writeToDiscussion). Порог
  // «первое сообщение сразу, остальные утром» живёт там же, один на оба
  // пути.
  const written = await writeToDiscussion(admin, colleague, "task", open.taskId, body, source);
  // Угадали — говорим об этом вслух и даём поправить. Человек, у которого
  // задач пять, иначе узнает о промахе только тогда, когда его слова начнут
  // искать не в той истории.
  return {
    ...written,
    reply: written.reply + "\nНе та? Нажмите «💬 Ответить» под нужной задачей и повторите.",
  };
}
