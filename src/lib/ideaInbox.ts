import type { SupabaseClient } from "@supabase/supabase-js";
import type { BotButton, BotChannelConfig } from "@/lib/botTransport";
import type { CallbackAction, ColleagueRow } from "@/lib/colleagues";
import { encodeCallback, findColleagueByChat, findOwnerSelfByChat, ideaButtons, meetingButtons, meetingMessage } from "@/lib/colleagues";
import type { CallbackOutcome } from "@/lib/colleagueReplies";
import { notifyAuthor } from "@/lib/botDelivery";
import { sendToPerson } from "@/lib/reach";
import { newTaskRow } from "@/lib/newTask";
import { attachExecutors, assignNote } from "@/lib/assignExecutors";
import { resolveWhen } from "@/lib/ownerNewTask";
import { sortByPeopleOrder } from "@/lib/peopleOrder";
import { withoutSelfMark } from "@/lib/actorName";
import { isSelfAssignee } from "@/lib/trackerRows";
import { fmtDate } from "@/lib/taskDisplay";
import { moscowNow } from "@/lib/taskLogic";
import { WORKDAY_SLOTS, startsInPast } from "@/lib/meetingTime";
import { busyOnServer, busyStartsOnServer } from "@/lib/meetingBusyServer";
import { uid } from "@/lib/uid";

// Присланная мысль — четыре ответа получателя в мессенджере.
//
// 08.10.2026, словами Кирилла: «мысль должна приходить адресату и у
// получателя должны быть варианты действий „прочитать“, в этом случае
// мысль просто исчезает, „сохранить мысль“ — в этом случае мысль
// сохраняется в список мыслей получателя, „взять в работу“ — то есть
// создать на себя или коллегу конкретную задачу, „назначить встречу“ — то
// есть создать на основании мысли встречу». До этого под мыслью была одна
// кнопка, и она заводила задачу только на того, кто нажал.
//
// Одно место на всех получателей — владельца (его чат в таблице
// аккаунтов), руководителя со входом и человека без входа (их чат на
// строке в списке людей). Поэтому разбор стоит в lib/botCallback ДО
// развилки «постановщик / получатель»: эти кнопки адресованы получателю
// мысли, кем бы он ни был в остальном.
//
// Шаги «кому» и «когда» живут в самой кнопке, а не в `pending_action`:
// нажатия ничего не ждут от следующего текста, и память в базе здесь
// только мешала бы — у человека без входа следующее сообщение после
// брошенного мастера разбиралось бы как ответ на него. Callback_data в
// Telegram — 64 байта, поэтому человек в ней — первые восемь знаков его
// id, а день встречи — смещение от сегодня. Восьми знаков на пятнадцать
// человек хватает с запасом, а неоднозначный префикс отказывает, а не
// угадывает.
//
// Каждый шаг ПЕРЕПИСЫВАЕТ сообщение с мыслью, а не присылает новое — то
// же правило, что у меню бота («не засорять историю чата»). «← Назад»
// возвращает исходные четыре кнопки.

export const IDEA_INBOX_ACTIONS = new Set(["read", "keep", "task", "tw", "tg", "meet", "md", "mt", "back"]);

export function isIdeaInboxAction(action: CallbackAction): boolean {
  return action.kind === "idea" && IDEA_INBOX_ACTIONS.has(action.action);
}

// Тот, кому мысль прислали.
type Receiver = {
  assigneeId: string;
  // Имя строки как есть, с «(я)» у владельца: так оно пишется в задачу.
  name: string;
  spaceId: string;
  // auth-id. Пусто — у человека нет входа: ни своих мыслей, ни права
  // подписать собой задачу или встречу.
  userId: string | null;
};

type IdeaRef = { id: string; text: string; userId: string; createdBy: string | null };

const WEEKDAYS = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];

const PREFIX = 8;
const SELF = "me";

export function personRef(assigneeId: string): string {
  return assigneeId.slice(0, PREFIX);
}

// Разобрать хвост кнопки: «<ideaId>.<a>.<b>». Id мысли — uuid без точек.
export function splitRef(id: string): string[] {
  return id.split(".");
}

// Найти человека по префиксу id. Ни одного или больше одного — отказ:
// задача, поручённая не тому, хуже задачи, которую переспросили.
export function byPrefix<T extends { id: string }>(people: T[], ref: string): T | null {
  if (!ref) return null;
  const hits = people.filter((p) => p.id.startsWith(ref));
  return hits.length === 1 ? hits[0] : null;
}

// Рабочие дни вперёд, начиная с сегодня: выходные пропускаются, их и так
// никто не назначает, а кнопок под сообщением мало. Сегодня — только если
// на него остался хоть один слот. Даты считаются по Москве: функция живёт
// во Франкфурте, и «сегодня» по UTC после 21:00 — уже чужое завтра.
export function meetingDays(now: Date = moscowNow(), count = 6): { offset: number; date: string; label: string }[] {
  const base = new Date(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const local = new Date(base.getFullYear(), base.getMonth(), base.getDate(), now.getUTCHours(), now.getUTCMinutes());
  const out: { offset: number; date: string; label: string }[] = [];
  for (let offset = 0; out.length < count && offset < 21; offset++) {
    const d = new Date(base);
    d.setDate(d.getDate() + offset);
    const dow = d.getDay();
    if (dow === 0 || dow === 6) continue;
    const date = iso(d);
    if (offset === 0 && !WORKDAY_SLOTS.some((s) => !startsInPast(date, s, local))) continue;
    const label = offset === 0 ? "Сегодня" : offset === 1 ? "Завтра" : `${WEEKDAYS[dow]} ${pad(d.getDate())}.${pad(d.getMonth() + 1)}`;
    out.push({ offset, date, label });
  }
  return out;
}

export function dayByOffset(offset: number, now: Date = moscowNow()): string {
  const d = new Date(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  d.setDate(d.getDate() + offset);
  return iso(d);
}

// Слоты дня, которые ещё можно назначить: не в прошлом и не заняты у
// приглашённых (то же правило, что в форме трекера: двух встреч на одно
// время с одним человеком быть не может).
export function freeSlots(date: string, busy: Set<string>, now: Date = moscowNow()): string[] {
  const local = new Date(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), now.getUTCHours(), now.getUTCMinutes());
  return WORKDAY_SLOTS.filter((s) => !busy.has(s) && !startsInPast(date, s, local));
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function iso(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function rows<T>(list: T[], perRow: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += perRow) out.push(list.slice(i, i + perRow));
  return out;
}

function head(idea: IdeaRef): string {
  return `💡 ${idea.text}`;
}

function back(ideaId: string): BotButton[] {
  return [{ text: "← Назад", data: encodeCallback("idea", "back", ideaId) }];
}

// Ответ, данный здесь, переписывает и остальные сообщения с этой мыслью у
// того же человека — в другом мессенджере тоже (lib/botMirror, миграция
// 0052). Итог узнаётся по форме ответа: текст без кнопок — это конец
// разговора о мысли («Прочитано», «Сохранено», «Поручено», «Встреча
// назначена»); шаг мастера всегда несёт кнопки следующего шага, и его
// зеркалить незачем — второй чат должен остаться с исходными кнопками.
export async function handleIdeaInbox(
  admin: SupabaseClient,
  chatId: number,
  action: CallbackAction,
  channel: BotChannelConfig,
): Promise<CallbackOutcome> {
  const me = await receiverByChat(admin, chatId, channel);
  const outcome = await answerIdea(admin, me, action);
  const [ideaId] = splitRef(action.id);
  if (me && ideaId && outcome.rewriteTo && !outcome.rewriteButtons) {
    outcome.mirror = { kind: "idea", itemId: ideaId, assigneeId: me.assigneeId, text: outcome.rewriteTo };
  }
  return outcome;
}

async function answerIdea(admin: SupabaseClient, me: Receiver | null, action: CallbackAction): Promise<CallbackOutcome> {
  if (!me) return { toast: "Этот чат не подключён" };

  const [ideaId, a = "", b = ""] = splitRef(action.id);
  const idea = await loadIdea(admin, ideaId, me.spaceId);
  if (!idea) return { toast: "Этой мысли больше нет", rewriteTo: "💡 Автор убрал эту мысль." };

  const { data: recRow } = await admin
    .from("idea_recipients")
    .select("id, seen_at, converted_task_id")
    .eq("idea_id", idea.id)
    .eq("assignee_id", me.assigneeId)
    .maybeSingle();
  const recipient = recRow as { id: string; seen_at: string | null; converted_task_id: string | null } | null;
  const markAnswered = async (patch: Record<string, unknown> = {}) => {
    await admin
      .from("idea_recipients")
      .update({ seen_at: new Date().toISOString(), ...patch })
      .eq("idea_id", idea.id)
      .eq("assignee_id", me.assigneeId);
  };

  if (action.action === "back") {
    return { toast: "Назад", rewriteTo: head(idea), rewriteButtons: ideaButtons(idea.id, { canKeep: !!me.userId }) };
  }

  // «Прочитать»: мысль просто исчезает из чата. Ответ записывается, чтобы
  // она ушла и из «Прислали вам» в трекере, а автор видел, что прочли.
  // Удалить сообщение мессенджер позволяет не всегда (Telegram — только
  // за двое суток), поэтому на этот случай есть запасной текст.
  if (action.action === "read") {
    await markAnswered();
    return { toast: "Прочитано", remove: true, rewriteTo: `${head(idea)}\n\n👁 Прочитано` };
  }

  // «Сохранить мысль»: копия в мой список, с сегодняшней датой — так же,
  // как это делает «Сохранить» в трекере (IncomingIdeas).
  if (action.action === "keep") {
    if (!me.userId) return { toast: "Своих мыслей без входа в трекер нет" };
    const isOwner = me.userId === me.spaceId;
    const { error } = await admin.from("ideas").insert({
      id: uid(),
      user_id: me.spaceId,
      text: idea.text,
      important: false,
      done: false,
      created_by: isOwner ? null : me.userId,
    });
    if (error) return { toast: "Не получилось сохранить" };
    await markAnswered();
    return { toast: "Сохранено", rewriteTo: `${head(idea)}\n\n💾 Сохранено в ваши мысли` };
  }

  // ——— «Взять в работу»: кому — себе или коллеге.
  if (action.action === "task") {
    if (recipient?.converted_task_id) return { toast: "Уже в работе", rewriteTo: `${head(idea)}\n\n➕ Уже взято в работу` };
    const people = (await peopleOf(admin, me.spaceId)).filter((p) => p.id !== me.assigneeId);
    const buttons: BotButton[][] = [
      [{ text: "🙋 Себе", data: encodeCallback("idea", "tw", `${idea.id}.${SELF}`) }],
      ...rows(
        people.map((p) => ({ text: withoutSelfMark(p.name), data: encodeCallback("idea", "tw", `${idea.id}.${personRef(p.id)}`) })),
        2,
      ),
      back(idea.id),
    ];
    return { toast: "Кому?", rewriteTo: `${head(idea)}\n\nКому поручить?`, rewriteButtons: buttons };
  }

  if (action.action === "tw") {
    // Себе — сразу, как и было: принял тот же, кто взял, и срок ставит не он.
    if (a === SELF) return takeForSelf(admin, me, idea);
    const person = byPrefix(await peopleOf(admin, me.spaceId), a);
    if (!person) return { toast: "Этого человека больше нет" };
    const when = (code: string, text: string) => ({ text, data: encodeCallback("idea", "tg", `${idea.id}.${a}.${code}`) });
    return {
      toast: withoutSelfMark(person.name),
      rewriteTo: `${head(idea)}\n\nКому: ${withoutSelfMark(person.name)}. На когда?`,
      rewriteButtons: [
        [when("0", "Сегодня"), when("1", "Завтра")],
        [when("fri", "До пятницы"), when("7", "Через неделю")],
        [when("no", "Без срока")],
        [{ text: "← Назад", data: encodeCallback("idea", "task", idea.id) }],
      ],
    };
  }

  if (action.action === "tg") {
    if (recipient?.converted_task_id) return { toast: "Уже в работе", rewriteTo: `${head(idea)}\n\n➕ Уже взято в работу` };
    const person = byPrefix(await peopleOf(admin, me.spaceId), a);
    if (!person) return { toast: "Этого человека больше нет" };
    const now = moscowNow();
    const deadline = resolveWhen(b, new Date(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    // Поручает тот, кто нажал: это его решение отдать мысль коллеге. Без
    // входа подписать задачу собой ему нечем — тогда постановщик автор
    // мысли, как и в «Себе».
    const createdBy = me.userId ? (me.userId === me.spaceId ? null : me.userId) : idea.createdBy;
    const taskId = uid();
    const { data: inserted, error } = await admin
      .from("tasks")
      .insert(newTaskRow({ id: taskId, userId: me.spaceId, title: titleOf(idea), assignee: person.name, deadline: deadline || null, createdBy }))
      .select("number")
      .maybeSingle();
    if (error) return { toast: "Не получилось завести задачу" };
    const result = await attachExecutors(
      admin,
      me.spaceId,
      { id: taskId, title: titleOf(idea), deadline: deadline || null, number: (inserted as { number?: number } | null)?.number ?? null },
      [person.name],
      "executor",
      createdBy,
    );
    await markAnswered({ converted_task_id: taskId });
    await notifyAuthor(admin, me.spaceId, idea.createdBy, `➕ ${withoutSelfMark(me.name)} поручил вашу мысль: ${withoutSelfMark(person.name)} — «${titleOf(idea)}»`, {
      kind: "idea_taken",
      item: titleOf(idea),
      who: withoutSelfMark(me.name),
    });
    const when = deadline ? `, срок ${fmtDate(deadline)}` : ", без срока";
    return {
      toast: "Поручено",
      rewriteTo: `${head(idea)}\n\n✅ Поручено: ${withoutSelfMark(person.name)}${when}.${assignNote(result)}`,
    };
  }

  // ——— «Назначить встречу»: с автором мысли — он её прислал, с ним и
  // говорить. День, потом время; занятое у обоих не предлагается.
  if (action.action === "meet" || action.action === "md" || action.action === "mt") {
    const author = await authorRow(admin, idea);
    const people = [me.name, ...(author && author.id !== me.assigneeId ? [author.name] : [])];
    const withWhom = author && author.id !== me.assigneeId ? ` с ${withoutSelfMark(author.name)}` : "";

    if (action.action === "meet") {
      const days = meetingDays();
      return {
        toast: "Какой день?",
        rewriteTo: `${head(idea)}\n\n📅 Встреча${withWhom}. Какой день?`,
        rewriteButtons: [
          ...rows(days.map((d) => ({ text: d.label, data: encodeCallback("idea", "md", `${idea.id}.${d.offset}`) })), 2),
          back(idea.id),
        ],
      };
    }

    const date = dayByOffset(Number(a) || 0);
    let busy: Set<string>;
    try {
      busy = await busyStartsOnServer(admin, { spaceId: me.spaceId, date, durationMin: 30, people, slots: WORKDAY_SLOTS });
    } catch {
      return { toast: "Не удалось проверить занятость" };
    }

    if (action.action === "md") {
      const free = freeSlots(date, busy);
      if (!free.length) return { toast: "В этот день всё занято" };
      return {
        toast: fmtDate(date),
        rewriteTo: `${head(idea)}\n\n📅 Встреча${withWhom}, ${fmtDate(date)}. Во сколько? (полчаса)`,
        rewriteButtons: [
          ...rows(free.map((t) => ({ text: t, data: encodeCallback("idea", "mt", `${idea.id}.${a}.${t.replace(":", "")}`) })), 4),
          [{ text: "← Другой день", data: encodeCallback("idea", "meet", idea.id) }],
        ],
      };
    }

    // mt: время выбрано — заводим. Проверка занятости ещё раз: между
    // кнопками могли назначить другую встречу.
    const time = `${b.slice(0, 2)}:${b.slice(2, 4)}`;
    if (!freeSlots(date, new Set()).includes(time)) return { toast: "Это время уже прошло" };
    let clash: string[];
    try {
      clash = await busyOnServer(admin, { spaceId: me.spaceId, date, time, durationMin: 30, people });
    } catch {
      return { toast: "Не удалось проверить занятость" };
    }
    if (clash.length) return { toast: `${time} уже занято: ${clash.map(withoutSelfMark).join(", ")}` };

    // Организатор — тот, кто назначил. Без входа организовать от себя нечем
    // (организатор — это `created_by`), и тогда встреча записывается за
    // автором мысли: он в ней участвует и сможет ею распорядиться.
    const createdBy = me.userId ? (me.userId === me.spaceId ? null : me.userId) : idea.createdBy;
    const meeting = {
      id: uid(),
      user_id: me.spaceId,
      date,
      time,
      title: titleOf(idea),
      participants: people,
      status: "planned",
      result: "",
      duration_min: 30,
      created_by: createdBy,
    };
    const { error } = await admin.from("meetings").insert(meeting);
    if (error) return { toast: "Не получилось назначить встречу" };
    // Строка голоса — у приглашённого автора. Её заводит и триггер
    // (миграция 0024), но «(я)» он пропускает, а автором бывает владелец, —
    // значит upsert с пропуском дублей. Организатору строки не заводим, как
    // и трекер: он идёт на свою встречу по определению (meetingVotes.
    // withOrganizer). Получатель без входа организатором не стал — его
    // строку заведёт тот же триггер по имени.
    if (author && author.id !== me.assigneeId) {
      await admin
        .from("meeting_participants")
        .upsert(
          { meeting_id: meeting.id, assignee_id: author.id, role: "participant" },
          { onConflict: "meeting_id,assignee_id", ignoreDuplicates: true },
        );
    }
    await markAnswered();

    // Приглашение — автору, с теми же кнопками, что у любой встречи.
    let invited = "";
    if (author && author.id !== me.assigneeId) {
      const sent = await sendToPerson(
        admin,
        me.spaceId,
        author,
        meetingMessage({ title: meeting.title, date, time, participants: people }, withoutSelfMark(me.name)),
        meetingButtons(meeting.id),
        { kind: "meeting", itemId: meeting.id },
      );
      invited = sent ? `\nПриглашение ушло: ${withoutSelfMark(author.name)}.` : `\n📭 ${withoutSelfMark(author.name)} не подключён — приглашение не ушло.`;
    }
    return {
      toast: "Назначено",
      rewriteTo: `${head(idea)}\n\n✅ Встреча${withWhom}: ${fmtDate(date)}, ${time}.${invited}`,
    };
  }

  return { toast: "Это действие больше не доступно" };
}

// «Себе»: задача на нажавшего, принятая сразу. Постановщик — автор мысли:
// он её прислал, значит он и поручил (решение 06.10.2026, та же ветка в
// /api/workspace/report).
async function takeForSelf(admin: SupabaseClient, me: Receiver, idea: IdeaRef): Promise<CallbackOutcome> {
  const { data: rec } = await admin
    .from("idea_recipients")
    .select("converted_task_id")
    .eq("idea_id", idea.id)
    .eq("assignee_id", me.assigneeId)
    .maybeSingle();
  if ((rec as { converted_task_id?: string | null } | null)?.converted_task_id) {
    return { toast: "Уже в работе", rewriteTo: `${head(idea)}\n\n➕ Уже взято в работу` };
  }
  const title = titleOf(idea);
  const taskId = uid();
  const { error } = await admin
    .from("tasks")
    .insert(newTaskRow({ id: taskId, userId: me.spaceId, title, assignee: me.name, createdBy: idea.createdBy }));
  if (error) return { toast: "Не получилось завести задачу" };
  // upsert: строку по имени исполнителя успевает завести триггер 0024.
  await admin
    .from("task_participants")
    .upsert(
      { task_id: taskId, assignee_id: me.assigneeId, role: "executor", accepted_at: new Date().toISOString() },
      { onConflict: "task_id,assignee_id" },
    );
  await admin
    .from("idea_recipients")
    .update({ converted_task_id: taskId, seen_at: new Date().toISOString() })
    .eq("idea_id", idea.id)
    .eq("assignee_id", me.assigneeId);
  await notifyAuthor(admin, me.spaceId, idea.createdBy, `➕ ${withoutSelfMark(me.name)} взял мысль в работу: «${title}»`, {
    kind: "idea_taken",
    item: title,
    who: withoutSelfMark(me.name),
  });
  return { toast: "Завёл задачу", rewriteTo: `${head(idea)}\n\n➕ Взято в работу — теперь это ваша задача` };
}

function titleOf(idea: IdeaRef): string {
  return idea.text.trim().slice(0, 200) || "Из мысли";
}

async function receiverByChat(admin: SupabaseClient, chatId: number, channel: BotChannelConfig): Promise<Receiver | null> {
  // Оба вопроса разом: чат либо на строке человека, либо в таблице
  // аккаунтов владельца.
  const [person, ownerSelf] = await Promise.all([
    findColleagueByChat(admin, chatId, channel),
    findOwnerSelfByChat(admin, chatId, channel),
  ]);
  if (ownerSelf) return { assigneeId: ownerSelf.id, name: ownerSelf.name, spaceId: ownerSelf.user_id, userId: ownerSelf.user_id };
  if (!person) return null;
  const { data: member } = await admin
    .from("workspace_members")
    .select("member_id")
    .eq("assignee_id", person.id)
    .eq("status", "active")
    .maybeSingle();
  return { assigneeId: person.id, name: person.name, spaceId: person.user_id, userId: (member as { member_id?: string | null } | null)?.member_id || null };
}

async function loadIdea(admin: SupabaseClient, ideaId: string, spaceId: string): Promise<IdeaRef | null> {
  if (!ideaId) return null;
  const { data } = await admin
    .from("ideas")
    .select("id, text, user_id, created_by")
    .eq("id", ideaId)
    .eq("user_id", spaceId)
    .is("deleted_at", null)
    .maybeSingle();
  const row = data as { id: string; text: string | null; user_id: string; created_by: string | null } | null;
  return row ? { id: row.id, text: String(row.text || ""), userId: row.user_id, createdBy: row.created_by } : null;
}

async function peopleOf(admin: SupabaseClient, spaceId: string): Promise<ColleagueRow[]> {
  const { data } = await admin.from("assignees").select("id, name, telegram_chat_id, max_user_id").eq("user_id", spaceId);
  return sortByPeopleOrder((data || []) as ColleagueRow[], (p) => p.name);
}

// Строка автора мысли в списке людей: руководитель — по членству, владелец
// (пустой created_by) — по метке «(я)».
async function authorRow(admin: SupabaseClient, idea: IdeaRef): Promise<ColleagueRow | null> {
  if (idea.createdBy) {
    const { data: m } = await admin
      .from("workspace_members")
      .select("assignee_id")
      .eq("owner_id", idea.userId)
      .eq("member_id", idea.createdBy)
      .maybeSingle();
    const assigneeId = (m as { assignee_id?: string } | null)?.assignee_id;
    if (!assigneeId) return null;
    const { data } = await admin.from("assignees").select("id, name, telegram_chat_id, max_user_id").eq("id", assigneeId).maybeSingle();
    return (data as ColleagueRow | null) || null;
  }
  const { data } = await admin.from("assignees").select("id, name, telegram_chat_id, max_user_id").eq("user_id", idea.userId);
  return ((data || []) as ColleagueRow[]).find((p) => isSelfAssignee(p.name)) || null;
}
