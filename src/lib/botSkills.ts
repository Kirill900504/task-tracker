import type { SupabaseClient } from "@supabase/supabase-js";
import type { BotButton } from "@/lib/botTransport";
import { encodeCallback, meetingButtons, meetingMessage, type ColleagueRow } from "@/lib/colleagues";
import type { BotActor } from "@/lib/botActor";
import { actorScope, authorFilter } from "@/lib/botActor";
import { findItems, type TaskToMove } from "@/lib/botMoveFlow";
import { MEETING_MOVE_COLUMNS, inPast, type MeetingToMove } from "@/lib/itemMove";
import { dayLabel, fmtWhen, parseDue, parseWhen } from "@/lib/botWhen";
import { bestMatches, coverage } from "@/lib/itemMatch";
import { navRow } from "@/lib/botMenu";
import { applyReview } from "@/lib/reviewWork";
import { actorName, withoutSelfMark } from "@/lib/actorName";
import { attachExecutors, attachMeetingParticipants, selfAssigneeName } from "@/lib/assignExecutors";
import { recordEvent } from "@/lib/itemHistory";
import { sendToPerson } from "@/lib/reach";
import { busyOnServer, busyStartsOnServer } from "@/lib/meetingBusyServer";
import { isSelfAssignee } from "@/lib/trackerRows";
import { dateStr, moscowNow, overdueOn } from "@/lib/taskLogic";
import { ownerTasks } from "@/lib/ownerQueries";
import { createTaskFromBot } from "@/lib/ownerNewTask";
import { nameWasSaid, parseQuickAdd, resolveKnownName } from "@/lib/quickAdd";
import { numbered, taskRef } from "@/lib/taskRef";
import { fmtDate } from "@/lib/taskDisplay";
import { plural } from "@/lib/plural";
import { uid } from "@/lib/uid";

// Десять умений бота словами (20.10.2026, Кирилл: «давай» — на список из
// десяти пунктов «чему научить бота при работе с задачами, мыслями и
// встречами»). Каждое — то, что в трекере уже делается кнопкой или окном;
// здесь его можно сказать одной фразой:
//
//  1. приёмка и возврат — «смету принимаю», «верни смету — нет подписи»;
//  2. люди на задаче — «подключи к смете Игоря», «смету теперь ведёт Наталья»;
//  3. люди на встрече — «добавь Макарова на телемост», «убери Наталью с планёрки»;
//  4. общее свободное время — «когда мы с Игорем свободны в четверг?»;
//  5. напоминание себе — «напомни завтра в 9 про смету»;
//  6. повтор — «каждый понедельник сдавать отчёт» (поле repeat у задачи и встречи);
//  7. мысль → задача — «мысль про склад — задачей Игорю к пятнице»;
//  8. повестка — «на планёрку добавь пункт про закупки»;
//  9. чек-лист — «к смете пункты: цены, подпись», «по смете отметь подпись»;
// 10. поторопить — «напомни Игорю про смету», «поторопи всех по просроченным».
//
// Правила общие с переносом (lib/botMoveFlow): модель называет ЧТО и КОГО
// словами, код находит дело по словам с опечатками и людей — по списку
// (resolveKnownName; имя, которое не прозвучало, не берётся). Право —
// как в трекере: распоряжается тот, кто поставил задачу или назначил
// встречу; выборки идут по актору с фильтром автора. Всё, что меняет
// чужую работу или пишет людям пачкой, сперва показывается и ждёт «да»
// или кнопку (`bot_confirm`); то, что касается только самого человека
// (напоминание себе, пункт повестки, чек-лист), делается сразу.

export type SkillReply = { text: string; buttons?: BotButton[][]; pending?: Record<string, unknown> };

type Role = "executor" | "coexecutor" | "watcher";

export type ConfirmOp =
  | { type: "approve"; taskId: string }
  | { type: "return"; taskId: string; comment: string }
  | { type: "task_people"; taskId: string; add: { name: string; role: Role }[]; remove: string[]; replace: boolean }
  | { type: "meeting_people"; meetingId: string; add: string[]; remove: string[] }
  | { type: "nudge"; taskIds: string[] };

export type ConfirmPending = { kind: "bot_confirm"; op: ConfirmOp; phrase?: string; parsed?: unknown; at: string };

// Подбор времени: люди и день помнятся, пока человек выбирает час и
// называет встречу.
export type SlotPending = { kind: "slot_pick"; people: string[]; date: string; time?: string; at: string };

export type SkillContext = {
  admin: SupabaseClient;
  actor: BotActor;
  reply?: { text: string; item: { kind: "meeting" | "task"; id: string } | null } | null;
  phrase: string;
  parsed: unknown;
};

const CONFIRM_BUTTONS: BotButton[][] = [
  [
    { text: "✅ Да", data: encodeCallback("task", "cfgo", "x") },
    { text: "✖ Не надо", data: encodeCallback("task", "cfno", "x") },
  ],
];

function confirm(ctx: SkillContext, op: ConfirmOp, text: string): SkillReply {
  const pending: ConfirmPending = { kind: "bot_confirm", op, phrase: ctx.phrase, parsed: ctx.parsed, at: new Date().toISOString() };
  return { text: text + "\n\nНажмите «Да» или ответьте «да».", buttons: CONFIRM_BUTTONS, pending };
}

function today(): string {
  return dateStr(moscowNow());
}

function short(text: string, limit: number): string {
  return text.length > limit ? text.slice(0, limit - 1) + "…" : text;
}

function list(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === "string" && !!v.trim()).map((v) => v.trim());
  return typeof value === "string" && value.trim() ? [value.trim()] : [];
}

async function knownPeople(admin: SupabaseClient, spaceId: string): Promise<string[]> {
  const { data } = await admin.from("assignees").select("name").eq("user_id", spaceId).is("archived_at", null);
  return ((data || []) as { name: string }[]).map((r) => r.name);
}

// Имена из фразы → имена из списка людей. Не прозвучавшее во фразе не
// берётся (то же правило, что nameWasSaid в quickAdd): модель любит
// подставлять человека из подсказки.
function resolvePeople(raw: string[], known: string[], said: string): { found: string[]; missing: string[] } {
  const found: string[] = [];
  const missing: string[] = [];
  for (const name of raw) {
    const hit = resolveKnownName(name, known);
    if (hit && nameWasSaid(hit, said)) {
      if (!found.includes(hit)) found.push(hit);
    } else missing.push(name);
  }
  return { found, missing };
}

function missingNote(missing: string[]): string {
  return missing.length ? `\n⚠ Не нашёл среди людей: ${missing.join(", ")}.` : "";
}

// Имя того, кто пишет, в списке людей — для «мы с Игорем».
async function myName(admin: SupabaseClient, actor: BotActor): Promise<string> {
  if (actor.isOwner) return selfAssigneeName(admin, actor.spaceId);
  const { data } = await admin.from("assignees").select("name").eq("id", actor.assigneeId).maybeSingle();
  return (data as { name?: string } | null)?.name || "";
}

function notMe(actor: BotActor) {
  return (p: ColleagueRow) => !(actor.isOwner && isSelfAssignee(p.name || "")) && p.id !== actor.assigneeId;
}

async function oneTask(ctx: SkillContext, query: string, verb: string): Promise<{ task: TaskToMove } | { reply: SkillReply }> {
  const { tasks, found } = await findItems(ctx.admin, ctx.actor, { itemType: "task", query, replyText: ctx.reply?.text, replyItem: ctx.reply?.item });
  const hits = found.filter((f): f is { kind: "task"; t: TaskToMove } => f.kind === "task").map((f) => f.t);
  if (hits.length === 1) return { task: hits[0] };
  const button = (t: TaskToMove) => [{ text: `📋 ${short(numbered(t), 32)}`, data: encodeCallback("task", "oshow", t.id) }];
  if (!hits.length) {
    if (!tasks.length) return { reply: { text: "Не нашёл задач, которые вы поставили и которые ещё открыты." } };
    return { reply: { text: `Не нашёл задачу${query ? ` «${query}»` : ""} среди поставленных вами. Откройте нужную — ${verb} можно в её карточке:`, buttons: [...tasks.slice(0, 6).map(button), ...navRow("assigner")] } };
  }
  return { reply: { text: "Нашёл несколько — о какой речь? Откройте её:", buttons: hits.slice(0, 6).map(button) } };
}

async function oneMeeting(ctx: SkillContext, query: string): Promise<{ meeting: MeetingToMove } | { reply: SkillReply }> {
  const { meetings, found } = await findItems(ctx.admin, ctx.actor, { itemType: "meeting", query, replyText: ctx.reply?.text, replyItem: ctx.reply?.item });
  const hits = found.filter((f): f is { kind: "meeting"; m: MeetingToMove } => f.kind === "meeting").map((f) => f.m);
  if (hits.length === 1) return { meeting: hits[0] };
  const button = (m: MeetingToMove) => [{ text: `📅 ${dayLabel(m.date)} ${short(m.title, 26)}`, data: encodeCallback("meeting", "oshow", m.id) }];
  if (!hits.length) {
    if (!meetings.length) return { reply: { text: "Не нашёл назначенных вами открытых встреч." } };
    return { reply: { text: `Не нашёл встречу${query ? ` «${query}»` : ""} среди назначенных вами. Откройте нужную:`, buttons: [...meetings.slice(0, 6).map(button), ...navRow("assigner")] } };
  }
  return { reply: { text: "Нашёл несколько — о какой речь?", buttons: hits.slice(0, 6).map(button) } };
}

async function loadTask(admin: SupabaseClient, actor: BotActor, id: string) {
  const { data } = await admin
    .from("tasks")
    .select("id, title, number, description, deadline, user_id, status")
    .eq("id", id)
    .match(actorScope(actor))
    .or(authorFilter(actor))
    .is("deleted_at", null)
    .maybeSingle();
  return data as { id: string; title: string; number: number | null; description: string | null; deadline: string | null; user_id: string; status: string | null } | null;
}

async function loadMeeting(admin: SupabaseClient, actor: BotActor, id: string): Promise<MeetingToMove | null> {
  const { data } = await admin.from("meetings").select(MEETING_MOVE_COLUMNS).eq("id", id).match(actorScope(actor)).or(authorFilter(actor)).is("deleted_at", null).maybeSingle();
  return (data as MeetingToMove | null) || null;
}

async function idsOf(admin: SupabaseClient, spaceId: string, names: string[]): Promise<string[]> {
  if (!names.length) return [];
  const { data } = await admin.from("assignees").select("id").eq("user_id", spaceId).in("name", names);
  return ((data || []) as { id: string }[]).map((r) => r.id);
}

// =============================================================== 1. приёмка

export async function planReview(ctx: SkillContext, input: Record<string, unknown>): Promise<SkillReply> {
  const got = await oneTask(ctx, String(input.query || ""), "принять или вернуть");
  if ("reply" in got) return got.reply;
  const t = got.task;
  if (String(input.verdict || "") === "return") {
    const comment = String(input.comment || "").trim();
    if (!comment) {
      // Без причины не возвращают — та же память, что у кнопки «↩ Вернуть».
      return {
        text: `↩ ${taskRef(t)}\n\nНапишите следующим сообщением, что именно доделать, — отправлю исполнителям.`,
        pending: { kind: "review_return", taskId: t.id, title: t.title },
      };
    }
    return confirm(ctx, { type: "return", taskId: t.id, comment }, `↩ Вернуть на доработку ${taskRef(t)}?\nЧто доделать: ${comment}`);
  }
  return confirm(ctx, { type: "approve", taskId: t.id }, `✅ Принять работу по ${taskRef(t)} и закрыть задачу?`);
}

// =========================================================== 2. люди задачи

export async function planTaskPeople(ctx: SkillContext, input: Record<string, unknown>): Promise<SkillReply> {
  const got = await oneTask(ctx, String(input.query || ""), "поменять людей");
  if ("reply" in got) return got.reply;
  const t = got.task;
  const known = await knownPeople(ctx.admin, ctx.actor.spaceId);
  const roles: [string, Role][] = [
    ["executors", "executor"],
    ["coexecutors", "coexecutor"],
    ["watchers", "watcher"],
  ];
  const add: { name: string; role: Role }[] = [];
  const missing: string[] = [];
  for (const [field, role] of roles) {
    const r = resolvePeople(list(input[field]), known, ctx.phrase);
    for (const name of r.found) if (!add.some((a) => a.name === name)) add.push({ name, role });
    missing.push(...r.missing);
  }
  const rem = resolvePeople(list(input.remove), known, ctx.phrase);
  missing.push(...rem.missing);
  const replace = input.replace === true && add.some((a) => a.role === "executor");
  if (!add.length && !rem.found.length) return { text: `Не понял, кого подключить или снять с ${taskRef(t)}.${missingNote(missing)}` };
  const words: Record<Role, string> = { executor: "исполнителем", coexecutor: "соисполнителем", watcher: "наблюдателем" };
  const lines = [`👥 ${taskRef(t)}`];
  for (const a of add) lines.push(`➕ ${withoutSelfMark(a.name)} — ${words[a.role]}`);
  if (replace) lines.push("➖ прежние исполнители снимаются");
  for (const name of rem.found) lines.push(`➖ ${withoutSelfMark(name)} — снять с задачи`);
  return confirm(ctx, { type: "task_people", taskId: t.id, add, remove: rem.found, replace }, lines.join("\n") + missingNote(missing));
}

type PartRow = { assignee_id: string; role: Role; assignees: ColleagueRow | ColleagueRow[] | null };

async function runTaskPeople(admin: SupabaseClient, actor: BotActor, op: Extract<ConfirmOp, { type: "task_people" }>): Promise<string> {
  const task = await loadTask(admin, actor, op.taskId);
  if (!task) return "Эта задача не найдена — людей меняет тот, кто её поставил.";
  const createdBy = actor.isOwner ? null : actor.userId;
  const done: string[] = [];
  for (const role of ["executor", "coexecutor", "watcher"] as Role[]) {
    const names = op.add.filter((a) => a.role === role).map((a) => a.name);
    if (!names.length) continue;
    const r = await attachExecutors(admin, actor.spaceId, { ...task, description: task.description || "" }, names, role, createdBy);
    // Уже стоявшего в другой роли ставим в названную: «теперь ведёт
    // Наталья» о соисполнителе Наталье значит «исполнитель».
    const ids = await idsOf(admin, actor.spaceId, names);
    if (ids.length) await admin.from("task_participants").update({ role }).eq("task_id", task.id).in("assignee_id", ids);
    if (r.attached.length) done.push(`подключил: ${r.attached.map(withoutSelfMark).join(", ")}`);
  }

  const { data: partsRaw } = await admin.from("task_participants").select("assignee_id, role, assignees(id, name, telegram_chat_id, max_user_id)").eq("task_id", task.id);
  const parts = (partsRaw || []) as PartRow[];
  const person = (p: PartRow) => (Array.isArray(p.assignees) ? p.assignees[0] : p.assignees);
  const newExec = new Set(op.add.filter((a) => a.role === "executor").map((a) => a.name));
  const dropping = parts.filter((p) => {
    const name = person(p)?.name || "";
    if (op.remove.includes(name)) return true;
    return op.replace && p.role === "executor" && !newExec.has(name);
  });
  const leftExecutors = parts.filter((p) => p.role === "executor" && !dropping.includes(p));
  // Последнего исполнителя не снимают — задачи без исполнителя не бывает.
  if (dropping.length && !leftExecutors.length) {
    return (done.length ? "✓ " + done.join("; ") + "\n" : "") + "Последнего исполнителя не снимаю: у задачи должен остаться исполнитель. Назовите, кто ведёт её вместо него.";
  }
  if (dropping.length) {
    await admin.from("task_participants").delete().eq("task_id", task.id).in("assignee_id", dropping.map((p) => p.assignee_id));
    const removed = dropping.map((p) => person(p)).filter((p): p is ColleagueRow => !!p);
    done.push(`снял: ${removed.map((p) => withoutSelfMark(p.name)).join(", ")}`);
    await Promise.all(removed.filter(notMe(actor)).map((p) => sendToPerson(admin, actor.spaceId, p, `👥 Вас сняли с задачи ${taskRef(task)} — делать её больше не нужно.`)));
  }
  // Имя на карточке — первый исполнитель (то же, что делает окно задачи).
  const first = leftExecutors.map((p) => person(p)?.name).find(Boolean) || [...newExec][0];
  if (first) await admin.from("tasks").update({ assignee: first }).eq("id", task.id);
  if (!done.length) return "Ничего не поменялось: эти люди уже стоят на задаче так.";
  const who = await actorName(admin, actor.spaceId, actor.userId);
  await recordEvent(admin, { actorUserId: actor.userId, userId: actor.spaceId, kind: "task", itemId: task.id, text: `👥 ${who} ${done.join("; ")}` });
  return `✓ ${taskRef(task)}: ${done.join("; ")}.`;
}

// ========================================================= 3. люди встречи

export async function planMeetingPeople(ctx: SkillContext, input: Record<string, unknown>): Promise<SkillReply> {
  const got = await oneMeeting(ctx, String(input.query || ""));
  if ("reply" in got) return got.reply;
  const m = got.meeting;
  const known = await knownPeople(ctx.admin, ctx.actor.spaceId);
  const add = resolvePeople(list(input.add), known, ctx.phrase);
  const rem = resolvePeople(list(input.remove), known, ctx.phrase);
  const current = new Set(m.participants || []);
  const adding = add.found.filter((n) => !current.has(n));
  const removing = rem.found.filter((n) => current.has(n));
  const notes = missingNote([...add.missing, ...rem.missing]);
  if (!adding.length && !removing.length) return { text: `В составе «${m.title}» ничего не меняется: ${add.found.length ? "эти люди уже позваны" : "этих людей там нет"}.${notes}` };
  if (adding.length && m.time) {
    let clash: string[] = [];
    try {
      clash = await busyOnServer(ctx.admin, { spaceId: m.user_id, date: m.date, time: m.time, durationMin: m.duration_min ?? 30, people: adding, ignore: [m.id] });
    } catch {
      clash = [];
    }
    if (clash.length) return { text: `Не зову: ${clash.map(withoutSelfMark).join(", ")} в ${fmtWhen(m.date, m.time)} уже на другой встрече.${notes}` };
  }
  const lines = [`👥 «${m.title}» (${fmtWhen(m.date, m.time || "")})`];
  for (const n of adding) lines.push(`➕ позвать ${withoutSelfMark(n)} — придёт приглашение`);
  for (const n of removing) lines.push(`➖ убрать ${withoutSelfMark(n)}`);
  return confirm(ctx, { type: "meeting_people", meetingId: m.id, add: adding, remove: removing }, lines.join("\n") + notes);
}

async function runMeetingPeople(admin: SupabaseClient, actor: BotActor, op: Extract<ConfirmOp, { type: "meeting_people" }>): Promise<string> {
  const m = await loadMeeting(admin, actor, op.meetingId);
  if (!m) return "Эта встреча не найдена — состав меняет тот, кто её назначил.";
  if (m.status === "success" || m.status === "no_result") return `Встреча «${m.title}» уже закрыта.`;
  const before = m.participants || [];
  const next = [...before.filter((n) => !op.remove.includes(n)), ...op.add.filter((n) => !before.includes(n))];
  const { error } = await admin.from("meetings").update({ participants: next }).eq("id", m.id);
  if (error) return "Не получилось поменять состав: " + error.message;
  const done: string[] = [];
  if (op.add.length) {
    await attachMeetingParticipants(admin, m.user_id, m.id, op.add);
    const { data } = await admin.from("assignees").select("id, name, telegram_chat_id, max_user_id").eq("user_id", m.user_id).in("name", op.add);
    const from = withoutSelfMark(await actorName(admin, m.user_id, actor.userId));
    await Promise.all(
      ((data || []) as ColleagueRow[])
        .filter(notMe(actor))
        .map((p) => sendToPerson(admin, m.user_id, p, meetingMessage({ title: m.title, date: m.date, time: m.time, participants: next }, from), meetingButtons(m.id), { kind: "meeting", itemId: m.id })),
    );
    done.push(`позвал: ${op.add.map(withoutSelfMark).join(", ")}`);
  }
  if (op.remove.length) {
    const { data } = await admin.from("assignees").select("id, name, telegram_chat_id, max_user_id").eq("user_id", m.user_id).in("name", op.remove);
    const people = (data || []) as ColleagueRow[];
    if (people.length) await admin.from("meeting_participants").delete().eq("meeting_id", m.id).in("assignee_id", people.map((p) => p.id));
    await Promise.all(
      people.filter(notMe(actor)).map((p) => sendToPerson(admin, m.user_id, p, `👥 Встреча «${m.title}» (${fmtWhen(m.date, m.time || "")}) пройдёт без вас — организатор убрал вас из состава.`)),
    );
    done.push(`убрал: ${op.remove.map(withoutSelfMark).join(", ")}`);
  }
  const who = await actorName(admin, m.user_id, actor.userId);
  await recordEvent(admin, { actorUserId: actor.userId, userId: m.user_id, kind: "meeting", itemId: m.id, text: `👥 ${who} ${done.join("; ")}` });
  return `✓ «${m.title}»: ${done.join("; ")}.`;
}

// ===================================================== 4. общее свободное

const DAY_SLOTS = ["09:00", "09:30", "10:00", "10:30", "11:00", "11:30", "12:00", "12:30", "13:00", "14:00", "14:30", "15:00", "15:30", "16:00", "16:30", "17:00", "17:30"];

export async function planFindSlot(ctx: SkillContext, input: Record<string, unknown>): Promise<SkillReply> {
  const known = await knownPeople(ctx.admin, ctx.actor.spaceId);
  const r = resolvePeople(list(input.participants), known, ctx.phrase);
  const me = await myName(ctx.admin, ctx.actor);
  const people = [...new Set([me, ...r.found].filter(Boolean))];
  if (people.length < 2) return { text: `С кем искать время? Назовите людей: «когда мы с Игорем свободны в четверг?»${missingNote(r.missing)}` };
  const t = today();
  const when = parseWhen(String(input.when || ctx.phrase), t);
  return slotScreen(ctx.admin, ctx.actor, people, when.date || t, r.missing);
}

function nextWorkday(date: string): string {
  const d = new Date(date + "T00:00:00Z");
  do d.setUTCDate(d.getUTCDate() + 1);
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6);
  return d.toISOString().slice(0, 10);
}

async function slotScreen(admin: SupabaseClient, actor: BotActor, people: string[], date: string, missing: string[] = []): Promise<SkillReply> {
  const slots = DAY_SLOTS.filter((s) => !inPast(date, s));
  let busy = new Set<string>();
  try {
    busy = await busyStartsOnServer(admin, { spaceId: actor.spaceId, date, durationMin: 30, people, slots });
  } catch {
    return { text: "Не получилось прочитать занятость — попробуйте ещё раз." };
  }
  const free = slots.filter((s) => !busy.has(s));
  const who = people.map(withoutSelfMark).join(", ");
  const after = nextWorkday(date);
  const pending: SlotPending = { kind: "slot_pick", people, date, at: new Date().toISOString() };
  const more = [{ text: `→ ${dayLabel(after)}`, data: encodeCallback("meeting", "fsd", `x.${after.replace(/-/g, "")}`) }];
  if (!free.length) return { text: `🗓 ${dayLabel(date)}: свободного получаса у всех (${who}) нет.${missingNote(missing)}`, buttons: [more], pending };
  const shown = free.slice(0, 12);
  const rows: BotButton[][] = [];
  for (let i = 0; i < shown.length; i += 4) {
    rows.push(shown.slice(i, i + 4).map((s) => ({ text: s, data: encodeCallback("meeting", "fsl", `x.${date.replace(/-/g, "")}${s.replace(":", "")}`) })));
  }
  rows.push(more);
  return {
    text: `🗓 ${dayLabel(date)} свободны все (${who}):\n${free.join(", ")}\n\nНажмите время — назначу встречу (полчаса).${missingNote(missing)}`,
    buttons: rows,
    pending,
  };
}

// Кнопки подбора: «→ следующий день» и время. Время ведёт к вопросу
// «как назвать», ответ на который и заводит встречу (createMeetingFromBot).
export async function handleSlotCallback(admin: SupabaseClient, actor: BotActor, action: { action: string; id: string }, pending: SlotPending | null): Promise<SkillReply & { toast: string }> {
  if (!pending || pending.kind !== "slot_pick") return { toast: "Подбор устарел", text: "Подбор времени устарел — спросите заново: «когда мы с Игорем свободны в четверг?»" };
  const raw = action.id.split(".")[1] || "";
  const date = raw.length >= 8 ? `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}` : "";
  if (!date) return { toast: "Не понял день", text: "Не понял день." };
  if (action.action === "fsd") return { toast: dayLabel(date), ...(await slotScreen(admin, actor, pending.people, date)) };
  const time = raw.length === 12 ? `${raw.slice(8, 10)}:${raw.slice(10, 12)}` : "";
  if (!time) return { toast: "Не понял время", text: "Не понял время." };
  return {
    toast: time,
    text: `📅 ${dayLabel(date)}, ${time} — ${pending.people.map(withoutSelfMark).join(", ")}.\n\nКак назвать встречу? Напишите тему одним сообщением.`,
    pending: { ...pending, date, time },
  };
}

// Встреча из бота — с приглашениями. Назначенная фразой встреча до
// 20.10.2026 заводилась без единого сообщения людям: строки участия были,
// а узнавали о встрече из напоминания за сутки. Приглашение — как у
// мысли, ставшей встречей (lib/ideaInbox).
export async function createMeetingFromBot(
  admin: SupabaseClient,
  actor: BotActor,
  input: { title: string; date: string; time: string; participants: string[]; durationMin?: number; recur?: string },
): Promise<{ ok: boolean; text: string; id?: string }> {
  const people = [...new Set(input.participants.filter(Boolean))];
  if (input.time && inPast(input.date, input.time)) return { ok: false, text: `${fmtWhen(input.date, input.time)} уже прошло — назовите время впереди.` };
  let clash: string[] = [];
  try {
    clash = await busyOnServer(admin, { spaceId: actor.spaceId, date: input.date, time: input.time, durationMin: input.durationMin ?? 30, people });
  } catch (e) {
    return { ok: false, text: "Встречу не назначил: " + (e instanceof Error ? e.message : String(e)) };
  }
  if (clash.length) return { ok: false, text: `Встречу не назначил: ${fmtWhen(input.date, input.time)} уже на другой встрече — ${clash.map(withoutSelfMark).join(", ")}. Назовите другое время.` };
  const id = uid();
  const { error } = await admin.from("meetings").insert({
    id,
    user_id: actor.spaceId,
    created_by: actor.isOwner ? null : actor.userId,
    date: input.date,
    time: input.time,
    title: input.title,
    participants: people,
    status: "planned",
    result: "",
    duration_min: input.durationMin ?? 30,
    recur: input.recur || "none",
  });
  if (error) return { ok: false, text: "Не получилось сохранить встречу: " + error.message };
  await attachMeetingParticipants(admin, actor.spaceId, id, people);
  let delivered = 0;
  if (people.length) {
    const { data } = await admin.from("assignees").select("id, name, telegram_chat_id, max_user_id").eq("user_id", actor.spaceId).in("name", people);
    const from = withoutSelfMark(await actorName(admin, actor.spaceId, actor.userId));
    const sent = await Promise.all(
      ((data || []) as ColleagueRow[])
        .filter(notMe(actor))
        .map((p) => sendToPerson(admin, actor.spaceId, p, meetingMessage({ title: input.title, date: input.date, time: input.time, participants: people }, from), meetingButtons(id), { kind: "meeting", itemId: id })),
    );
    delivered = sent.filter(Boolean).length;
  }
  return {
    ok: true,
    id,
    text: [`✓ Встреча: «${input.title}»`, fmtWhen(input.date, input.time), people.length ? "Участники: " + people.map(withoutSelfMark).join(", ") : "", delivered ? `Приглашений отправлено: ${delivered}` : ""].filter(Boolean).join("\n"),
  };
}

// ==================================================== 5. напоминание себе

export async function planReminder(ctx: SkillContext, input: Record<string, unknown>, chat: { channel: "telegram" | "max"; chatId: number }): Promise<SkillReply> {
  const what = String(input.what || "").trim() || ctx.phrase;
  const due = parseDue(String(input.when || "") || ctx.phrase, moscowNow());
  if (!due) return { text: "Когда напомнить? Например: «напомни завтра в 9 про смету», «через 2 часа позвонить в банк»." };
  const { data, error } = await ctx.admin
    .from("bot_reminders")
    .insert({ user_id: ctx.actor.spaceId, actor: ctx.actor.isOwner ? ctx.actor.spaceId : ctx.actor.userId, channel: chat.channel, chat_id: chat.chatId, due_at: due.at, body: what.slice(0, 500) })
    .select("id")
    .maybeSingle();
  if (error || !data) return { text: "Не получилось запомнить напоминание — попробуйте ещё раз." };
  return {
    text: `⏰ Напомню ${due.label}: «${short(what, 120)}»`,
    buttons: [[{ text: "✖ Не напоминать", data: encodeCallback("task", "rmx", (data as { id: string }).id) }]],
  };
}

// ============================================ 7. мысль → задача одной фразой

export async function ideaToTask(ctx: SkillContext, input: Record<string, unknown>): Promise<SkillReply> {
  const query = String(input.query || "").trim();
  const { data } = await ctx.admin
    .from("ideas")
    .select("id, text")
    .match(actorScope(ctx.actor))
    .or(authorFilter(ctx.actor))
    .eq("done", false)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(100);
  const ideas = ((data || []) as { id: string; text: string }[]).map((i) => ({ ...i, title: i.text }));
  const hits = query ? bestMatches(ideas, query) : [];
  if (hits.length !== 1) {
    if (!ideas.length) return { text: "Открытых мыслей нет." };
    return {
      text: hits.length ? "Нашёл несколько мыслей — какую в задачу?" : `Не нашёл мысль${query ? ` «${query}»` : ""}. Выберите:`,
      buttons: [...(hits.length ? hits : ideas).slice(0, 6).map((i) => [{ text: `💡 ${short(i.text, 30)}`, data: encodeCallback("idea", "itask", i.id) }]), ...navRow("assigner")],
    };
  }
  const idea = hits[0];
  const known = await knownPeople(ctx.admin, ctx.actor.spaceId);
  const r = resolvePeople(list(input.assignee), known, ctx.phrase);
  const executor = r.found[0] || (await myName(ctx.admin, ctx.actor));
  const deadline = parseWhen(String(input.when || ""), today()).date || "";
  const created = await createTaskFromBot(
    ctx.admin,
    ctx.actor.spaceId,
    short(idea.text.replace(/\s+/g, " ").trim(), 200),
    [{ name: executor, role: "executor" }],
    deadline,
    ctx.actor.isOwner ? null : ctx.actor.userId,
    idea.text.length > 200 ? idea.text : "",
  );
  await ctx.admin.from("ideas").update({ done: true, done_at: new Date().toISOString() }).eq("id", idea.id);
  return { text: `💡→📋 ${created.text}${missingNote(r.missing)}`, buttons: navRow("assigner") };
}

// =================================================================== 8. повестка

export async function addAgenda(ctx: SkillContext, input: Record<string, unknown>): Promise<SkillReply> {
  const items = list(input.items).map((s) => s.slice(0, 500));
  if (!items.length) return { text: "Какой пункт добавить в повестку? Например: «на планёрку добавь пункт про закупки»." };
  const got = await oneMeeting(ctx, String(input.query || ""));
  if ("reply" in got) return got.reply;
  const m = got.meeting;
  const { data: last } = await ctx.admin.from("meeting_agenda").select("position").eq("meeting_id", m.id).order("position", { ascending: false }).limit(1);
  const start = ((last || []) as { position: number }[])[0]?.position ?? -1;
  const author = ctx.actor.isOwner ? ctx.actor.spaceId : ctx.actor.userId;
  const { error } = await ctx.admin.from("meeting_agenda").insert(items.map((text, i) => ({ meeting_id: m.id, text, position: start + 1 + i, author_id: author, user_id: m.user_id })));
  if (error) return { text: "Не получилось добавить в повестку: " + error.message };
  const { data: all } = await ctx.admin.from("meeting_agenda").select("text").eq("meeting_id", m.id).order("position");
  const lines = ((all || []) as { text: string }[]).map((a, i) => `${i + 1}. ${a.text}`);
  return { text: `📝 Повестка «${m.title}» (${fmtWhen(m.date, m.time || "")}):\n${lines.join("\n")}`, buttons: [[{ text: "📅 Открыть встречу", data: encodeCallback("meeting", "oshow", m.id) }]] };
}

// =================================================================== 9. чек-лист
//
// Чек-лист ведут постановщик, исполнители и соисполнители, наблюдатель
// смотрит (миграция 0059, так же в трекере). До 20.10.2026 бот искал
// задачу только среди ПОСТАВЛЕННЫХ человеком — и исполнитель, ради которого
// чек-лист и заводят, отметить пункт словами не мог. Его слова: «сделай,
// чтобы исполнитель тоже мог отмечать чек-лист словами». Теперь задача
// ищется и среди тех, где человек исполнитель или соисполнитель, — в том
// числе у коллеги без входа в трекер (checklistForPerson ниже). Добавлять
// пункты может только тот, у кого есть вход: у строки чек-листа автор —
// учётная запись, и приписать пункт чужому имени было бы подлогом.

type ChecklistWho = { spaceId: string; authId: string | null; assigneeId: string | null; actor: BotActor | null };
type ChecklistTask = { id: string; title: string; number: number | null; user_id: string };

async function selfRowId(admin: SupabaseClient, spaceId: string): Promise<string | null> {
  const { data } = await admin.from("assignees").select("id").eq("user_id", spaceId).like("name", "%(я)").order("created_at").limit(1).maybeSingle();
  return (data as { id: string } | null)?.id || null;
}

// Открытые задачи, где этот человек ведёт чек-лист: поставленные им и те,
// где он исполнитель или соисполнитель. Закрытые — только просмотр
// (lib/closedItem), их здесь нет.
async function checklistTasks(admin: SupabaseClient, who: ChecklistWho): Promise<ChecklistTask[]> {
  const out = new Map<string, ChecklistTask>();
  const cols = "id, title, number, user_id, status, approval_state";
  type Raw = ChecklistTask & { status: string | null; approval_state: string | null };
  const open = (t: Raw) => t.status !== "done" && t.approval_state !== "accepted";
  if (who.actor) {
    const { data } = await admin.from("tasks").select(cols).match(actorScope(who.actor)).or(authorFilter(who.actor)).is("deleted_at", null).limit(200);
    for (const t of (data || []) as Raw[]) if (open(t)) out.set(t.id, t);
  }
  if (who.assigneeId) {
    const { data: parts } = await admin.from("task_participants").select("task_id").eq("assignee_id", who.assigneeId).in("role", ["executor", "coexecutor"]);
    const ids = ((parts || []) as { task_id: string }[]).map((p) => p.task_id).filter((id) => !out.has(id));
    if (ids.length) {
      const { data } = await admin.from("tasks").select(cols).in("id", ids).eq("user_id", who.spaceId).is("deleted_at", null);
      for (const t of (data || []) as Raw[]) if (open(t)) out.set(t.id, t);
    }
  }
  return [...out.values()];
}

async function runChecklist(
  admin: SupabaseClient,
  who: ChecklistWho,
  input: Record<string, unknown>,
  reply: SkillContext["reply"],
  phrase: string,
): Promise<SkillReply> {
  const add = list(input.add).map((s) => s.slice(0, 500));
  const done = list(input.done);
  // «Отметь цены» модель порой кладёт в add, а не в done (поймано
  // test:bots 21.10.2026: в чек-листе появился второй пункт «цены»). Глагол
  // отметки во фразе решает за неё — см. ниже, где add сверяется с тем,
  // что в чек-листе уже есть.
  // Узко нарочно: «выполнить проверку» или «отметить в 1С» — это пункты, а
  // не отметка, и широкое «выполн|отмет» перестало бы их заводить.
  const tick = /(отметь|отмечаю|отметил[аи]?(?![а-я])|готово|сделал[аи]?(?![а-я])|сделано|выполнил[аи]?(?![а-я])|выполнено|вычеркн|галочк)/i.test(phrase);
  if (tick) for (const a of add) if (!done.includes(a)) done.push(a);
  if (!add.length && !done.length) return { text: "Что добавить в чек-лист или отметить? Например: «к смете пункты: цены, подпись» или «по смете отметь подпись»." };

  const tasks = await checklistTasks(admin, who);
  const query = String(input.query || "").trim();
  let hits: ChecklistTask[] = [];
  if (reply?.item?.kind === "task") hits = tasks.filter((t) => t.id === reply.item!.id);
  if (!hits.length && query) hits = bestMatches(tasks, query);
  if (!hits.length && reply?.text?.trim()) {
    const scored = tasks.map((t) => ({ t, s: coverage(t.title, reply.text) })).filter((x) => x.s >= 0.6).sort((a, b) => b.s - a.s);
    if (scored.length) hits = scored.filter((x) => x.s >= scored[0].s - 0.001).map((x) => x.t);
  }
  // Не назвали задачу, а пункт с таким текстом есть ровно в одной — она.
  if (!hits.length && !query && done.length && tasks.length) {
    const { data: rows } = await admin.from("task_checklist").select("task_id, text").in("task_id", tasks.map((t) => t.id)).eq("done", false);
    const owners = new Set(
      ((rows || []) as { task_id: string; text: string }[]).filter((r) => done.some((d) => bestMatches([{ title: r.text }], d).length)).map((r) => r.task_id),
    );
    if (owners.size === 1) hits = tasks.filter((t) => owners.has(t.id));
  }
  const button = (t: ChecklistTask) => [{ text: `☑️ ${short(numbered(t), 32)}`, data: encodeCallback("task", who.actor ? "oshow" : "show", t.id) }];
  if (!hits.length) {
    if (!tasks.length) return { text: "Не нашёл открытых задач, где вы ведёте чек-лист (поставили сами, исполнитель или соисполнитель)." };
    return { text: `Не понял, в какой задаче${query ? ` «${query}»` : ""}. Назовите её — например: «по смете отметь подпись». Ваши задачи:`, buttons: tasks.slice(0, 6).map(button) };
  }
  if (hits.length > 1) return { text: "Нашёл несколько задач — в какой? Назовите её точнее:", buttons: hits.slice(0, 6).map(button) };
  const t = hits[0];

  const { data: rows } = await admin.from("task_checklist").select("id, text, position, done").eq("task_id", t.id).order("position");
  const items = (rows || []) as { id: string; text: string; position: number; done: boolean }[];
  const notes: string[] = [];
  // Пункт, который в чек-листе уже есть, второй раз не заводится: при
  // глаголе отметки он отмечается (он уже в done выше), без него — просто
  // пропускается.
  const fresh = add.filter((a) => !items.some((i) => i.text.trim().toLowerCase() === a.trim().toLowerCase() || bestMatches([{ title: i.text }], a, 1).length));
  const addNow = tick ? [] : fresh;
  if (addNow.length) {
    if (!who.authId) {
      notes.push("Добавлять пункты можно из трекера или попросив постановщика — отмечать готовые можно и здесь.");
    } else {
      const start = items.length ? Math.max(...items.map((i) => i.position)) + 1 : 0;
      const { error } = await admin.from("task_checklist").insert(addNow.map((text, i) => ({ task_id: t.id, text, position: start + i, author_id: who.authId, user_id: t.user_id })));
      if (error) return { text: "Не получилось добавить пункты: " + error.message };
    }
  }
  const missed: string[] = [];
  for (const d of done) {
    const hit = bestMatches(items.filter((i) => !i.done).map((i) => ({ ...i, title: i.text })), d);
    if (hit.length !== 1) {
      missed.push(d);
      continue;
    }
    await admin.from("task_checklist").update({ done: true, done_by: who.authId, done_at: new Date().toISOString() }).eq("id", hit[0].id);
  }
  const { data: after } = await admin.from("task_checklist").select("text, done").eq("task_id", t.id).order("position");
  const now = (after || []) as { text: string; done: boolean }[];
  const ready = now.filter((i) => i.done).length;
  if (missed.length) notes.push(`⚠ Не нашёл среди неотмеченных: ${missed.join(", ")}`);
  return {
    text: `☑️ ${taskRef(t)} — ${ready}/${now.length}\n${now.map((i) => `${i.done ? "✅" : "▫️"} ${i.text}`).join("\n")}${notes.length ? "\n" + notes.join("\n") : ""}`,
    buttons: [button(t)],
  };
}

export async function editChecklist(ctx: SkillContext, input: Record<string, unknown>): Promise<SkillReply> {
  const a = ctx.actor;
  const assigneeId = a.isOwner ? await selfRowId(ctx.admin, a.spaceId) : a.assigneeId || null;
  return runChecklist(ctx.admin, { spaceId: a.spaceId, authId: a.isOwner ? a.spaceId : a.userId, assigneeId, actor: a }, input, ctx.reply, ctx.phrase);
}

// Коллега без входа в трекер: его свободный текст обычно уходит репликой в
// обсуждение. Фразу про чек-лист разбирает модель, и если это он — пункт
// отмечается, а не пишется в ленту. Не чек-лист — null, и разбор идёт
// дальше как раньше.
export async function checklistForPerson(
  admin: SupabaseClient,
  person: { id: string; name: string; user_id: string },
  text: string,
): Promise<SkillReply | null> {
  const known = await knownPeople(admin, person.user_id);
  let items;
  try {
    ({ items } = await parseQuickAdd(text, known));
  } catch {
    return null;
  }
  const item = items.find((it) => it.tool === "checklist");
  if (!item) return null;
  return runChecklist(admin, { spaceId: person.user_id, authId: null, assigneeId: person.id, actor: null }, item.input, null, text);
}

// ================================================================ 10. поторопить

async function pingTask(admin: SupabaseClient, actor: BotActor, taskId: string): Promise<number> {
  const task = await loadTask(admin, actor, taskId);
  if (!task) return 0;
  const { data } = await admin.from("task_participants").select("done_at, declined_at, assignees(id, name, telegram_chat_id, max_user_id)").eq("task_id", task.id).in("role", ["executor", "coexecutor"]);
  type Row = { done_at: string | null; declined_at: string | null; assignees: ColleagueRow | ColleagueRow[] | null };
  // Отчитавшихся и отказавшихся не торопят: они уже ответили.
  const people = ((data || []) as Row[])
    .filter((r) => !r.done_at && !r.declined_at)
    .map((r) => (Array.isArray(r.assignees) ? r.assignees[0] : r.assignees))
    .filter((p): p is ColleagueRow => !!p && notMe(actor)(p));
  const text = `🔔 Напоминание по задаче ${taskRef(task)}${task.deadline ? ` (срок ${fmtDate(task.deadline)})` : ""}. Что с ней?`;
  const sent = await Promise.all(people.map((p) => sendToPerson(admin, actor.spaceId, p, text)));
  return sent.filter(Boolean).length;
}

export async function planNudge(ctx: SkillContext, input: Record<string, unknown>): Promise<SkillReply> {
  if (String(input.scope || "") === "overdue") {
    const t = today();
    const overdue = (await ownerTasks(ctx.admin, ctx.actor)).filter((x) => overdueOn(x.row, t) && x.approvalState !== "awaiting_review");
    if (!overdue.length) return { text: "Просроченного у ваших задач нет 👍" };
    const lines = overdue.slice(0, 10).map((x) => `• ${numbered(x)}${x.assignee ? " — " + withoutSelfMark(x.assignee) : ""}`);
    return confirm(ctx, { type: "nudge", taskIds: overdue.map((x) => x.id) }, `🔔 Напомнить исполнителям по просроченным задачам (${overdue.length})?\n${lines.join("\n")}`);
  }
  const got = await oneTask(ctx, String(input.query || ""), "напомнить");
  if ("reply" in got) return got.reply;
  const sent = await pingTask(ctx.admin, ctx.actor, got.task.id);
  return { text: sent ? `🔔 Напомнил по ${taskRef(got.task)}: ${sent} ${plural(sent, "человек", "человека", "человек")}.` : `По ${taskRef(got.task)} напоминать некому: все ответили или без мессенджера.` };
}

// ============================================================ подтверждение

export async function runConfirmed(admin: SupabaseClient, actor: BotActor, op: ConfirmOp): Promise<string> {
  if (op.type === "approve" || op.type === "return") {
    const task = await loadTask(admin, actor, op.taskId);
    if (!task) return "Эта задача не найдена — принимать работу может тот, кто её поставил.";
    const done = await applyReview(admin, task, op.type === "approve" ? "approve" : "return", op.type === "return" ? op.comment : "", {
      label: await actorName(admin, actor.spaceId, actor.userId),
      userId: actor.userId,
    });
    if (!done.ok) return done.error;
    return op.type === "approve" ? `✅ Принято: ${taskRef(task)}. Задача закрыта, исполнителям сказано.` : `↩ Вернул ${taskRef(task)} на доработку — исполнителям сказано.`;
  }
  if (op.type === "task_people") return runTaskPeople(admin, actor, op);
  if (op.type === "meeting_people") return runMeetingPeople(admin, actor, op);
  let total = 0;
  for (const id of op.taskIds.slice(0, 30)) total += await pingTask(admin, actor, id);
  return total ? `🔔 Напомнил: ${total} ${plural(total, "сообщение", "сообщения", "сообщений")}.` : "Напоминать некому: все ответили или без мессенджера.";
}
