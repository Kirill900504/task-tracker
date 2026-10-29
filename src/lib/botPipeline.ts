import type { SupabaseClient } from "@supabase/supabase-js";
import type { BotButton, BotChannelConfig, BotTransport } from "@/lib/botTransport";
import { closedReply, itemClosed } from "@/lib/closedItem";
import { isLoginToken, loginPrompt } from "@/lib/messengerLogin";
import { answerOwnOpenQuestion, colleagueHelp, handleColleagueText } from "@/lib/colleagueReplies";
import { appReply, matchColleagueCommand, navButtons, signInReply } from "@/lib/colleagueQueries";
import { encodeCallback, findColleagueByChat, findOwnerSelfByChat, screenButtons } from "@/lib/colleagues";
import { notifyAuthor } from "@/lib/botDelivery";
import { parseQuickAdd } from "@/lib/quickAdd";
import { checkRateLimit } from "@/lib/rateLimit";
import { matchQueryCommand, replyForQuery } from "@/lib/telegramQueries";
import { handleManageItem, resolvePendingAction, type ManageAction, type ManageItemType, type PendingAction } from "@/lib/telegramManage";
import { logAiAction } from "@/lib/aiActionLog";
import { buildTrackerContext, trackerPulse } from "@/lib/trackerContext";
import { answerTrackerQuestion } from "@/lib/telegramAssistant";
import { firstName, talkReply } from "@/lib/botTalk";
import { extractMeetingNotes } from "@/lib/meetingNotes";
import { findMeetingForNotes } from "@/lib/meetingLink";
import { planBulkMove, describePlan, type BulkScope } from "@/lib/bulkActions";
import { attachExecutors, attachMeetingParticipants, assignNote, selfAssigneeName } from "@/lib/assignExecutors";
import { planSnooze, planAway, exactSelfPhrase } from "@/lib/botSelf";
import { guideAnswer } from "@/lib/botGuide";
import type { Viewer } from "@/lib/telegramQueries";
import { searchTracker, summariseSearch } from "@/lib/trackerSearch";
import { deadlineNote, newTaskRow } from "@/lib/newTask";
import { ownerListReply, ownerMeetingsReply, ownerMenu, ownerNav } from "@/lib/ownerQueries";
import { botMenu } from "@/lib/botMenu";
import { DESC_QUESTION, descButtons, nextNewTaskStep, whoButtons, type NewTaskPending } from "@/lib/ownerNewTask";
import { closeMeeting } from "@/lib/meetingRecap";
import { applyReview } from "@/lib/reviewWork";
import { deliverComment } from "@/lib/commentDelivery";
import { actorScope, authorFilter, findActorByChat, type BotActor } from "@/lib/botActor";
import { actorName, withoutSelfMark } from "@/lib/actorName";
import { busyOnServer } from "@/lib/meetingBusyServer";
import { taskRef } from "@/lib/taskRef";
import { navRow } from "@/lib/botMenu";
import { isYes } from "@/lib/telegramManage";
import { contextBlock, lessonActor, lessonsBlock, lessonsFor, recentDialog, recordingTransport, rememberLine, saveLesson, type DialogLine, type ReplyContext } from "@/lib/botMemory";
import { applyMove, cancelMeetingFromBot, moveFromTypedWhen, planCancelFromText, planMoveFromText, type AgendaPending, type CancelConfirmPending, type CancelPending, type MovePending } from "@/lib/botMoveFlow";
import { parseMeetingRepeat, parseTaskRepeat, parseWhen, repeatLabel } from "@/lib/botWhen";
import {
  addAgenda,
  splitAgendaText,
  agendaFromReply,
  appendAgenda,
  createMeetingFromBot,
  editChecklist,
  ideaToTask,
  planFindSlot,
  planMeetingPeople,
  planNudge,
  planReminder,
  planReview,
  planTaskPeople,
  runConfirmed,
  type ConfirmPending,
  type SkillContext,
  type SkillReply,
  type SlotPending,
} from "@/lib/botSkills";
import { dateStr, moscowNow, todayMoscow } from "@/lib/taskLogic";

// Незакрытый вопрос «что доделать»: его ставит кнопка «Вернуть» в
// мессенджере, а закрывает следующее сообщение владельца.
// participantIds — вернуть только им (кнопка «↩ Имя» на экране «кому»).
type ReturnPending = { kind: "review_return"; taskId: string; title: string; participantIds?: string[] };
type RecapPending = { kind: "meeting_recap"; meetingId: string; title: string };
// Куда адресован следующий текст постановщика: кнопка «💬 Ответить» под
// карточкой. Без неё его свободный текст — поручение, а не реплика, и
// написать в обсуждение из мессенджера было бы нечем.
type OwnerReplyPending = { kind: "owner_reply"; replyKind: "task" | "meeting"; itemId: string; title: string; at: string };

// Столько живёт направленный ответ — как и у получателя задачи
// (colleagueReplies): нажал, отвлёкся, написал о другом — и это другое
// должно уйти туда, куда ушло бы без нажатия.
const AIM_LIFETIME_MS = 2 * 60 * 60 * 1000;

// Слово, которым открывают меню. Одно на оба чата: дверь обратно должна
// называться одинаково у владельца и у любого другого постановщика.
const MENU_WORD = /^(меню|menu|\/menu|что умеешь|start|\/start)$/i;

// Умения словами (lib/botSkills): тип разбора → что делать.
const SKILLS: Record<string, (ctx: SkillContext, input: Record<string, unknown>, chat: { channel: "telegram" | "max"; chatId: number }) => Promise<SkillReply>> = {
  review_task: (c, i) => planReview(c, i),
  task_people: (c, i) => planTaskPeople(c, i),
  meeting_people: (c, i) => planMeetingPeople(c, i),
  find_slot: (c, i) => planFindSlot(c, i),
  remind_me: (c, i, chat) => planReminder(c, i, chat),
  idea_to_task: (c, i) => ideaToTask(c, i),
  agenda_add: (c, i) => addAgenda(c, i),
  checklist: (c, i) => editChecklist(c, i),
  nudge: (c, i) => planNudge(c, i),
  // Аудит ботов 20.10.2026: «отложить» и «меня не будет» — кнопки трекера,
  // которых в боте не было (lib/botSelf), и «как…?» о самом трекере —
  // ответ из справочника, а не от модели (lib/botGuide).
  snooze_task: (c, i) => planSnooze(c, i),
  away: (c, i) => planAway(c, i),
  howto: async (_c, i) => ({ text: guideAnswer(String(i.topic || "").trim(), "assigner"), buttons: navRow("assigner") }),
};

// Явное «нет» на предложенное действие.
const SAID_NO = /^(нет|неа|не надо|не нужно|не переноси|не отменяй|отмена|отмени|стоп|no)[.!]*$/i;

// Ответ на «Переношу? да?», который не «да» и не «нет», — это УТОЧНЕНИЕ, а
// не отказ. 19.10.2026 на «Переношу 3 записи?» Кирилл ответил «Только
// телемост» и получил «Отменено — ничего не переносил», потом то же на «На
// 26.10». Такое сообщение идёт в обычный разбор, где модель видит разговор
// целиком (lib/botMemory) и понимает, к чему оно. Удаление и создание задач
// по-прежнему отменяются любым другим словом: там уточнение — это новая
// фраза, а не правка списка.
function passesThrough(waiting: unknown, trimmed: string): boolean {
  const kind = (waiting as { kind?: string } | null)?.kind;
  if (kind === "move_item" || kind === "meeting_cancel_confirm" || kind === "bot_confirm" || kind === "slot_pick") return true;
  if (kind === "bulk_move") return !isYes(trimmed) && !SAID_NO.test(trimmed);
  return false;
}

// Пункты повестки, названные вместе со встречей (поле agenda разбора,
// lib/quickAdd). Модель отдаёт список; строка — тоже ответ, её режем.
function agendaOf(input: Record<string, unknown>): string[] {
  const raw = input.agenda;
  const list = Array.isArray(raw) ? raw.filter((a): a is string => typeof a === "string") : typeof raw === "string" ? splitAgendaText(raw) : [];
  return list.map((a) => a.trim().slice(0, 500)).filter(Boolean).slice(0, 20);
}

function isOwnerReply(p: unknown): p is OwnerReplyPending {
  return !!p && (p as OwnerReplyPending).kind === "owner_reply";
}
type MeetingRecapRow = {
  id: string;
  title: string;
  date: string;
  time: string | null;
  user_id: string;
  from_task_id: string | null;
  result: string | null;
};

// What the bot DOES with a message — the whole of it, and none of the
// business of getting that message off the wire.
//
// This was the body of the Telegram webhook until MAX arrived. Splitting it
// out is not tidiness: a second messenger with its own copy of "what «да»
// means", "when a task is created without asking", "how a meeting recap is
// confirmed" would drift from the first within a month, and the two would
// then be different assistants wearing the same name. The routes now only
// translate their own update format and hand the text to this.

export type BotContext = {
  admin: SupabaseClient;
  transport: BotTransport;
  channel: BotChannelConfig;
  chatId: number;
};

function uid(): string {
  return "bot" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function fmtDate(iso: string): string {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y}`;
}

// Имена, которые человек назвал, а в трекере их нет. «Список
// исполнителей» здесь было неверно наполовину: та же строка выходит под
// встречей, где люди не исполнители, а приглашённые.
function droppedNote(dropped: string[]): string {
  if (!dropped.length) return "";
  return "\n⚠ Не нашёл среди людей трекера, пропустил: " + dropped.join(", ");
}

function say(ctx: BotContext, text: string) {
  return ctx.transport.send(ctx.chatId, text);
}

// Реплика постановщика в обсуждение — после нажатой кнопки «💬 Ответить».
//
// Вставку делает служебный ключ, поэтому автор проставляется руками:
// `author_user_id` — это и есть «писал сам постановщик», по нему рассылка
// отличает его слова от чужих и не шлёт ему же копию. `author_assignee_id`
// — его строка в списке людей, и она обязательна тоже: по ней и только по
// ней трекер подписывает реплику именем. Без неё лента не находила имени и
// подписывала руководителя запасным «Кирилл» (13.10.2026: «Михаил Котов в
// чате отображается как Кирилл»). У владельца строки в акторе нет, и пусто
// здесь честно означает его. Пространство
// подставит триггер (миграция 0019), а разослать надо через ту же
// commentDelivery, что и трекер: правило «кому дошло» одно на все двери.
async function writeOwnerComment(
  ctx: BotContext,
  actor: BotActor,
  aim: OwnerReplyPending,
  body: string,
): Promise<string> {
  // «Ответить» могли нажать, пока событие было открыто, а написать — уже
  // после закрытия: адрес помнится два часа. Закрытое — только просмотр
  // (lib/closedItem), а служебный ключ политику базы не спрашивает.
  if (await itemClosed(ctx.admin, aim.replyKind, aim.itemId)) return closedReply(aim.replyKind, aim.title);
  const { data: inserted, error } = await ctx.admin
    .from("item_comments")
    .insert({
      item_kind: aim.replyKind,
      item_id: aim.itemId,
      body,
      author_user_id: actor.userId,
      author_assignee_id: actor.assigneeId || null,
      source: ctx.channel.id === "max" ? "max" : "telegram",
    })
    .select("id")
    .maybeSingle();
  // Молчать нельзя: человек считает, что написал, а его слов нигде нет.
  if (error || !inserted) return "Не получилось записать сообщение — попробуйте ещё раз.";

  await deliverComment(ctx.admin, (inserted as { id: string }).id);
  return `💬 Записал в обсуждение ${aim.replyKind === "task" ? "задачи" : "встречи"} «${aim.title}» — участники получат.`;
}

// Remembers something for the NEXT message from this chat — a clarifying
// question waiting for an answer, or an action waiting for «да».
async function remember(ctx: BotContext, patch: Record<string, unknown>) {
  await ctx.admin.from(ctx.channel.accountsTable).update(patch).eq(ctx.channel.chatColumn, ctx.chatId);
}

// Задача на нескольких человек — одна задача.
//
// До этого бот знал только поле assignee: фраза «поручи Игорю и Никите»
// превращалась в две одинаковые задачи, по одной на каждого, и связь между
// ними терялась вместе со смыслом («сделайте вдвоём»). Теперь имена
// приходят списком (см. executors в quickAdd), и каждому заводится своя
// строка участия — та же, что появляется при постановке задачи из трекера.
//
// Здесь же человек и узнаёт о задаче. «Назначена» — уведомление, которое
// нельзя выключить: поставить задачу и не сказать — это ровно тот случай,
// ради которого всё это затевалось. Ночью трекер молчит, задача придёт
// утренней сводкой.
//
// Само назначение переехало в assignExecutors.ts: тем же заняты задачи,
// надиктованные списком после встречи, и раньше эти два места делали разное
// (одно тихо теряло строку, второе не заводило её вовсе).

// Что ещё нужно разбору, кроме самой фразы: кто пишет (перенос ищет только
// его встречи и задачи), на что он ответил и что сказал целиком — фраза
// едет в память переноса, чтобы подтверждённая стала уроком.
// `dialog` — недавний разговор: ответ на вопрос и живая реплика читают его,
// чтобы «а у Игоря?» и «спасибо» были продолжением, а не началом.
type ToolExtra = { actor: BotActor; reply: ReplyContext | null; phrase: string; dialog?: DialogLine[] };

// Как обратиться к пишущему: его имя в трекере, первое слово.
async function speakerName(ctx: BotContext, extra?: ToolExtra): Promise<string> {
  if (!extra) return "";
  return firstName(await actorName(ctx.admin, extra.actor.spaceId, extra.actor.userId, ""));
}

// Кто смотрит, если это не владелец: вопрос и поиск отвечают о ЕГО делах
// (lib/telegramQueries.Viewer), а не о пространстве владельца.
function viewerOf(extra?: ToolExtra): Viewer | undefined {
  return extra && !extra.actor.isOwner ? { userId: extra.actor.userId, assigneeId: extra.actor.assigneeId } : undefined;
}

async function respondToTool(ctx: BotContext, userId: string, tool: string, input: Record<string, unknown>, droppedNames: string[], extra?: ToolExtra) {
  if (tool === "create_task") {
    // Не назвали, кому, — значит себе.
    //
    // 21.09.2026 Кирилл написал боту «создай задачу на сегодня позвонить
    // Паше Котову» и получил задачу, поставленную ЧУЖОМУ человеку: модель
    // взяла имя из примера в подсказке (закрыто сторожем nameWasSaid), а
    // пустое поле «Исполнитель» до этого дня означало задачу без единого
    // исполнителя — то есть карточку, которой в трекере быть не может
    // («без исполнителя запрети создавать»). Его слова: «задачи в моём
    // боте должны создаваться только на меня, если я не указываю адресата
    // сам». Это и есть умолчание: свой бот — про свои дела.
    const named = String(input.assignee || "").trim();
    const onMyself = named ? "" : await selfAssigneeName(ctx.admin, userId);
    const row = newTaskRow({
      id: uid(),
      userId,
      title: String(input.title || ""),
      description: String(input.description || ""),
      assignee: named || onMyself,
      deadline: (input.deadline as string) || null,
    });
    // Номер ставит база (миграция 0045) — забираем его ответом на вставку,
    // чтобы сообщение исполнителю пришло уже с «#42».
    // «Каждый понедельник сдавать отчёт» — повтор считает код из слов
    // (lib/botWhen.parseTaskRepeat), срок у повторяющейся не ставится: его
    // считает правило повтора, как в форме задачи.
    const repeat = parseTaskRepeat(String(input.repeat || ""), String(input.deadline || ""));
    const insertRow: Record<string, unknown> = repeat ? { ...row, ...repeat, deadline: null } : row;
    const { data: inserted, error } = await ctx.admin.from("tasks").insert(insertRow).select("number").maybeSingle();
    if (error) {
      await say(ctx, "Не получилось сохранить задачу: " + error.message);
      return;
    }

    const extra = Array.isArray(input.executors) ? (input.executors as unknown[]).filter((n): n is string => typeof n === "string") : [];
    const assigned = await attachExecutors(ctx.admin, userId, { ...row, number: inserted?.number ?? null }, [row.assignee, ...extra]);

    const lines = [`✓ Задача: ${taskRef({ title: row.title as string, number: inserted?.number ?? null })}`];
    if (repeat) lines.push("🔁 Повтор: " + repeatLabel(repeat));
    else if (row.deadline) lines.push("Срок: " + fmtDate(row.deadline as string));
    // Срок не назвали — его поставил сервер (lib/newTask.defaultDeadline),
    // и человек должен это знать, а не узнать через неделю.
    const dueNote = repeat ? "" : deadlineNote(input.deadline as string | undefined);
    if (dueNote) lines.push(dueNote);
    // Множественное число не украшение: «Исполнитель: Игорь» под задачей,
    // которая стоит на двоих, — это и есть «я думал, что поручил обоим».
    //
    // И только те, кто действительно назначен. Раньше здесь стояло имя из
    // поля даже тогда, когда строка участия не завелась: ответ подтверждал
    // назначение, которого не было, а выяснялось это неделей позже.
    //
    // Пометка «(я)» — служебная: она написана для того, чтобы владелец
    // нашёл себя в списке из пятнадцати имён, и в чате выглядит опечаткой.
    // Своя задача так и подписывается — «вы», — и заодно говорит, почему
    // она ваша: адресата не называли.
    const shown = assigned.attached.map(withoutSelfMark);
    if (onMyself && shown.length === 1) lines.push("Исполнитель: вы — адресата не назвали");
    else if (shown.length === 1) lines.push("Исполнитель: " + shown[0]);
    else if (shown.length > 1) lines.push("Исполнители: " + shown.join(", "));
    await say(ctx, lines.join("\n") + droppedNote(droppedNames) + assignNote(assigned));
    return;
  }

  if (tool === "create_meeting") {
    // Встреча без названия — строка «✓ Встреча: «»» в чате и пустая
    // карточка в списке, которую не отличить от соседних (так и вышло
    // 21.09.2026). Название модель придумывает не всегда — когда в фразе
    // нет темы, её и правда нет, — поэтому его подставляет код: время и
    // участники в карточке уже есть, а слово «Встреча» хотя бы называет,
    // что это.
    const said = Array.isArray(input.participants) ? (input.participants as unknown[]).filter((n): n is string => typeof n === "string") : [];
    const title = String(input.title || "").trim() || (said.length ? "Встреча: " + said.map(withoutSelfMark).join(", ") : "Встреча");
    const row = {
      id: uid(),
      user_id: userId,
      date: String(input.date || ""),
      time: String(input.time || ""),
      title,
      participants: Array.isArray(input.participants) ? input.participants : [],
      status: "planned",
      result: "",
    };
    if (!row.date) {
      await say(ctx, "Не понял дату встречи — уточните, пожалуйста.");
      return;
    }
    // С 20.10.2026 встреча из бота заводится одной функцией с приглашениями
    // (lib/botSkills.createMeetingFromBot): раньше людям не уходило ничего,
    // и о встрече они узнавали из напоминания за сутки.
    if (extra) {
      // «Планёрка по вторникам» — ближайший вторник считает код: модель
      // 20.10.2026 поставила такую на среду.
      const repeatDay = parseWhen(String(input.repeat || ""), dateStr(moscowNow())).date;
      const made = await createMeetingFromBot(ctx.admin, extra.actor, {
        title,
        date: repeatDay || row.date,
        time: row.time,
        participants: (row.participants as unknown[]).filter((n): n is string => typeof n === "string"),
        recur: parseMeetingRepeat(String(input.repeat || "")) || "none",
        agenda: agendaOf(input),
      });
      const recur = made.ok ? parseMeetingRepeat(String(input.repeat || "")) : null;
      const reply = made.text + (recur ? "\n🔁 Повтор: " + ({ weekly: "каждую неделю", biweekly: "раз в две недели", monthly: "каждый месяц" } as const)[recur] : "") + droppedNote(droppedNames);
      // Под созданной встречей — «📝 Повестка» и «Открыть встречу»: что
      // обсудим, дописывают сразу, пока встреча перед глазами (21.10.2026).
      await ctx.transport.send(ctx.chatId, reply, made.buttons ? { buttons: screenButtons([...made.buttons, ...navRow("assigner")]) } : undefined);
      return;
    }
    // Две встречи на одно время с одним человеком запрещены и отсюда — то
    // же правило, что в форме трекера (lib/meetingTime.busyPeople).
    let clash: string[];
    try {
      clash = await busyOnServer(ctx.admin, {
        spaceId: userId,
        date: row.date,
        time: row.time,
        durationMin: 30,
        people: (row.participants as unknown[]).filter((n): n is string => typeof n === "string"),
      });
    } catch (e) {
      await say(ctx, "Встречу не назначил: " + (e instanceof Error ? e.message : String(e)));
      return;
    }
    if (clash.length) {
      await say(
        ctx,
        `Встречу не назначил: ${fmtDate(row.date)}, ${row.time} уже на другой встрече — ${clash.map(withoutSelfMark).join(", ")}. Назовите другое время.`,
      );
      return;
    }
    const { error } = await ctx.admin.from("meetings").insert(row);
    if (error) {
      await say(ctx, "Не получилось сохранить встречу: " + error.message);
      return;
    }
    // Строки голосования — не то же самое, что список имён на карточке:
    // без них у людей нет кнопок «Буду / Не смогу», нет напоминаний и нет
    // строки «не ответили». Раньше их заводило только окно карточки, и
    // встреча, созданная голосом, оказывалась приглашением без адресатов.
    const invited = await attachMeetingParticipants(
      ctx.admin,
      userId,
      row.id,
      (row.participants as unknown[]).filter((n): n is string => typeof n === "string"),
    );
    const lines = [`✓ Встреча: «${row.title}»`, `${fmtDate(row.date)}${row.time ? ", " + row.time : ""}`];
    if (invited.attached.length) lines.push("Участники: " + invited.attached.map(withoutSelfMark).join(", "));
    const agenda = agendaOf(input);
    if (agenda.length) {
      const owner: BotActor = { userId, spaceId: userId, assigneeId: "", isOwner: true };
      const done = await appendAgenda(ctx.admin, owner, { id: row.id, user_id: userId }, agenda);
      lines.push(done.ok ? "📝 Повестка:\n" + done.lines.join("\n") : "⚠️ Повестку записать не получилось: " + done.error);
    }
    await say(ctx, lines.join("\n") + droppedNote(droppedNames) + assignNote(invited));
    return;
  }

  if (tool === "create_idea") {
    // Мысль — того, кто её сказал. Без created_by она записывалась бы
    // владельческой (пустой автор — это и есть «владелец», lib/ownership):
    // мысль руководителя легла бы в чужой список и пропала из его.
    const row = {
      id: uid(),
      user_id: userId,
      text: String(input.text || ""),
      important: !!input.important,
      done: false,
      ...(extra && !extra.actor.isOwner ? { created_by: extra.actor.userId } : {}),
    };
    const { error } = await ctx.admin.from("ideas").insert(row);
    if (error) {
      await say(ctx, "Не получилось сохранить идею: " + error.message);
      return;
    }
    await say(ctx, `💡 Идея сохранена: «${row.text}»`);
    return;
  }

  if (tool === "ask_clarifying_question") {
    await say(ctx, String(input.question || "Уточните, пожалуйста."));
    return;
  }

  if (tool === "manage_item") {
    const action = input.action as ManageAction;
    const itemType = input.itemType as ManageItemType;
    const query = String(input.query || "").trim();
    if (!query) {
      await say(ctx, "Не понял, какую задачу или встречу вы имеете в виду — уточните название.");
      return;
    }
    const { reply, pendingAction } = await handleManageItem(userId, action, itemType, query);
    if (pendingAction) await remember(ctx, { pending_action: pendingAction });
    await say(ctx, reply);
    return;
  }

  if (tool === "meeting_notes") {
    const notes = String(input.text || "").trim();
    if (!notes) {
      await say(ctx, "Не расслышал итоги встречи — перескажите ещё раз.");
      return;
    }
    const { data: assigneeRows } = await ctx.admin.from("assignees").select("name").eq("user_id", userId).is("archived_at", null);
    const known = (assigneeRows || []).map((r) => r.name as string);
    const { summary, tasks } = await extractMeetingNotes(notes, known);
    // Which meeting this recap is about, if any still stands open — matched
    // in code, see meetingLink. When it matches, the same confirmation also
    // closes that meeting and writes the recap into its card, so a dictated
    // outcome doesn't leave the meeting hanging as "запланирована".
    const meeting = await findMeetingForNotes(ctx.admin, userId, notes);
    const meetingLine = meeting ? `🗓 Встречу «${meeting.title}» от ${fmtDate(meeting.date)} закрою и запишу в неё этот итог.` : "";
    const pendingMeeting = meeting && summary ? { id: meeting.id, title: meeting.title, result: meeting.result, summary } : undefined;

    if (!tasks.length) {
      if (pendingMeeting) {
        await remember(ctx, { pending_action: { kind: "create_tasks", userId, tasks: [], meeting: pendingMeeting } });
        await say(
          ctx,
          "📝 " + summary + "\n\nПоручений в рассказе не нашёл.\n" + meetingLine + "\n\nЗакрываю? Ответьте «да» — любой другой ответ отменит.",
        );
        return;
      }
      await say(
        ctx,
        (summary ? "📝 " + summary + "\n\n" : "") + "Поручений в этом рассказе не нашёл. Если что-то нужно завести — скажите отдельной фразой.",
      );
      return;
    }

    // Поручение, у которого не назван исполнитель, — дело того, кто
    // рассказывает. То же умолчание, что у задачи одной фразой: задачи
    // без исполнителя в трекере не бывает, и «без исполнителя» в списке
    // означало карточку, с которой потом нечего спросить.
    const mine = await selfAssigneeName(ctx.admin, userId);
    if (mine) for (const t of tasks) if (!t.assignee) t.assignee = mine;

    // Never created straight away: a monologue is exactly the input where a
    // model can turn a passing remark into a task, so the list is shown and
    // waits for an explicit "да" (handled by resolvePendingAction).
    const lines = tasks.map((t, i) => {
      const bits = [withoutSelfMark(t.assignee) || "без исполнителя"];
      if (t.deadline) bits.push("до " + fmtDate(t.deadline));
      return `${i + 1}) ${t.title} — ${bits.join(", ")}`;
    });
    await remember(ctx, { pending_action: { kind: "create_tasks", userId, tasks, meeting: pendingMeeting } });
    await say(
      ctx,
      (summary ? "📝 " + summary + "\n\n" : "") +
        `Нашёл поручений: ${tasks.length}\n${lines.join("\n")}\n` +
        (pendingMeeting ? meetingLine + "\n" : "") +
        "\nСоздать их? Ответьте «да» — любой другой ответ отменит.\n" +
        "Проверьте список: если что-то пропущено, допишите отдельным сообщением.",
    );
    return;
  }

  if (tool === "bulk_move") {
    const scope = (["tasks", "meetings", "both"] as const).includes(input.scope as BulkScope) ? (input.scope as BulkScope) : "both";
    const { plan, error } = await planBulkMove(userId, { scope, from: String(input.from || ""), to: String(input.to || "") });
    if (error || !plan) {
      await say(ctx, error || "Не понял, что переносить.");
      return;
    }
    // Shown and confirmed before anything moves — a bulk edit is the one
    // place a misunderstanding is expensive to undo.
    await remember(ctx, { pending_action: { kind: "bulk_move", plan, phrase: extra?.phrase, parsed: { type: "bulk_move", ...input } } });
    // «Любой другой ответ отменит» больше неправда: уточнение («только
    // телемост») разбирается как уточнение, а отменяет «нет».
    await say(ctx, describePlan(plan) + "\n\nПереношу? Ответьте «да». Если нужно не всё — напишите, что именно («только телемост»).");
    return;
  }

  const skill = extra ? SKILLS[tool] : undefined;
  if (skill && extra) {
    const skillCtx: SkillContext = { admin: ctx.admin, actor: extra.actor, reply: extra.reply, phrase: extra.phrase, parsed: { type: tool, ...input } };
    const reply = await skill(skillCtx, input, { channel: ctx.channel.id, chatId: ctx.chatId });
    if (reply.pending) await rememberFor(ctx, extra.actor, reply.pending);
    await ctx.transport.send(ctx.chatId, reply.text, reply.buttons?.length ? { buttons: screenButtons(reply.buttons) } : undefined);
    return;
  }

  if (tool === "cancel_meeting" && extra) {
    const plan = await planCancelFromText(ctx.admin, extra.actor, {
      query: String(input.query || ""),
      reason: String(input.reason || ""),
      replyText: extra.reply?.text,
      replyItem: extra.reply?.item,
      phrase: extra.phrase,
      parsed: { type: "cancel_meeting", ...input },
    });
    if (plan.pending) await rememberFor(ctx, extra.actor, plan.pending);
    await ctx.transport.send(ctx.chatId, plan.text, plan.buttons?.length ? { buttons: screenButtons(plan.buttons) } : undefined);
    return;
  }

  if (tool === "move_item" && extra) {
    const plan = await planMoveFromText(ctx.admin, extra.actor, {
      itemType: String(input.itemType || ""),
      query: String(input.query || ""),
      when: String(input.when || ""),
      replyText: extra.reply?.text,
      replyItem: extra.reply?.item,
      phrase: extra.phrase,
      parsed: { type: "move_item", ...input },
    });
    if (plan.pending) await rememberFor(ctx, extra.actor, plan.pending);
    // Кнопки экрана: нажатие переписывает это же сообщение, и
    // подтверждение превращается в ответ, а не встаёт под ним ещё одним.
    await ctx.transport.send(ctx.chatId, plan.text, plan.buttons?.length ? { buttons: screenButtons(plan.buttons) } : undefined);
    return;
  }

  if (tool === "search_tracker") {
    const query = String(input.query || "").trim();
    if (!query) {
      await say(ctx, "Что искать? Назовите тему или человека.");
      return;
    }
    const hits = await searchTracker(ctx.admin, userId, query, viewerOf(extra));
    await say(ctx, await summariseSearch(query, hits));
    return;
  }

  if (tool === "answer_question") {
    const question = String(input.query || "").trim();
    if (!question) {
      await say(ctx, "Не понял вопрос — переспросите, пожалуйста.");
      return;
    }
    // Two-step on purpose: the parse above only decided "this is a question".
    // The answer needs the user's actual data, which is fetched here and
    // handed to the model as a read-only snapshot (see trackerContext).
    const [context, name] = await Promise.all([buildTrackerContext(ctx.admin, userId, viewerOf(extra)), speakerName(ctx, extra)]);
    await say(ctx, await answerTrackerQuestion(question, context, { name, dialog: extra?.dialog }));
    return;
  }

  // Живая реплика — «привет», «спасибо», «устал» (lib/botTalk). Отвечает
  // модель, но о делах говорит только то, что посчитал код, и под ответом
  // кнопки ровно к тому, о чём он сказал: горит — «Просрочено», есть дела
  // на сегодня — «Сегодня». Кнопки обычные, не экранные: нажатие открывает
  // список новым сообщением, а разговор остаётся в чате как был.
  if (tool === "small_talk") {
    const phrase = extra?.phrase || "";
    const [pulse, name] = await Promise.all([
      trackerPulse(ctx.admin, userId, viewerOf(extra)).catch(() => null),
      speakerName(ctx, extra),
    ]);
    const text = await talkReply(phrase, { name, pulse, dialog: extra?.dialog || [], role: "assigner" });
    const quick: BotButton[] = [];
    if (pulse?.overdue) quick.push({ text: "⚠ Просрочено", data: encodeCallback("task", "olist", "overdue") });
    if (pulse && (pulse.todayTasks || pulse.todayMeetings)) quick.push({ text: "📌 Сегодня", data: encodeCallback("task", "olist", "today") });
    await ctx.transport.send(ctx.chatId, text, { buttons: [...(quick.length ? [quick] : []), ...navRow("assigner")] });
    return;
  }

  // cant_help, or anything unrecognized — an honest "I don't do that" beats
  // silently failing or (the bug this replaced) echoing the user's message.
  //
  // Но не тупик: 19.10.2026 на «26.10» бот ответил лекцией о том, что
  // умеет, и ни одной кнопкой. Ответ на сообщение о встрече или задаче
  // предлагает то, что с ней можно сделать; остальное — меню.
  const item = extra?.reply?.item;
  const itemButtons =
    item?.kind === "meeting"
      ? [[{ text: "📅 Перенести встречу", data: encodeCallback("meeting", "mv", item.id) }, { text: "📋 Открыть", data: encodeCallback("meeting", "oshow", item.id) }]]
      : item?.kind === "task"
        ? [[{ text: "📅 Перенести срок", data: encodeCallback("task", "mv", item.id) }, { text: "📋 Открыть", data: encodeCallback("task", "oshow", item.id) }]]
        : [];
  await ctx.transport.send(
    ctx.chatId,
    "Не понял, что сделать. Можно так: «завтра позвонить Сергею», «перенеси встречу с банком на 26.10», «что горит на этой неделе» — или кнопками:",
    { buttons: screenButtons([...itemButtons, ...navRow("assigner")]) },
  );
}

// The connection handshake, identical in both messengers: a short-lived code
// is issued in the app, the person opens the bot with it, and the code says
// whether this chat becomes the owner's own or one colleague's.
export async function handleLinkCode(ctx: BotContext, rawCode: string, username: string | null): Promise<boolean> {
  const code = rawCode.trim().toUpperCase();
  // Вход на компьютере через бота (lib/messengerLogin) приходит той же
  // дверью — ссылкой на бота с токеном — и отвечает вопросом «это вы?».
  if (isLoginToken(code)) {
    const prompt = await loginPrompt(ctx.admin, ctx.chatId, ctx.channel, code);
    await ctx.transport.send(ctx.chatId, prompt.text, prompt.buttons ? { buttons: prompt.buttons } : {});
    return true;
  }
  if (!code) {
    await say(ctx, `Откройте трекер на сайте и нажмите «Подключить ${ctx.channel.label}», чтобы получить код.`);
    return true;
  }

  const { data: linkRow, error: lookupError } = await ctx.admin
    .from("telegram_link_codes")
    .select("user_id, expires_at, assignee_id, channel")
    .eq("code", code)
    .maybeSingle();

  if (lookupError) {
    await say(ctx, "Внутренняя ошибка базы: " + lookupError.message);
    return true;
  }
  // A code issued for the other messenger is not valid here — it was shown
  // with a different bot's link, and honouring it would attach the wrong chat.
  // Приглашение «всё в одном» (lib/welcomeInvite) — канал «any»: его
  // принимают оба бота, и при подключении оно не сгорает.
  const welcome = linkRow?.channel === "any";
  if (!linkRow || (linkRow.channel !== ctx.channel.id && !welcome) || new Date(linkRow.expires_at).getTime() < Date.now()) {
    await say(ctx, "Код неверный или уже истёк. Запросите новый в приложении.");
    return true;
  }
  // Живущий неделю код не должен перепривязать уже подключённого человека
  // к чужому чату: ссылку пересылают, и открыть её может не тот, кому её
  // дали. Свой же чат — просто приветствие ещё раз.
  if (welcome && linkRow.assignee_id) {
    const { data: current } = await ctx.admin
      .from("assignees")
      .select(ctx.channel.chatColumn)
      .eq("id", linkRow.assignee_id)
      .maybeSingle();
    const existing = (current as Record<string, unknown> | null)?.[ctx.channel.chatColumn];
    if (existing && Number(existing) !== Number(ctx.chatId)) {
      await say(ctx, `Этот человек уже подключён к ${ctx.channel.label} с другого аккаунта. Если это вы и аккаунт новый — попросите у Кирилла новую ссылку.`);
      return true;
    }
  }

  // A code issued for a colleague attaches this chat to that person instead
  // of granting access to the tracker. They get what is sent to them and
  // nothing else — see colleagueReplies.ts.
  if (linkRow.assignee_id) {
    const { data: person, error: linkError } = await ctx.admin
      .from("assignees")
      .update({
        [ctx.channel.chatColumn]: ctx.chatId,
        [ctx.channel.usernameColumn]: username || null,
        [ctx.channel.linkedAtColumn]: new Date().toISOString(),
      })
      .eq("id", linkRow.assignee_id)
      .select("name")
      .maybeSingle();
    if (linkError) {
      await say(ctx, "Не удалось подключиться: " + linkError.message);
      return true;
    }
    if (!welcome) await ctx.admin.from("telegram_link_codes").delete().eq("code", code);
    // Подключение — это и есть вход в трекер: дальше человеку не нужно ни
    // приглашения, ни пароля. Кабинет заведётся при первом открытии
    // приложения (lib/cabinet), поэтому кнопка стоит прямо в приветствии,
    // а не ждёт, пока её найдут словом «меню». Меню — той половины, что
    // разберёт нажатия: постановщицкие кнопки понимает только тот, у кого
    // уже есть вход (lib/botActor).
    const { data: member } = await ctx.admin
      .from("workspace_members")
      .select("status, member_id")
      .eq("assignee_id", linkRow.assignee_id)
      .maybeSingle();
    const menu = botMenu(member?.status === "active" && member.member_id ? "assigner" : "recipient");
    await ctx.transport.send(
      ctx.chatId,
      `✓ Готово, ${withoutSelfMark(person?.name || "") || "вы"} на связи.\n\n` +
        "Сюда приходят задачи и встречи — отвечать можно кнопками под сообщением.\n" +
        "📱 Весь трекер — кнопка «Мобильное приложение» ниже: открывается прямо здесь, без пароля.\n" +
        `💻 На компьютере — кнопка «Войти через ${ctx.channel.label}» на странице входа трекера: пароль не нужен.`,
      { buttons: menu.buttons },
    );
    return true;
  }

  const { error: upsertError } = await ctx.admin
    .from(ctx.channel.accountsTable)
    .upsert({ [ctx.channel.chatColumn]: ctx.chatId, user_id: linkRow.user_id });
  if (upsertError) {
    await say(ctx, "Не удалось привязать аккаунт: " + upsertError.message);
    return true;
  }
  await ctx.admin.from("telegram_link_codes").delete().eq("code", code);
  await say(
    ctx,
    "✓ Готово, аккаунт привязан. Теперь просто пишите сюда — например «завтра позвонить Сергею».\n" +
      "Также понимаю: «сегодня», «просрочено», «встречи», «помощь».",
  );
  return true;
}

// A code typed or pasted on its own, rather than arriving through the link.
// MAX has no /start command to carry it, and in Telegram people paste it too.
const CODE_SHAPE = /^[A-HJ-NP-Z2-9]{8}$/;

// Память бота для человека без аккаунта: разобранная фраза, ждущая «да»
// (миграция 0033). У владельца то же самое лежит в его строке аккаунта.
async function pendingFor(admin: SupabaseClient, assigneeId: string): Promise<PendingAction | null> {
  const { data } = await admin.from("assignees").select("pending_action").eq("id", assigneeId).maybeSingle();
  return ((data as { pending_action?: PendingAction } | null)?.pending_action as PendingAction) || null;
}

async function clearPending(admin: SupabaseClient, assigneeId: string): Promise<void> {
  await admin.from("assignees").update({ pending_action: null }).eq("id", assigneeId);
}

// Логин этого человека, если он вошёл в трекер. Пусто — он только получатель
// сообщений, и поручать от его имени нечего.
async function managerIdOf(admin: SupabaseClient, assigneeId: string): Promise<string | null> {
  const { data } = await admin
    .from("workspace_members")
    .select("member_id, status")
    .eq("assignee_id", assigneeId)
    .eq("status", "active")
    .maybeSingle();
  return (data as { member_id: string | null } | null)?.member_id || null;
}

// Фраза руководителя, похожая на поручение: разобрать, показать и ждать «да».
//
// Ничего не создаётся молча. Это то же правило, по которому подтверждаются
// задачи из надиктованного совещания: модель может ошибиться и в имени, и в
// сроке, а поручение, появившееся у человека без ведома поручившего, —
// худший вид ошибки в этом трекере.
//
// Возвращает false, если фраза поручением не была: тогда выше покажется
// справка, как и раньше.
async function offerTask(
  ctx: BotContext,
  colleague: { id: string; name: string; user_id: string },
  memberId: string,
  text: string,
  dialog: DialogLine[] = [],
  reply: ReplyContext | null = null,
): Promise<boolean> {
  const { data: assigneeRows } = await ctx.admin.from("assignees").select("name").eq("user_id", colleague.user_id).is("archived_at", null);
  const known = (assigneeRows || []).map((r) => r.name as string);

  let items;
  try {
    // «верни … на доску», «я вернулся» — кодом, без модели (lib/botSelf).
    const fixed = exactSelfPhrase(text);
    if (fixed) items = fixed;
    else ({ items } = await parseQuickAdd(text, known, {
      context: contextBlock(dialog, reply?.text || ""),
      lessons: lessonsBlock(await lessonsFor(ctx.admin, memberId, text)),
    }));
  } catch {
    // Модель не ответила — это не повод отвечать человеку ошибкой про JSON.
    return false;
  }

  // Перенос встречи или срока — у руководителя ровно так же, как у
  // владельца: свои встречи и свои задачи, с подтверждением кнопкой.
  const move = items.find((it) => it.tool === "move_item" || it.tool === "cancel_meeting" || !!SKILLS[it.tool]);
  if (move) {
    const actor: BotActor = { userId: memberId, spaceId: colleague.user_id, assigneeId: colleague.id, isOwner: false };
    await respondToTool(ctx, colleague.user_id, move.tool, move.input, [], { actor, reply, phrase: text, dialog });
    return true;
  }

  // Встреча, мысль, вопрос о своих делах и поиск — ровно как у владельца,
  // от имени руководителя. До аудита ботов 20.10.2026 эта ветка понимала
  // только поручения: «встреча с Игорем завтра в 11», «что у меня завтра?»
  // и просто мысль получали в ответ справку — у постановщиков равные права
  // везде, кроме бота. Встречу заводит createMeetingFromBot по актору,
  // мысль пишется с его created_by, вопрос и поиск видят только его дела
  // (viewerOf). manage_item сюда нарочно не идёт: его выборка написана
  // по пространству и для руководителя нашла бы чужое — закрыть или
  // удалить задачу он может в её карточке.
  const ACTOR_TOOLS = ["create_meeting", "create_idea", "answer_question", "search_tracker", "small_talk"];
  const others = items.filter((it) => ACTOR_TOOLS.includes(it.tool));
  if (others.length) {
    const actor: BotActor = { userId: memberId, spaceId: colleague.user_id, assigneeId: colleague.id, isOwner: false };
    for (const it of others) await respondToTool(ctx, colleague.user_id, it.tool, it.input, it.droppedNames, { actor, reply, phrase: text, dialog });
  }

  const tasks = items
    .filter((it) => it.tool === "create_task")
    .map((it) => ({
      title: String(it.input.title || "").trim(),
      // Не назвал, кому, — значит себе. У руководителя своя строка в
      // списке людей есть (в отличие от владельца), и это ровно она.
      assignee: String(it.input.assignee || "").trim() || colleague.name,
      deadline: (it.input.deadline as string) || "",
    }))
    .filter((t) => t.title);
  // Ответили встречей, мыслью или ответом на вопрос — справка не нужна.
  if (!tasks.length) return others.length > 0;

  await ctx.admin
    .from("assignees")
    .update({ pending_action: { kind: "create_tasks", userId: colleague.user_id, createdBy: memberId, tasks } })
    .eq("id", colleague.id);

  const lines = tasks.map((t, i) => {
    const bits = [t.assignee === colleague.name ? "вам" : t.assignee || "без исполнителя"];
    if (t.deadline) bits.push("до " + fmtDate(t.deadline));
    return `${i + 1}) ${t.title} — ${bits.join(", ")}`;
  });
  // «Записать?» когда задача своя: слово «поручить» про собственное дело
  // звучит как чужое, а вопрос читают быстро и отвечают «да» не глядя.
  const allMine = tasks.every((t) => t.assignee === colleague.name);
  await say(
    ctx,
    `${allMine ? "Записать?" : "Поручить?"}\n${lines.join("\n")}\n\nОтветьте «да» — любой другой ответ отменит.`,
  );
  return true;
}

// Незакрытый вопрос ПОСТАНОВЩИКА — один разбор на оба чата.
//
// Причина возврата, итог встречи, реплика в обсуждение и шаги мастера
// «Поручить» приходят следующим сообщением, и до 20.09.2026 всё это
// разбирала только ветка владельца. У руководителя такой ветки не было:
// его текст шёл в половину получателя, где подобную память никто не
// ждал, и ответом на «что доделать» стало бы «Отменено, „undefined“ не
// тронул». Раз кнопки у всех одни, общим должно быть и то, что после
// них пишут.
//
// Возвращает true, если сообщение было ответом на вопрос: тогда
// вызывающий на этом и останавливается.
async function assignerPending(ctx: BotContext, actor: BotActor, waiting: unknown, trimmed: string): Promise<boolean> {
  // Повестка встречи ждёт пункты (кнопка «📝 Повестка» — lib/botMoveFlow).
  if ((waiting as AgendaPending).kind === "meeting_agenda") {
    if (SAID_NO.test(trimmed)) {
      await say(ctx, "Хорошо, повестку не трогаю.");
      return true;
    }
    const reply = await agendaFromReply(ctx.admin, actor, (waiting as AgendaPending).id, trimmed);
    await ctx.transport.send(ctx.chatId, reply.text, { buttons: screenButtons(reply.buttons) });
    return true;
  }

  // Отмена встречи ждёт причину (кнопка «🚫 Отменить» — lib/botMoveFlow).
  if ((waiting as CancelPending).kind === "meeting_cancel") {
    if (SAID_NO.test(trimmed)) {
      await say(ctx, "Хорошо, встреча остаётся.");
      return true;
    }
    await ctx.transport.send(ctx.chatId, await cancelMeetingFromBot(ctx.admin, actor, waiting as CancelPending, trimmed), { buttons: navRow("assigner") });
    return true;
  }

  // Подтверждение умения (lib/botSkills): приёмка, люди, «поторопить всех».
  if ((waiting as ConfirmPending).kind === "bot_confirm") {
    const pending = waiting as ConfirmPending;
    if (isYes(trimmed)) {
      const text = await runConfirmed(ctx.admin, actor, pending.op);
      if (/^[✓✅↩🔔]/u.test(text) && pending.phrase && pending.parsed) {
        await saveLesson(ctx.admin, { spaceId: actor.spaceId, actor: lessonActor(actor), phrase: pending.phrase, parsed: pending.parsed });
      }
      await ctx.transport.send(ctx.chatId, text, { buttons: navRow("assigner") });
      return true;
    }
    if (SAID_NO.test(trimmed)) {
      await say(ctx, "Хорошо, ничего не меняю.");
      return true;
    }
    return false;
  }

  // Время выбрано кнопкой — это сообщение и есть название встречи.
  if ((waiting as SlotPending).kind === "slot_pick" && (waiting as SlotPending).time) {
    const pending = waiting as SlotPending;
    if (SAID_NO.test(trimmed)) {
      await say(ctx, "Хорошо, встречу не назначаю.");
      return true;
    }
    const made = await createMeetingFromBot(ctx.admin, actor, { title: trimmed.slice(0, 200), date: pending.date, time: pending.time!, participants: pending.people });
    await ctx.transport.send(ctx.chatId, made.text, { buttons: made.buttons ? screenButtons([...made.buttons, ...navRow("assigner")]) : navRow("assigner") });
    return true;
  }

  // Отмена, предложенная по фразе с причиной: ждём «да».
  if ((waiting as CancelConfirmPending).kind === "meeting_cancel_confirm") {
    const pending = waiting as CancelConfirmPending;
    if (isYes(trimmed)) {
      const text = await cancelMeetingFromBot(ctx.admin, actor, { kind: "meeting_cancel", id: pending.id, title: pending.title, at: pending.at }, pending.reason);
      if (text.startsWith("🚫") && pending.phrase && pending.parsed) {
        await saveLesson(ctx.admin, { spaceId: actor.spaceId, actor: lessonActor(actor), phrase: pending.phrase, parsed: pending.parsed });
      }
      await ctx.transport.send(ctx.chatId, text, { buttons: navRow("assigner") });
      return true;
    }
    if (SAID_NO.test(trimmed)) {
      await say(ctx, "Хорошо, встреча остаётся.");
      return true;
    }
    return false;
  }

  // Перенос: либо ждём день словами («✍️ Другой день»), либо «да» на
  // предложенный по фразе перенос.
  if ((waiting as MovePending).kind === "move_item") {
    const pending = waiting as MovePending;
    const show = async (r: { text: string; buttons?: BotButton[][]; pending?: MovePending }) => {
      if (r.pending) await rememberFor(ctx, actor, r.pending);
      await ctx.transport.send(ctx.chatId, r.text, r.buttons?.length ? { buttons: screenButtons(r.buttons) } : undefined);
    };
    if (!pending.date) {
      await show(await moveFromTypedWhen(ctx.admin, actor, pending, trimmed));
      return true;
    }
    if (isYes(trimmed)) {
      const done = await applyMove(ctx.admin, actor, pending.itemType, pending.id, pending.date, pending.time);
      if (done.ok && pending.phrase && pending.parsed) {
        await saveLesson(ctx.admin, { spaceId: actor.spaceId, actor: lessonActor(actor), phrase: pending.phrase, parsed: pending.parsed });
      }
      await ctx.transport.send(ctx.chatId, done.text, { buttons: screenButtons(done.buttons) });
      return true;
    }
    if (SAID_NO.test(trimmed)) {
      await say(ctx, "Хорошо, ничего не переношу.");
      return true;
    }
    // «На 27.10», «в 15:00», «лучше в среду» — поправка к тому же переносу.
    // Длинная фраза — уже новая просьба: её разберёт модель вместе с
    // разговором (вызывающий пропускает её дальше).
    const when = parseWhen(trimmed, dateStr(moscowNow()), pending.date);
    if ((when.date || when.time) && trimmed.split(/\s+/).length <= 6) {
      await show(await moveFromTypedWhen(ctx.admin, actor, { ...pending, date: when.date ? "" : pending.date }, trimmed));
      return true;
    }
    return false;
  }

  // Возврат на доработку: нажали кнопку, теперь пишут, что именно
  // доделать. Правила возврата общие с трекером (lib/reviewWork):
  // отчёты обнуляются, людям говорится сразу, в хронику пишется строка.
  // Мысль, начатая кнопкой «✍️ Записать мысль». Автор — нажавший: у
  // руководителя created_by его, у владельца пусто (так помечены все его
  // строки, см. lib/ownership).
  if ((waiting as { kind?: string }).kind === "new_idea") {
    const text = trimmed.slice(0, 2000);
    if (!text) {
      await say(ctx, "Пустое сообщение — не мысль. Нажмите «✍️ Записать мысль» ещё раз и напишите её.");
      return true;
    }
    const { error } = await ctx.admin.from("ideas").insert({
      id: uid(),
      user_id: actor.spaceId,
      created_by: actor.isOwner ? null : actor.userId,
      text,
      important: false,
      done: false,
    });
    await ctx.transport.send(
      ctx.chatId,
      error ? "Не получилось записать мысль — попробуйте ещё раз." : `💡 Записал: «${text.length > 80 ? text.slice(0, 79) + "…" : text}»`,
      { buttons: [[{ text: "💡 Мои мысли", data: encodeCallback("idea", "olist", "all") }], ...ownerNav()] },
    );
    return true;
  }

  if ((waiting as ReturnPending).kind === "review_return") {
    const ask = waiting as ReturnPending;
    const { data: taskRow } = await ctx.admin
      .from("tasks")
      .select("id, title, number, user_id")
      .eq("id", ask.taskId)
      .match(actorScope(actor)).or(authorFilter(actor))
      .is("deleted_at", null)
      .maybeSingle();
    const task = taskRow as { id: string; title: string; number?: number | null; user_id: string } | null;
    if (!task) {
      await say(ctx, "Эта задача больше не найдена.");
      return true;
    }
    const done = await applyReview(ctx.admin, task, "return", trimmed, {
      label: await actorName(ctx.admin, task.user_id, actor.userId),
      userId: actor.userId,
    }, false, undefined, ask.participantIds);
    await say(ctx, done.ok ? `↩ Вернул ${taskRef(task)} на доработку — исполнителям сказано.` : done.error);
    return true;
  }

  // Итог встречи, пришедший словами после кнопки «Записать итог».
  // Правила — общие с трекером (lib/meetingRecap): разослать тем, кто
  // был, записать в хронику и вернуть в задачу, если встреча выросла
  // из неё.
  if ((waiting as RecapPending).kind === "meeting_recap") {
    const ask = waiting as RecapPending;
    const { data: row } = await ctx.admin
      .from("meetings")
      .select("id, title, date, time, user_id, from_task_id, result")
      .eq("id", ask.meetingId)
      .match(actorScope(actor)).or(authorFilter(actor))
      .is("deleted_at", null)
      .maybeSingle();
    const meeting = row as MeetingRecapRow | null;
    if (!meeting) {
      await say(ctx, "Эта встреча больше не найдена.");
      return true;
    }
    // Итог пишется один раз. Вопрос «Что решили?» мог прийти в оба
    // мессенджера, и ответ во втором дописывал второй итог к первому
    // (17.10.2026, «Тест прошел 2», «Тест прошел 3»). Дополнить — в
    // обсуждении встречи, кнопкой «💬 Ответить».
    if ((meeting.result || "").trim()) {
      await say(ctx, `📝 Итог по «${meeting.title}» уже записан:\n${(meeting.result || "").trim()}\n\nВторой раз не записываю — дополнить можно в обсуждении встречи.`);
      return true;
    }
    // Актор передаётся ради задачи, из которой встреча выросла: успешный
    // итог принимает по ней работу, если она ждала приёмки (см.
    // approveTaskFromMeeting). Без него это правило работало бы в трекере и
    // молчало в мессенджере — то есть было бы наполовину.
    await closeMeeting(ctx.admin, meeting, "success", trimmed, {
      label: await actorName(ctx.admin, actor.spaceId, actor.userId),
      userId: actor.userId,
    });
    await say(ctx, "📝 Итог записан и разослан тем, кто был.");
    return true;
  }

  // Реплика в обсуждение — после кнопки «💬 Ответить».
  //
  // Для постановщика это единственный способ написать в задачу из
  // мессенджера: его свободный текст здесь — поручение, а не реплика.
  // Живёт намерение два часа и ровно одно сообщение, как и у получателя
  // (takeAim в colleagueReplies). Остывшее намерение сообщение не
  // съедает: оно обрабатывается как обычный текст, ровно так же, как
  // если бы кнопку не нажимали вовсе.
  if (isOwnerReply(waiting)) {
    const fresh = Date.now() - (Date.parse(waiting.at || "") || 0) < AIM_LIFETIME_MS;
    if (fresh) {
      await say(ctx, await writeOwnerComment(ctx, actor, waiting, trimmed));
      return true;
    }
    return false;
  }

  // Первый шаг мастера «Поручить»: пришло название. Спрашиваем, кому, —
  // кнопками, потому что имя, набранное руками, промахивается мимо
  // списка людей, а имя, названное моделью, промахивается ещё чаще.
  if ((waiting as NewTaskPending).kind === "new_task" && (waiting as NewTaskPending).stage === "title") {
    const title = trimmed.slice(0, 200);
    if (!title) {
      await say(ctx, "Пустое название — не задача. Напишите, что поручить.");
      return true;
    }
    // Дальше — детали (14.10.2026, «мастер „Поручить“ не спрашивает
    // описание»). Человек, выбранный заранее («Поручить ему» из его
    // карточки), едет дальше в памяти шага: «кому» второй раз не спросят.
    const chosen = (waiting as { people?: { name: string; role: "executor" | "coexecutor" | "watcher" }[] }).people;
    await rememberFor(ctx, actor, { kind: "new_task", stage: "desc", title, ...(chosen?.length ? { people: chosen } : {}) });
    await ctx.transport.send(ctx.chatId, `«${title}»\n\n${DESC_QUESTION}`, { buttons: descButtons() });
    return true;
  }

  // Шаг «детали»: пришёл текст — это описание, и мастер идёт дальше тем же
  // путём, что и после кнопки «Без описания» (nextNewTaskStep).
  if ((waiting as NewTaskPending).kind === "new_task" && (waiting as NewTaskPending).stage === "desc") {
    const step = await nextNewTaskStep(ctx.admin, actor.spaceId, { ...(waiting as Record<string, unknown>), description: trimmed.slice(0, 4000) });
    await rememberFor(ctx, actor, step.pending);
    await ctx.transport.send(ctx.chatId, step.text, { buttons: step.buttons });
    return true;
  }

  // Второй и третий шаги отвечают кнопкой, а не словом. Если человек всё
  // же написал — не теряем ни шаг, ни написанное: память возвращается на
  // место, а кнопки показываются снова.
  if ((waiting as NewTaskPending).kind === "new_task") {
    await rememberFor(ctx, actor, waiting as Record<string, unknown>);
    await ctx.transport.send(ctx.chatId, "Выберите кнопкой — или начните заново словом «меню».", {
      buttons: await whoButtons(ctx.admin, actor.spaceId),
    });
    return true;
  }

  return false;
}

// Запомнить незакрытый вопрос там, где живёт этот чат: у владельца в
// таблице аккаунтов, у остальных на строке человека. Та же пара, что в
// lib/botCallback, и по той же причине.
async function rememberFor(ctx: BotContext, actor: BotActor, value: Record<string, unknown> | null): Promise<void> {
  if (actor.isOwner) {
    await remember(ctx, { pending_action: value });
    return;
  }
  await ctx.admin.from("assignees").update({ pending_action: value }).eq("id", actor.assigneeId);
}

// Память разговора на этот чат: что говорили за последние полчаса (без
// текущего сообщения — оно и так перед моделью), и транспорт, который
// записывает каждый ответ бота. Реплика человека записывается тут же.
async function openMemory(ctx: BotContext, spaceId: string, text: string): Promise<{ ctx: BotContext; dialog: DialogLine[] }> {
  const ref = { spaceId, channel: ctx.channel.id, chatId: ctx.chatId };
  const dialog = await recentDialog(ctx.admin, ref);
  await rememberLine(ctx.admin, ref, "user", text);
  return { ctx: { ...ctx, transport: recordingTransport(ctx.transport, ctx.admin, ref) }, dialog };
}

// `reply` — сообщение бота, на которое человек ответил (реплай), если
// мессенджер его прислал. См. ReplyContext в lib/botMemory.
export async function handleText(baseCtx: BotContext, text: string, reply: ReplyContext | null = null): Promise<void> {
  const trimmed = text.trim();
  let ctx = baseCtx;

  const { data: account, error: accountError } = await ctx.admin
    .from(ctx.channel.accountsTable)
    .select("user_id, pending_context, pending_action")
    .eq(ctx.channel.chatColumn, ctx.chatId)
    .maybeSingle();

  if (accountError) {
    await say(ctx, "Внутренняя ошибка базы: " + accountError.message);
    return;
  }

  if (!account) {
    // Not connected: either this is the code that connects it, or there is
    // nothing this chat can be told.
    if (CODE_SHAPE.test(trimmed.toUpperCase())) {
      await handleLinkCode(ctx, trimmed, null);
      return;
    }
    const colleague = await findColleagueByChat(ctx.admin, ctx.chatId, ctx.channel);
    if (colleague) {
      const memory = await openMemory(baseCtx, colleague.user_id, trimmed);
      ctx = memory.ctx;
      // Отложенное подтверждение всегда старше всего остального: следующее
      // сообщение — это «да» или отказ, а не новая просьба.
      const waiting = await pendingFor(ctx.admin, colleague.id);
      if (waiting) {
        await clearPending(ctx.admin, colleague.id);
        // Половина вопросов здесь — постановщицкие: причина возврата, итог
        // встречи, шаг мастера «Поручить». Раньше их тут быть не могло,
        // потому что и кнопок таких у руководителя не было; теперь есть, и
        // разбирает их та же функция, что и в чате владельца.
        const actor = await findActorByChat(ctx.admin, ctx.chatId, ctx.channel);
        if (actor && (await assignerPending(ctx, actor, waiting, trimmed))) return;
        if (!passesThrough(waiting, trimmed)) {
          await say(ctx, await resolvePendingAction(waiting, trimmed));
          return;
        }
      }

      // Раньше здесь был тупик: «это канал в одну сторону». Он и был им,
      // пока единственным ответом коллеги было нажатие кнопки. Теперь
      // кнопка «Сделал» просит сказать, что именно сделано, а «Не могу» —
      // почему, и вот этот текст и приходит сюда следующим сообщением.
      // Кто перед нами: руководитель со входом в трекер или человек,
      // которому просто пишут. От этого зависит, чем считать его фразу.
      const asManager = await managerIdOf(ctx.admin, colleague.id);

      // «Меню» словом — то же, что кнопка, и теперь оно есть у каждого, кто
      // ставит задачи. Кнопки уезжают вверх вместе с перепиской, и человек,
      // открывший чат через неделю, не видит ни одной: слово «меню» — это
      // дверь обратно, и она не может быть только у владельца.
      if (asManager && MENU_WORD.test(trimmed)) {
        const menu = ownerMenu();
        await ctx.transport.send(ctx.chatId, menu.text, menu.buttons?.length ? { buttons: menu.buttons } : undefined);
        return;
      }
      const answered = await handleColleagueText(ctx.admin, colleague, trimmed, ctx.channel.id, !!asManager);
      if (answered) {
        await ctx.transport.send(ctx.chatId, answered.reply, answered.buttons?.length ? { buttons: answered.buttons } : undefined);
        if (answered.notifyOwner) await notifyAuthor(ctx.admin, colleague.user_id, answered.notifyTo ?? null, answered.notifyOwner, answered.notice);
        return;
      }

      // Руководитель может поручить отсюда же.
      //
      // Быстрый ввод был только у владельца, и, чтобы поставить одну задачу,
      // руководителю приходилось открывать трекер — для человека, который
      // весь день за рулём, это ровно та преграда, из-за которой поручение
      // не становится задачей. Право у него есть (миграция 0031), не хватало
      // двери.
      //
      // Только тому, у кого есть членство: коллега без входа в трекер — это
      // человек, которому пишут, и заводить от его имени задачи в чужом
      // пространстве было бы подлогом.
      if (asManager) {
        const offered = await offerTask(ctx, colleague, asManager, trimmed, memory.dialog, reply);
        if (offered) return;
      }

      // Ответить оказалось нечем — ни задачи, ни встречи, ни команды.
      // Справка идёт с кнопками списков: человеку, который ещё не знает, что
      // тут можно, показать это дешевле, чем рассказать.
      await ctx.transport.send(ctx.chatId, colleagueHelp(colleague.name), { buttons: navButtons() });
      return;
    }
    await say(ctx, `Этот чат ещё не привязан. Откройте трекер на сайте → «Подключить ${ctx.channel.label}».`);
    return;
  }

  const { allowed } = await checkRateLimit(ctx.admin, account.user_id, ctx.channel.id, 20, 60);
  if (!allowed) {
    await say(ctx, "Слишком много сообщений подряд, подождите минуту.");
    return;
  }

  // Владелец как актор — один раз на весь разбор его сообщения.
  //
  // Раньше он собирался только внутри ветки незакрытого вопроса, а
  // выборкам ниже отдавался голый `account.user_id`. Тип этого не поймал:
  // Supabase без сгенерированных типов отдаёт строку как `any`, и строка
  // молча проезжала туда, где ждут актора. Кончалось это не пустым
  // списком, а обратным: `actorScope` читал у строки несуществующие
  // `isOwner`/`spaceId`, получал undefined в обе колонки, а `.match()`
  // просто ВЫБРАСЫВАЕТ undefined — то есть запрос уходил вообще без
  // фильтра по пространству. Проверка 20.09.2026: «сегодня», написанное
  // словом, показывало 19 задач вместо 8 — чужие пространства целиком.
  // Кнопки этим не болели: они всегда несли настоящего актора.
  const asOwner: BotActor = { userId: account.user_id, spaceId: account.user_id, assigneeId: "", isOwner: true };
  const memory = await openMemory(baseCtx, account.user_id, trimmed);
  ctx = memory.ctx;

  // Незакрытый вопрос старше всего остального: следующее сообщение — это
  // «да», причина возврата или шаг мастера, а не новая просьба.
  if (account.pending_action) {
    await remember(ctx, { pending_action: null });
    const waiting = account.pending_action;
    if (await assignerPending(ctx, asOwner, waiting, trimmed)) return;
    // Остывшее «💬 Ответить» сюда не адресовано: resolvePendingAction
    // разбирает подтверждения («да»), и незнакомая ему память ответила бы
    // «Отменено, „undefined“ не тронул». Уточнение к переносу — тоже не
    // ответ «да/нет», а новая фраза о том же (passesThrough).
    if (!isOwnerReply(waiting) && !passesThrough(waiting, trimmed)) {
      const bulk = waiting as { kind?: string; phrase?: string; parsed?: unknown };
      const answer = await resolvePendingAction(waiting as PendingAction, trimmed);
      // Подтверждённый массовый перенос — урок, как и одиночный.
      if (bulk.kind === "bulk_move" && isYes(trimmed) && bulk.phrase && bulk.parsed && answer.startsWith("✓")) {
        await saveLesson(ctx.admin, { spaceId: account.user_id, actor: lessonActor(asOwner), phrase: bulk.phrase, parsed: bulk.parsed });
      }
      await say(ctx, answer);
      return;
    }
  }

  // «Меню» — то же, что кнопка «☰ Меню», только словом. Человек, открывший
  // чат спустя неделю, кнопок не видит: они уехали вверх вместе с
  // сообщениями.
  if (MENU_WORD.test(trimmed)) {
    const menu = ownerMenu();
    await ctx.transport.send(ctx.chatId, menu.text, menu.buttons?.length ? { buttons: menu.buttons } : undefined);
    return;
  }

  // «Приложение» и «вход» — те же слова, что у всех остальных
  // (colleagueQueries): команды из меню у поля ввода одни на весь бот, и
  // у владельца они не могут отвечать тишиной или уезжать в поручение.
  const ownerWord = matchColleagueCommand(trimmed);
  if (ownerWord === "app" || ownerWord === "enter") {
    const selfRow = ownerWord === "enter" ? await findOwnerSelfByChat(ctx.admin, ctx.chatId, ctx.channel) : null;
    const reply = ownerWord === "app" ? appReply(ctx.channel.id) : selfRow ? await signInReply(ctx.admin, selfRow.id) : null;
    if (reply) {
      await ctx.transport.send(ctx.chatId, reply.text, reply.buttons?.length ? { buttons: reply.buttons } : undefined);
      return;
    }
  }

  // The owner is a recipient too: a manager sets him a task or a meeting,
  // he presses «Сделал» or «Не смогу», and the bot asks him for the words.
  // Those words are the answer, not a new assignment — but only while the
  // question is fresh (see answerOwnOpenQuestion).
  const self = await findOwnerSelfByChat(ctx.admin, ctx.chatId, ctx.channel);
  if (self) {
    const answered = await answerOwnOpenQuestion(ctx.admin, self, trimmed);
    if (answered) {
      await ctx.transport.send(ctx.chatId, answered.reply, answered.buttons?.length ? { buttons: answered.buttons } : undefined);
      // Telling the author is the point; telling himself is noise.
      if (answered.notifyOwner && answered.notifyTo && answered.notifyTo !== account.user_id) {
        await notifyAuthor(ctx.admin, account.user_id, answered.notifyTo, answered.notifyOwner, answered.notice);
      }
      return;
    }
  }

  // Read-only query commands ("сегодня", "просрочено", "встречи") are matched
  // before quick-add — free, instant, and can't be misparsed by the LLM.
  // They also break out of any pending clarify flow, since answering "сегодня"
  // to a clarifying question isn't a real answer to it.
  const queryKind = matchQueryCommand(trimmed);
  if (queryKind) {
    if (account.pending_context) await remember(ctx, { pending_context: null });
    // Кнопками, а не голым текстом: список, из которого нельзя открыть
    // задачу, — это список, после которого всё равно открывать трекер.
    const which = queryKind === "today" ? "today" : queryKind === "overdue" ? "overdue" : "";
    if (queryKind === "meetings") {
      const reply = await ownerMeetingsReply(ctx.admin, asOwner, todayMoscow());
      await ctx.transport.send(ctx.chatId, reply.text, reply.buttons?.length ? { buttons: reply.buttons } : undefined);
      return;
    }
    if (which) {
      const reply = await ownerListReply(ctx.admin, asOwner, which, todayMoscow());
      await ctx.transport.send(ctx.chatId, reply.text, reply.buttons?.length ? { buttons: reply.buttons } : undefined);
      return;
    }
    await say(ctx, await replyForQuery(queryKind, account.user_id));
    return;
  }

  const hadPendingContext = !!account.pending_context;
  const effectiveText = hadPendingContext ? `${account.pending_context}. Уточнение: ${trimmed}` : trimmed;
  if (hadPendingContext) await remember(ctx, { pending_context: null });

  const { data: assigneeRows } = await ctx.admin.from("assignees").select("name").eq("user_id", account.user_id).is("archived_at", null);
  const assignees = (assigneeRows || []).map((r) => r.name as string);

  try {
    // «верни … на доску», «я вернулся» — кодом, без модели (lib/botSelf).
    const items =
      exactSelfPhrase(trimmed) ||
      (
        await parseQuickAdd(effectiveText, assignees, {
          context: contextBlock(memory.dialog, reply?.text || ""),
          lessons: lessonsBlock(await lessonsFor(ctx.admin, lessonActor(asOwner), effectiveText)),
        })
      ).items;
    let toProcess = items;

    // Loop guard: allow at most ONE clarifying round-trip. An exact-text
    // comparison here previously let this slip through in production — the
    // model phrased each follow-up slightly differently, so it never matched,
    // and pending_context grew without bound across many replies (turning
    // into an ever-larger, eventually corrupted blob that kept re-triggering
    // the same stuck question). Capping by round instead of by text content
    // closes that regardless of what the model says the second time. Only
    // applies when the whole message is a single clarifying question — a
    // multi-item batch that includes one alongside real items just drops it
    // below instead.
    if (toProcess.length === 1 && toProcess[0].tool === "ask_clarifying_question" && hadPendingContext) {
      toProcess = [{ tool: "cant_help", input: {}, droppedNames: [] }];
    }

    const isSingleClarify = toProcess.length === 1 && toProcess[0].tool === "ask_clarifying_question";
    if (isSingleClarify) {
      // Defensive cap — this can only ever be the *first* round now, but
      // truncate anyway so a single oversized message can't wedge the column.
      await remember(ctx, { pending_context: effectiveText.slice(0, 500) });
    }

    // A clarifying question can't be answered in a multi-item batch (there's
    // nowhere to hold several pending questions at once) — process the
    // actionable items and quietly drop that one rather than derail the
    // whole message over an unclear fragment.
    const finalItems = isSingleClarify ? toProcess : toProcess.filter((it) => it.tool !== "ask_clarifying_question");
    for (const it of finalItems) {
      await respondToTool(ctx, account.user_id, it.tool, it.input, it.droppedNames, { actor: asOwner, reply, phrase: effectiveText, dialog: memory.dialog });
    }
    await logAiAction(ctx.admin, {
      userId: account.user_id,
      source: ctx.channel.id,
      inputText: effectiveText,
      success: true,
      resultSummary: finalItems.map((it) => it.tool).join(", "),
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    // Classification failed — most often because the message was a question
    // and the model answered it in prose instead of returning JSON. Rather
    // than show "В ответе нет JSON", treat it as a question: that path only
    // reads data, so the worst case is an unhelpful answer, never a wrong
    // edit. A real failure there falls through to the error message.
    try {
      const context = await buildTrackerContext(ctx.admin, account.user_id);
      await say(ctx, await answerTrackerQuestion(effectiveText, context, { dialog: memory.dialog }));
      await logAiAction(ctx.admin, { userId: account.user_id, source: ctx.channel.id, inputText: effectiveText, success: true, resultSummary: "answer_question (fallback)" });
    } catch {
      // Текст ошибки модели («GigaChat completion … 503») человеку ничего не
      // говорит — он уходит в журнал ниже, а в чат идёт то, что делать.
      await ctx.transport.send(
        ctx.chatId,
        "Помощник сейчас не отвечает — попробуйте через минуту. Списки и действия работают кнопками:",
        { buttons: navRow("assigner") },
      );
      await logAiAction(ctx.admin, { userId: account.user_id, source: ctx.channel.id, inputText: effectiveText, success: false, errorMessage: message });
    }
  }
}
