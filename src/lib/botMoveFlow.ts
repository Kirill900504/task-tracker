import type { SupabaseClient } from "@supabase/supabase-js";
import type { BotButton } from "@/lib/botTransport";
import type { CallbackAction } from "@/lib/colleagues";
import { encodeCallback } from "@/lib/colleagues";
import { actorScope, authorFilter, type BotActor } from "@/lib/botActor";
import { dayLabel, fmtWhen, moveChoices, parseWhen } from "@/lib/botWhen";
import { bestMatches, coverage } from "@/lib/itemMatch";
import { MEETING_MOVE_COLUMNS, inPast, moveMeeting, moveTaskDeadline, type MeetingToMove } from "@/lib/itemMove";
import { busyStartsOnServer } from "@/lib/meetingBusyServer";
import { dateStr, moscowNow } from "@/lib/taskLogic";
import { navRow } from "@/lib/botMenu";
import { numbered, taskRef } from "@/lib/taskRef";
import { recordEvent } from "@/lib/itemHistory";
import { actorName } from "@/lib/actorName";
import { mirrorClosed } from "@/lib/botMirror";
import { sendToPerson } from "@/lib/reach";
import type { ColleagueRow } from "@/lib/colleagues";
import { isSelfAssignee } from "@/lib/trackerRows";

// Перенос из мессенджера — словами и кнопками, одним механизмом.
//
// 20.10.2026, слова Кирилла: «Меню сейчас хочу глобально улучшить! Чтобы на
// каждое событие было больше вариантов к управлению, например более простые
// переносы встреч и задач». А днём раньше семь сообщений подряд не смогли
// перенести одну встречу. Отсюда устройство:
//
// * Кнопка «📅 Перенести» есть везде, где встреча или задача видна
//   постановщику: карточка, напоминание за 15 минут, вопрос «Что решили?».
// * Нажатие — экран дней (завтра, послезавтра, понедельник, +неделя,
//   «✍️ Другой день»); у встречи следом экран времени («в то же время» и
//   свободные часы). Второе нажатие и есть подтверждение: оно называет
//   время целиком, и случайным быть не может.
// * Сказанное словами («перенеси телемост на 26.10 в то же время») приходит
//   сюда же: модель называет, ЧТО и КОГДА словами, код находит дело по
//   названию (lib/itemMatch, опечатки прощаются) и считает дату
//   (lib/botWhen), а ответ — тот же экран подтверждения с кнопками.
//
// Кнопки не держат состояния: в данных кнопки едут и id, и день, и время
// (`id.ГГГГММДДЧЧММ`, до 64 байт). Память бота нужна только тексту — для
// «да» и для своей даты словами.
//
// Право одно, как в трекере: переносит тот, кто назначил (встреча) или
// поставил (задача). Выборка идёт по актору с фильтром автора, и чужое
// просто не находится — отдельной проверки «а ваше ли» нет нарочно.

export type MoveOutcome = {
  toast: string;
  say?: string;
  sayButtons?: BotButton[][];
  rewriteTo?: string;
  rewriteButtons?: BotButton[][];
  setPending?: Record<string, unknown>;
  // Забыть незакрытый вопрос: «Не надо» под предложенным переносом, иначе
  // «да», написанное позже о другом, выполнило бы отменённое.
  clearPending?: boolean;
};

// Незакрытый вопрос: пользователь пишет дату словами, или согласие «да» на
// перенос, предложенный по его фразе.
export type MovePending = {
  kind: "move_item";
  itemType: "meeting" | "task";
  id: string;
  title: string;
  // Пусто — дня ещё нет, следующее сообщение и есть день (кнопка «✍️ Другой день»).
  date: string;
  time: string;
  // Фраза и разбор — для урока, если перенос подтвердят (lib/botMemory).
  phrase?: string;
  parsed?: unknown;
  at: string;
};

export type CancelPending = { kind: "meeting_cancel"; id: string; title: string; at: string };

// AgendaPending — кнопка «📝 Повестка» (21.10.2026): следующее сообщение —
// пункты повестки встречи. Живёт здесь, рядом с отменой, потому что
// устроена так же: нажатие у встречи организатора → вопрос → ответ словами.
export type AgendaPending = { kind: "meeting_agenda"; id: string; title: string; at: string };

export const MOVE_ACTIONS = new Set(["mv", "mvd", "mvgo", "mvask", "mvx", "mvxok", "magd"]);

export function isMoveAction(action: CallbackAction): boolean {
  return (action.kind === "meeting" || action.kind === "task") && MOVE_ACTIONS.has(action.action);
}

function todayIso(): string {
  return dateStr(moscowNow());
}

function compact(date: string, time = ""): string {
  return date.replace(/-/g, "") + time.replace(":", "");
}

// `id.ГГГГММДД[ЧЧММ]` → части. Точка — последняя: в id её не бывает
// (lib/uid), но чужой формат id не должен ломать разбор.
export function splitTarget(raw: string): { id: string; date: string; time: string } {
  const dot = raw.lastIndexOf(".");
  if (dot < 0) return { id: raw, date: "", time: "" };
  const tail = raw.slice(dot + 1);
  const date = /^\d{8}/.test(tail) ? `${tail.slice(0, 4)}-${tail.slice(4, 6)}-${tail.slice(6, 8)}` : "";
  const time = /^\d{12}$/.test(tail) ? `${tail.slice(8, 10)}:${tail.slice(10, 12)}` : "";
  return { id: raw.slice(0, dot), date, time };
}

export function moveData(kind: "meeting" | "task", action: string, id: string, date = "", time = ""): string {
  return encodeCallback(kind, action, date ? `${id}.${compact(date, time)}` : id);
}

// ------------------------------------------------------------------ выборки

export type TaskToMove = { id: string; title: string; number?: number | null; deadline: string | null; user_id: string; status: string | null };

async function loadMeeting(admin: SupabaseClient, actor: BotActor, id: string): Promise<MeetingToMove | null> {
  const { data } = await admin
    .from("meetings")
    .select(MEETING_MOVE_COLUMNS)
    .eq("id", id)
    .match(actorScope(actor))
    .or(authorFilter(actor))
    .is("deleted_at", null)
    .maybeSingle();
  return (data as MeetingToMove | null) || null;
}

async function loadTask(admin: SupabaseClient, actor: BotActor, id: string): Promise<TaskToMove | null> {
  const { data } = await admin
    .from("tasks")
    .select("id, title, number, deadline, user_id, status")
    .eq("id", id)
    .match(actorScope(actor))
    .or(authorFilter(actor))
    .is("deleted_at", null)
    .maybeSingle();
  return (data as TaskToMove | null) || null;
}

// Встречи, которые этот человек может перенести: назначенные им, ещё без
// исхода. Прошедшие без итога — тоже (за две недели): несостоявшуюся
// встречу переносят как раз после её времени, и 19.10.2026 так и было.
async function movableMeetings(admin: SupabaseClient, actor: BotActor): Promise<MeetingToMove[]> {
  const since = new Date(Date.now() - 14 * 86400_000).toISOString().slice(0, 10);
  const { data } = await admin
    .from("meetings")
    .select(MEETING_MOVE_COLUMNS)
    .match(actorScope(actor))
    .or(authorFilter(actor))
    .is("deleted_at", null)
    .in("status", ["planned", "proposed"])
    .gte("date", since)
    .order("date")
    .order("time")
    .limit(60);
  return (data || []) as MeetingToMove[];
}

async function movableTasks(admin: SupabaseClient, actor: BotActor): Promise<TaskToMove[]> {
  const { data } = await admin
    .from("tasks")
    .select("id, title, number, deadline, user_id, status")
    .match(actorScope(actor))
    .or(authorFilter(actor))
    .is("deleted_at", null)
    .neq("status", "done")
    .limit(200);
  return (data || []) as TaskToMove[];
}

// ------------------------------------------------------------------ экраны

function meetingWhen(m: { date: string; time: string | null }): string {
  return fmtWhen(m.date, m.time || "");
}

// Экран дней. Общий для встречи и задачи: у встречи день ведёт на экран
// времени, у задачи — сразу на перенос срока.
export function dayScreen(kind: "meeting" | "task", item: { id: string; title: string; date: string; time?: string; number?: number | null }): { text: string; buttons: BotButton[][] } {
  const today = todayIso();
  const choices = moveChoices(today, item.date);
  const action = kind === "meeting" ? "mvd" : "mvgo";
  const rows: BotButton[][] = [];
  for (let i = 0; i < choices.length; i += 2) {
    rows.push(choices.slice(i, i + 2).map((c) => ({ text: c.label, data: moveData(kind, action, item.id, c.date) })));
  }
  rows.push([{ text: "✍️ Другой день", data: moveData(kind, "mvask", item.id) }]);
  rows.push([{ text: "← Назад", data: encodeCallback(kind, "oshow", item.id) }]);
  const head =
    kind === "meeting"
      ? `📅 Перенести встречу «${item.title}»\nСейчас: ${fmtWhen(item.date, item.time || "")}\n\nНа какой день?`
      : `📅 Срок задачи ${taskRef({ title: item.title, number: item.number ?? null })}\nСейчас: ${item.date ? fmtWhen(item.date) : "не назначен"}\n\nНа какой день перенести?`;
  return { text: head, buttons: rows };
}

const SLOTS = ["09:00", "10:00", "11:00", "12:00", "14:00", "15:00", "16:00", "17:00", "18:00"];

// Экран времени встречи. «В то же время» — первым: так переносят чаще всего
// («на 26.10 на это же время»). Занятые у приглашённых часы не
// предлагаются вовсе — нажать их всё равно было бы нельзя (lib/meetingTime).
async function timeScreen(admin: SupabaseClient, m: MeetingToMove, date: string): Promise<{ text: string; buttons: BotButton[][] }> {
  const people = (m.participants || []).filter(Boolean);
  const keep = m.time || "";
  const candidates = [...new Set([keep, ...SLOTS].filter(Boolean))].filter((t) => !inPast(date, t));
  let busy = new Set<string>();
  try {
    busy = await busyStartsOnServer(admin, { spaceId: m.user_id, date, durationMin: m.duration_min ?? 30, people, slots: candidates });
  } catch {
    // Не прочли занятость — не отказываем: перенос всё равно проверит её
    // перед записью (moveMeeting) и скажет словами.
  }
  const free = candidates.filter((t) => !busy.has(t));
  const rows: BotButton[][] = [];
  if (keep && free.includes(keep)) rows.push([{ text: `✅ В то же время · ${keep}`, data: moveData("meeting", "mvgo", m.id, date, keep) }]);
  const others = free.filter((t) => t !== keep).slice(0, 6);
  for (let i = 0; i < others.length; i += 3) {
    rows.push(others.slice(i, i + 3).map((t) => ({ text: t, data: moveData("meeting", "mvgo", m.id, date, t) })));
  }
  rows.push([{ text: "✍️ Другое время", data: moveData("meeting", "mvask", m.id, date) }]);
  rows.push([{ text: "← Другой день", data: moveData("meeting", "mv", m.id) }]);
  const busyNote = keep && busy.has(keep) ? `\n⚠ В ${keep} у кого-то из участников уже другая встреча.` : "";
  return { text: `📅 «${m.title}» → ${dayLabel(date)}\nВо сколько?${busyNote}`, buttons: rows };
}

// Экран подтверждения переноса, предложенного по фразе. Кнопка «Перенести»
// несёт время целиком, «да» словом работает тоже (память бота).
function confirmScreen(kind: "meeting" | "task", item: { id: string; title: string; number?: number | null; date: string; time?: string }, date: string, time: string): { text: string; buttons: BotButton[][] } {
  const was = kind === "meeting" ? fmtWhen(item.date, item.time || "") : item.date ? fmtWhen(item.date) : "без срока";
  const will = kind === "meeting" ? fmtWhen(date, time) : fmtWhen(date);
  const name = kind === "meeting" ? `встречу «${item.title}»` : `срок задачи ${taskRef({ title: item.title, number: item.number ?? null })}`;
  return {
    text: `📅 Перенести ${name}?\nБыло: ${was}\nСтанет: ${will}${kind === "meeting" ? "\n\nУчастникам сообщу сразу." : ""}\n\nНажмите «Перенести» или ответьте «да».`,
    buttons: [
      [{ text: "✅ Перенести", data: moveData(kind, "mvgo", item.id, date, kind === "meeting" ? time : "") }],
      [
        { text: "📅 Другой день", data: moveData(kind, "mv", item.id) },
        { text: "✖ Не надо", data: moveData(kind, "mvx", item.id) },
      ],
    ],
  };
}

// --------------------------------------------------------- фраза → перенос

export type MoveRequest = {
  itemType: string;
  query: string;
  when: string;
  // Сообщение бота, на которое ответили: его текст и, если под ним были
  // кнопки, то самое дело (id из данных кнопки) — точнее любого названия.
  replyText?: string;
  replyItem?: { kind: "meeting" | "task"; id: string } | null;
  phrase?: string;
  parsed?: unknown;
};

export type Found = { kind: "meeting"; m: MeetingToMove } | { kind: "task"; t: TaskToMove };

// Какое дело человек имеет в виду — общий поиск для переноса и отмены.
// Порядок — от надёжного к догадке: id из кнопок сообщения, на которое
// ответили; названное словами; название внутри того сообщения.
export async function findItems(
  admin: SupabaseClient,
  actor: BotActor,
  req: { itemType: string; query: string; replyText?: string; replyItem?: { kind: "meeting" | "task"; id: string } | null },
): Promise<{ meetings: MeetingToMove[]; tasks: TaskToMove[]; found: Found[] }> {
  const wantMeeting = req.itemType !== "task";
  const wantTask = req.itemType !== "meeting";
  const [meetings, tasks] = await Promise.all([wantMeeting ? movableMeetings(admin, actor) : Promise.resolve([]), wantTask ? movableTasks(admin, actor) : Promise.resolve([])]);

  let found: Found[] = [];
  if (req.replyItem) {
    if (req.replyItem.kind === "meeting" && wantMeeting) {
      const m = meetings.find((x) => x.id === req.replyItem!.id) || (await loadMeeting(admin, actor, req.replyItem.id));
      if (m) found = [{ kind: "meeting", m }];
    } else if (req.replyItem.kind === "task" && wantTask) {
      const t = tasks.find((x) => x.id === req.replyItem!.id) || (await loadTask(admin, actor, req.replyItem.id));
      if (t) found = [{ kind: "task", t }];
    }
  }
  if (!found.length && req.query.trim()) {
    const all = [...meetings.map((m) => ({ title: m.title, f: { kind: "meeting", m } as Found })), ...tasks.map((t) => ({ title: t.title, f: { kind: "task", t } as Found }))];
    found = bestMatches(all, req.query).map((x) => x.f);
  }
  if (!found.length && req.replyText?.trim()) {
    const scored = [...meetings.map((m) => ({ s: coverage(m.title, req.replyText!), f: { kind: "meeting", m } as Found })), ...tasks.map((t) => ({ s: coverage(t.title, req.replyText!), f: { kind: "task", t } as Found }))]
      .filter((x) => x.s >= 0.6)
      .sort((a, b) => b.s - a.s);
    if (scored.length) found = scored.filter((x) => x.s >= scored[0].s - 0.001).map((x) => x.f);
  }
  return { meetings, tasks, found };
}

export async function planMoveFromText(admin: SupabaseClient, actor: BotActor, req: MoveRequest): Promise<{ text: string; buttons?: BotButton[][]; pending?: MovePending }> {
  const { meetings, tasks, found } = await findItems(admin, actor, req);

  if (!found.length) {
    // Не нашли — не тупик: показываем, что ЕСТЬ, кнопками. Одно нажатие
    // вместо ещё одной попытки угадать название.
    const list = meetings.slice(0, 6);
    if (!list.length && !tasks.length) return { text: "Не нашёл, что переносить: назначенных вами встреч и открытых задач нет." };
    const what = req.query.trim() ? `«${req.query.trim()}»` : "о какой встрече речь";
    return {
      text: `Не понял ${req.query.trim() ? "встречу или задачу " + what : what}. Выберите, что перенести:`,
      buttons: [
        ...list.map((m) => [{ text: `📅 ${dayLabel(m.date)} ${short(m.title, 26)}`, data: moveData("meeting", "mv", m.id) }]),
        ...navRow("assigner"),
      ],
    };
  }

  if (found.length > 1) {
    return {
      text: "Нашёл несколько — что перенести?",
      buttons: [
        ...found.slice(0, 6).map((f) =>
          f.kind === "meeting"
            ? [{ text: `📅 ${dayLabel(f.m.date)} ${short(f.m.title, 26)}`, data: moveData("meeting", "mv", f.m.id) }]
            : [{ text: `📋 ${short(numbered(f.t), 30)}`, data: moveData("task", "mv", f.t.id) }],
        ),
      ],
    };
  }

  const one = found[0];
  const today = todayIso();
  if (one.kind === "meeting") {
    const m = one.m;
    const when = parseWhen(req.when || req.phrase || "", today, m.date);
    if (!when.date && !when.time) {
      const screen = dayScreen("meeting", { id: m.id, title: m.title, date: m.date, time: m.time || "" });
      return { text: screen.text, buttons: screen.buttons };
    }
    const date = when.date || m.date;
    const time = when.time || m.time || "";
    if (inPast(date, time)) {
      const screen = dayScreen("meeting", { id: m.id, title: m.title, date: m.date, time: m.time || "" });
      return { text: `${fmtWhen(date, time)} уже прошло.\n\n${screen.text}`, buttons: screen.buttons };
    }
    const screen = confirmScreen("meeting", { id: m.id, title: m.title, date: m.date, time: m.time || "" }, date, time);
    return {
      text: screen.text,
      buttons: screen.buttons,
      pending: { kind: "move_item", itemType: "meeting", id: m.id, title: m.title, date, time, phrase: req.phrase, parsed: req.parsed, at: new Date().toISOString() },
    };
  }
  const t = one.t;
  const when = parseWhen(req.when || req.phrase || "", today, t.deadline || "");
  if (!when.date) {
    const screen = dayScreen("task", { id: t.id, title: t.title, number: t.number, date: t.deadline || "" });
    return { text: screen.text, buttons: screen.buttons };
  }
  const screen = confirmScreen("task", { id: t.id, title: t.title, number: t.number, date: t.deadline || "" }, when.date, "");
  return {
    text: screen.text,
    buttons: screen.buttons,
    pending: { kind: "move_item", itemType: "task", id: t.id, title: t.title, date: when.date, time: "", phrase: req.phrase, parsed: req.parsed, at: new Date().toISOString() },
  };
}

function short(title: string, limit: number): string {
  return title.length > limit ? title.slice(0, limit - 1) + "…" : title;
}

// Выполнить перенос — общий конец и для кнопки, и для «да».
export async function applyMove(admin: SupabaseClient, actor: BotActor, kind: "meeting" | "task", id: string, date: string, time: string): Promise<{ ok: boolean; text: string; buttons: BotButton[][] }> {
  if (kind === "meeting") {
    const m = await loadMeeting(admin, actor, id);
    if (!m) return { ok: false, text: "Эта встреча не найдена — возможно, её уже перенесли или назначили не вы.", buttons: navRow("assigner") };
    const done = await moveMeeting(admin, m, { date, time }, actor.userId);
    if (!done.ok) return { ok: false, text: "Не перенёс: " + done.error, buttons: [[{ text: "📅 Выбрать другое время", data: moveData("meeting", "mv", id) }], ...navRow("assigner")] };
    return { ok: true, text: done.text, buttons: [[{ text: "📅 Открыть встречу", data: encodeCallback("meeting", "oshow", done.newId) }], ...navRow("assigner")] };
  }
  const t = await loadTask(admin, actor, id);
  if (!t) return { ok: false, text: "Эта задача не найдена — двигать срок может только тот, кто её поставил.", buttons: navRow("assigner") };
  const done = await moveTaskDeadline(admin, t, date, actor.userId);
  if (!done.ok) return { ok: false, text: "Не перенёс: " + done.error, buttons: [[{ text: "📅 Выбрать другой день", data: moveData("task", "mv", id) }], ...navRow("assigner")] };
  return { ok: true, text: done.text, buttons: [[{ text: "📋 Открыть задачу", data: encodeCallback("task", "oshow", id) }], ...navRow("assigner")] };
}

// ------------------------------------------------------------------ кнопки

export async function handleMoveCallback(admin: SupabaseClient, actor: BotActor, action: CallbackAction): Promise<MoveOutcome> {
  const kind = action.kind === "task" ? "task" : "meeting";
  const target = splitTarget(action.id);

  if (action.action === "mvx") {
    return { toast: "Ничего не меняю", rewriteTo: "Хорошо, ничего не меняю.", rewriteButtons: navRow("assigner"), clearPending: true };
  }

  if (action.action === "mv") {
    if (kind === "meeting") {
      const m = await loadMeeting(admin, actor, target.id);
      if (!m) return { toast: "Переносит тот, кто назначил встречу" };
      if (m.status === "success" || m.status === "no_result") return { toast: "Встреча уже закрыта" };
      const screen = dayScreen("meeting", { id: m.id, title: m.title, date: m.date, time: m.time || "" });
      return { toast: "На какой день?", say: screen.text, sayButtons: screen.buttons };
    }
    const t = await loadTask(admin, actor, target.id);
    if (!t) return { toast: "Срок двигает тот, кто поставил задачу" };
    const screen = dayScreen("task", { id: t.id, title: t.title, number: t.number, date: t.deadline || "" });
    return { toast: "На какой день?", say: screen.text, sayButtons: screen.buttons };
  }

  if (action.action === "mvd" && kind === "meeting") {
    const m = await loadMeeting(admin, actor, target.id);
    if (!m) return { toast: "Переносит тот, кто назначил встречу" };
    if (!target.date) return { toast: "Не понял день" };
    const screen = await timeScreen(admin, m, target.date);
    return { toast: dayLabel(target.date), say: screen.text, sayButtons: screen.buttons };
  }

  if (action.action === "mvask") {
    const title = kind === "meeting" ? (await loadMeeting(admin, actor, target.id))?.title : (await loadTask(admin, actor, target.id))?.title;
    if (!title) return { toast: kind === "meeting" ? "Переносит тот, кто назначил встречу" : "Срок двигает тот, кто поставил задачу" };
    const pending: MovePending = { kind: "move_item", itemType: kind, id: target.id, title, date: target.date, time: "", at: new Date().toISOString() };
    const ask = target.date
      ? `Во сколько ${dayLabel(target.date)}? Напишите время, например «15:30».`
      : kind === "meeting"
        ? "На когда перенести? Напишите день и, если нужно, время: «26.10», «в четверг в 15:00», «на неделю»."
        : "На какой день перенести срок? Напишите: «26.10», «в пятницу», «на неделю».";
    return { toast: "Напишите", say: `📅 «${title}»\n\n${ask}`, setPending: pending };
  }

  if (action.action === "mvgo") {
    if (!target.date) return { toast: "Не понял день" };
    const done = await applyMove(admin, actor, kind, target.id, target.date, target.time);
    return { toast: done.ok ? "Перенесено" : "Не получилось", rewriteTo: done.text, rewriteButtons: done.buttons };
  }

  // Отмена встречи — с причиной, как в трекере: без неё отмена ничего не
  // объясняет тем, кто уже освободил это время.
  if (action.action === "mvxok" && kind === "meeting") {
    const m = await loadMeeting(admin, actor, target.id);
    if (!m) return { toast: "Отменяет тот, кто назначил встречу" };
    if (m.status === "success" || m.status === "no_result") return { toast: "Встреча уже закрыта" };
    const pending: CancelPending = { kind: "meeting_cancel", id: m.id, title: m.title, at: new Date().toISOString() };
    return {
      toast: "Почему отменяем?",
      say: `🚫 Отменить встречу «${m.title}» (${meetingWhen(m)})?\n\nНапишите одним сообщением причину — её получат участники. Передумали — нажмите «Не отменять».`,
      sayButtons: [[{ text: "↩ Не отменять", data: encodeCallback("meeting", "oshow", m.id) }]],
      setPending: pending,
    };
  }

  // Повестка: следующее сообщение — пункты (разбор в botPipeline).
  if (action.action === "magd" && kind === "meeting") {
    const m = await loadMeeting(admin, actor, target.id);
    if (!m) return { toast: "Повестку из бота ведёт тот, кто назначил встречу" };
    if (m.status === "success" || m.status === "no_result") return { toast: "Встреча уже закрыта" };
    const pending: AgendaPending = { kind: "meeting_agenda", id: m.id, title: m.title, at: new Date().toISOString() };
    return {
      toast: "Что обсудим?",
      say: `📝 Повестка встречи «${m.title}» (${meetingWhen(m)}).\n\nНапишите пункты одним сообщением — каждый с новой строки. Они добавятся в конец повестки.`,
      sayButtons: [[{ text: "↩ Не добавлять", data: encodeCallback("meeting", "mvx", m.id) }]],
      setPending: pending,
    };
  }

  return { toast: "Не понял, что нажато" };
}

// Причина отмены пришла словами — отменить, записать и сказать людям.
// То же, что делает трекер (/api/workspace/meeting-cancel плюс удаление
// строки движком синхронизации), одним шагом с сервера.
export async function cancelMeetingFromBot(admin: SupabaseClient, actor: BotActor, pending: CancelPending, reason: string): Promise<string> {
  const m = await loadMeeting(admin, actor, pending.id);
  if (!m) return "Эта встреча больше не найдена.";
  const why = reason.trim().slice(0, 1000);
  if (!why) return "Без причины не отменяю — нажмите «Отменить встречу» ещё раз и напишите почему.";
  const { error } = await admin.from("meetings").update({ deleted_at: new Date().toISOString() }).eq("id", m.id);
  if (error) return "Не получилось отменить: " + error.message;
  const who = await actorName(admin, m.user_id, actor.userId);
  const when = meetingWhen(m);
  await recordEvent(admin, { actorUserId: actor.userId, userId: m.user_id, kind: "meeting", itemId: m.id, text: `🚫 ${who} отменил встречу: ${why}` });
  await mirrorClosed(admin, "meeting", m.id, `📅 ${m.title}\n${when}\n\n🚫 Встреча отменена.\n${who}: ${why}`);
  let sent = 0;
  if (m.date >= todayIso()) {
    const { data: parts } = await admin.from("meeting_participants").select("assignee_id").eq("meeting_id", m.id);
    const ids = ((parts || []) as { assignee_id: string }[]).map((p) => p.assignee_id).filter((id) => id !== actor.assigneeId);
    if (ids.length) {
      const { data: people } = await admin.from("assignees").select("id, name, telegram_chat_id, max_user_id, messenger").in("id", ids);
      const delivered = await Promise.all(
        ((people || []) as ColleagueRow[])
          .filter((p) => !(actor.isOwner && isSelfAssignee(p.name || "")))
          .map((person) => sendToPerson(admin, m.user_id, person, `🚫 Встреча «${m.title}» (${when}) отменена.\n\n${who}: ${why}`)),
      );
      sent = delivered.filter(Boolean).length;
    }
  }
  return `🚫 Встреча «${m.title}» отменена.${sent ? ` Участникам сообщил: ${sent}.` : ""}`;
}

// Дата словами после «✍️ Другой день» / «✍️ Другое время» — без модели:
// это одна короткая фраза о дне, и код читает её надёжнее.
export async function moveFromTypedWhen(admin: SupabaseClient, actor: BotActor, pending: MovePending, text: string): Promise<{ text: string; buttons?: BotButton[][]; pending?: MovePending }> {
  const today = todayIso();
  if (pending.itemType === "meeting") {
    const m = await loadMeeting(admin, actor, pending.id);
    if (!m) return { text: "Эта встреча больше не найдена." };
    const when = parseWhen(text, today, m.date);
    const date = when.date || pending.date || (when.time ? m.date : "");
    const time = when.time || m.time || "";
    if (!date) {
      return { text: "Не разобрал день. Напишите, например: «26.10», «в четверг», «на неделю» — или выберите кнопкой.", buttons: dayScreen("meeting", { id: m.id, title: m.title, date: m.date, time: m.time || "" }).buttons, pending };
    }
    if (inPast(date, time)) return { text: `${fmtWhen(date, time)} уже прошло — назовите время впереди.`, pending };
    const screen = confirmScreen("meeting", { id: m.id, title: m.title, date: m.date, time: m.time || "" }, date, time);
    return { text: screen.text, buttons: screen.buttons, pending: { ...pending, date, time } };
  }
  const t = await loadTask(admin, actor, pending.id);
  if (!t) return { text: "Эта задача больше не найдена." };
  const when = parseWhen(text, today, t.deadline || "");
  if (!when.date) return { text: "Не разобрал день. Напишите, например: «26.10», «в пятницу», «на неделю».", pending };
  const screen = confirmScreen("task", { id: t.id, title: t.title, number: t.number, date: t.deadline || "" }, when.date, "");
  return { text: screen.text, buttons: screen.buttons, pending: { ...pending, date: when.date, time: "" } };
}

// ------------------------------------------------- предложить другое время
//
// У участника встречи (не организатора) права переносить нет — назначил не
// он. Но сказать «мне неудобно, давайте в четверг» он вправе, и в трекере
// для этого давно есть предложение времени: реплика в обсуждении с датой и
// временем, на которую остальные отвечают 👍 / 👎, а организатор переносит
// одним нажатием (lib/meetingProposal). В мессенджере предложить было
// нечем — только «Не смогу» с причиной. Теперь под приглашением есть
// «🕐 Другое время»: день → время → предложение. Доставку делает та же
// commentDelivery, что и у трекера, поэтому и кнопки «Подходит / Не
// подходит» и «Перенести на это время» у людей те же самые.

export const PROPOSE_ACTIONS = new Set(["pp", "ppd", "ppgo"]);

export function isProposeAction(action: CallbackAction): boolean {
  return action.kind === "meeting" && PROPOSE_ACTIONS.has(action.action);
}

export async function handleProposeCallback(
  admin: SupabaseClient,
  person: { id: string; name: string; user_id: string },
  action: CallbackAction,
  source: "telegram" | "max",
): Promise<MoveOutcome> {
  const target = splitTarget(action.id);
  const { data } = await admin.from("meetings").select(MEETING_MOVE_COLUMNS).eq("id", target.id).eq("user_id", person.user_id).is("deleted_at", null).maybeSingle();
  const m = data as MeetingToMove | null;
  // Предлагает только приглашённый: встречу, на которую не звали, человек
  // и не видит (правило «каждый видит только своё»).
  const { data: part } = m
    ? await admin.from("meeting_participants").select("assignee_id").eq("meeting_id", m.id).eq("assignee_id", person.id).maybeSingle()
    : { data: null };
  if (!m || !part) return { toast: "Эта встреча не найдена" };
  if (m.status === "success" || m.status === "no_result") return { toast: "Встреча уже закрыта" };

  if (action.action === "pp") {
    const today = todayIso();
    const choices = moveChoices(today, m.date);
    const rows: BotButton[][] = [];
    for (let i = 0; i < choices.length; i += 2) {
      rows.push(choices.slice(i, i + 2).map((c) => ({ text: c.label, data: moveData("meeting", "ppd", m.id, c.date) })));
    }
    return {
      toast: "Какой день удобнее?",
      say: `🕐 «${m.title}» (${meetingWhen(m)})\n\nКакой день вам удобнее? Предложу его организатору и остальным — они ответят «подходит / не подходит».\n\nДругой день или причину можно написать в обсуждение: «💬 Ответить».`,
      sayButtons: rows,
    };
  }

  if (action.action === "ppd") {
    if (!target.date) return { toast: "Не понял день" };
    const keep = m.time || "";
    const slots = [...new Set([keep, ...SLOTS].filter(Boolean))].filter((t) => !inPast(target.date, t)).slice(0, 9);
    const rows: BotButton[][] = [];
    for (let i = 0; i < slots.length; i += 3) {
      rows.push(slots.slice(i, i + 3).map((t) => ({ text: t === keep ? `${t} (то же)` : t, data: moveData("meeting", "ppgo", m.id, target.date, t) })));
    }
    rows.push([{ text: "← Другой день", data: encodeCallback("meeting", "pp", m.id) }]);
    return { toast: dayLabel(target.date), say: `🕐 «${m.title}» → ${dayLabel(target.date)}\nВо сколько удобно?`, sayButtons: rows };
  }

  if (action.action === "ppgo") {
    if (!target.date || !target.time) return { toast: "Не понял время" };
    if (inPast(target.date, target.time)) return { toast: "Это время уже прошло" };
    const { data: member } = await admin.from("workspace_members").select("member_id").eq("assignee_id", person.id).eq("status", "active").maybeSingle();
    const authUser = (member as { member_id: string | null } | null)?.member_id || (isSelfAssignee(person.name) ? person.user_id : null);
    const when = fmtWhen(target.date, target.time);
    const { data: inserted, error } = await admin
      .from("item_comments")
      .insert({
        item_kind: "meeting",
        item_id: m.id,
        body: `🕐 Предлагаю перенести встречу на ${when}.\nПодходит? Ответьте 👍 или 👎 в обсуждении встречи.`,
        attachments: [],
        author_user_id: authUser,
        author_assignee_id: person.id,
        source,
        proposal: { date: target.date, time: target.time },
      })
      .select("id")
      .maybeSingle();
    if (error || !inserted) return { toast: "Не получилось", rewriteTo: "Не получилось отправить предложение — попробуйте ещё раз." };
    const { deliverComment } = await import("@/lib/commentDelivery");
    await deliverComment(admin, (inserted as { id: string }).id);
    return {
      toast: "Предложил",
      rewriteTo: `🕐 Предложил перенести «${m.title}» на ${when}.\nОрганизатор и участники получили — решает организатор.`,
    };
  }

  return { toast: "Не понял, что нажато" };
}

// ------------------------------------------------ отмена встречи словами
//
// 20.10.2026, просьба Кирилла: «сделай отмену встречи словами» — «отмени
// встречу с банком, клиент заболел». Правила те же, что у кнопки «🚫
// Отменить»: отменяет тот, кто назначил; без причины не отменяется (её
// получат люди, освободившие это время); перед отменой — подтверждение,
// потому что отмена рассылается всем и обратно её не вернуть одним словом.
// Причина названа во фразе — спрашиваем только «да»; не названа — сперва
// спрашиваем её (тот же вопрос, что после кнопки).

export type CancelConfirmPending = {
  kind: "meeting_cancel_confirm";
  id: string;
  title: string;
  reason: string;
  phrase?: string;
  parsed?: unknown;
  at: string;
};

export async function planCancelFromText(
  admin: SupabaseClient,
  actor: BotActor,
  req: { query: string; reason: string; replyText?: string; replyItem?: { kind: "meeting" | "task"; id: string } | null; phrase?: string; parsed?: unknown },
): Promise<{ text: string; buttons?: BotButton[][]; pending?: CancelPending | CancelConfirmPending }> {
  const { meetings, found } = await findItems(admin, actor, { itemType: "meeting", query: req.query, replyText: req.replyText, replyItem: req.replyItem });
  const hits = found.filter((f): f is { kind: "meeting"; m: MeetingToMove } => f.kind === "meeting");

  if (!hits.length) {
    if (!meetings.length) return { text: "Не нашёл, что отменять: назначенных вами открытых встреч нет." };
    return {
      text: `Не нашёл встречу${req.query.trim() ? ` «${req.query.trim()}»` : ""} среди назначенных вами. Какую отменить?`,
      buttons: [...meetings.slice(0, 6).map((m) => [{ text: `🚫 ${dayLabel(m.date)} ${short(m.title, 26)}`, data: encodeCallback("meeting", "mvxok", m.id) }]), ...navRow("assigner")],
    };
  }
  if (hits.length > 1) {
    return {
      text: "Нашёл несколько — какую отменить?",
      buttons: hits.slice(0, 6).map((h) => [{ text: `🚫 ${dayLabel(h.m.date)} ${short(h.m.title, 26)}`, data: encodeCallback("meeting", "mvxok", h.m.id) }]),
    };
  }

  const m = hits[0].m;
  const reason = req.reason.trim();
  if (!reason) {
    return {
      text: `🚫 Отменить встречу «${m.title}» (${meetingWhen(m)})?\n\nНапишите одним сообщением причину — её получат участники. Передумали — «нет».`,
      buttons: [[{ text: "↩ Не отменять", data: encodeCallback("meeting", "oshow", m.id) }]],
      pending: { kind: "meeting_cancel", id: m.id, title: m.title, at: new Date().toISOString() },
    };
  }
  return {
    text: `🚫 Отменить встречу «${m.title}» (${meetingWhen(m)})?\nПричина: ${reason}\n\nУчастникам сообщу сразу. Нажмите «Отменить встречу» или ответьте «да».`,
    buttons: [
      [{ text: "🚫 Отменить встречу", data: encodeCallback("meeting", "mvxgo", m.id) }],
      [{ text: "↩ Не отменять", data: moveData("meeting", "mvx", m.id) }],
    ],
    pending: { kind: "meeting_cancel_confirm", id: m.id, title: m.title, reason, phrase: req.phrase, parsed: req.parsed, at: new Date().toISOString() },
  };
}
