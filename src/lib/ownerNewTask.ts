import type { SupabaseClient } from "@supabase/supabase-js";
import type { BotButton } from "@/lib/botTransport";
import { encodeCallback } from "@/lib/colleagues";
import { fmtDate } from "@/lib/taskDisplay";
import { sortByPeopleOrder } from "@/lib/peopleOrder";
import { newTaskRow } from "@/lib/newTask";
import { attachExecutors, assignNote, authorAssigneeName } from "@/lib/assignExecutors";
import { withoutSelfMark } from "@/lib/actorName";
import { uid } from "@/lib/uid";
import { isoDate, workdayIn } from "@/lib/whenDate";
import { taskRef } from "@/lib/taskRef";

// Поручить прямо из мессенджера — кнопками, а не фразой.
//
// Продиктовать задачу бот умел и раньше: «поручи Игорю смету к пятнице»
// разбирает модель. Но модель ошибается в именах и датах, а ошибка здесь
// стоит дорого — задача уходит не тому и не на тот срок, и узнаётся это
// от человека, который её не ждал. Поэтому второй путь, где ошибиться
// нечем: три шага, на каждом кнопки.
//
// Порядок шагов — от сути к деталям: сначала ЧТО (это можно надиктовать
// голосом), потом КОМУ, потом КОГДА. Обратный порядок заставляет держать
// формулировку в голове, пока листаешь список людей.
//
// «По разделу» — то, ради чего заводилась привязка людей к разделам
// (миграция 0036): нажал «Сервис» — и там уже стоят те, кто за него
// отвечает, с их ролями.

export type NewTaskPending = {
  kind: "new_task";
  stage: "title" | "desc" | "who";
  title?: string;
  // Детали к поручению (14.10.2026: «мастер „Поручить“ в боте не
  // спрашивает описание — исправь»). Шаг идёт сразу за названием: детали
  // пишут, пока задача ещё в голове, а не после списка людей и сроков.
  description?: string;
};

// Вопрос о деталях — одной кнопкой «Без описания», потому что у половины
// поручений деталей нет, и писать «нет» словом — лишнее движение.
export const DESC_QUESTION =
  "Детали к задаче? Напишите одним сообщением или надиктуйте голосом — что важно знать исполнителю. Или нажмите «Без описания».";
export function descButtons(): BotButton[][] {
  return [[{ text: "Без описания", data: encodeCallback("task", "ndesc", "x") }]];
}

// После деталей — «кому», если человека ещё не выбрали («Поручить ему» из
// его карточки выбирает заранее), иначе сразу «на когда». Один шаг на оба
// входа: текст с деталями и кнопку «Без описания».
export async function nextNewTaskStep(
  admin: SupabaseClient,
  spaceId: string,
  pending: Record<string, unknown>,
): Promise<{ text: string; buttons: BotButton[][]; pending: Record<string, unknown> }> {
  const title = String(pending.title || "");
  const people = pending.people as { name: string; role: string }[] | undefined;
  if (people?.length) {
    return {
      text: `«${title}» — ${people.map((x) => withoutSelfMark(x.name)).join(", ")}. На когда?`,
      buttons: whenButtons(),
      pending: { ...pending, kind: "new_task", stage: "when" },
    };
  }
  return { text: `«${title}»\n\nКому поручить?`, buttons: await whoButtons(admin, spaceId), pending: { ...pending, kind: "new_task", stage: "who" } };
}

export function startNewTask(): { text: string; pending: NewTaskPending } {
  return {
    text: "➕ Что поручить? Напишите одной фразой или надиктуйте голосом — дальше выберем кому и на когда.",
    pending: { kind: "new_task", stage: "title" },
  };
}

export async function whoButtons(admin: SupabaseClient, userId: string): Promise<BotButton[][]> {
  const { data: people } = await admin.from("assignees").select("id, name").eq("user_id", userId).is("archived_at", null);
  const list = sortByPeopleOrder(((people || []) as { id: string; name: string }[]), (p) => p.name);

  const { data: sections } = await admin.from("sections").select("id, name").eq("user_id", userId).order("sort_order");
  const withPeople = new Set<string>();
  const { data: links } = await admin.from("section_assignees").select("section_id").eq("user_id", userId);
  for (const l of ((links || []) as { section_id: string }[])) withPeople.add(l.section_id);

  const rows: BotButton[][] = [];
  // По двое в ряд: имена длинные, а ряд из трёх в мессенджере обрезается.
  for (let i = 0; i < list.length; i += 2) {
    // Без пометки «(я)»: она написана для владельца, а кнопки эти видит и
    // руководитель, который поручает задачу ему.
    rows.push(list.slice(i, i + 2).map((p) => ({ text: withoutSelfMark(p.name), data: encodeCallback("task", "nwho", p.id) })));
  }
  const bySection = ((sections || []) as { id: string; name: string }[]).filter((s) => withPeople.has(s.id));
  for (let i = 0; i < bySection.length; i += 2) {
    rows.push(bySection.slice(i, i + 2).map((s) => ({ text: "🗂 " + s.name, data: encodeCallback("task", "nsec", s.id) })));
  }
  rows.push([{ text: "← Отмена", data: encodeCallback("task", "omenu", "x") }]);
  return rows;
}

// Сроки, которые ставят чаще всего. «Пятница» считается от сегодня и
// означает ближайшую: «к пятнице» в понедельник и в четверг — это разные
// даты, и человек имеет в виду ту, что ближе.
export function whenButtons(): BotButton[][] {
  return [
    [
      { text: "Сегодня", data: encodeCallback("task", "nwhen0", "x") },
      { text: "Завтра", data: encodeCallback("task", "nwhen1", "x") },
    ],
    [
      { text: "До пятницы", data: encodeCallback("task", "nwhenfri", "x") },
      { text: "Через неделю", data: encodeCallback("task", "nwhen7", "x") },
    ],
    // «Без срока» здесь больше нет: срок обязателен (14.10.2026).
  ];
}

export function resolveWhen(code: string, today: Date = new Date()): string {
  const d = new Date(today);
  d.setHours(0, 0, 0, 0);
  // «Без срока» из уже отправленных сообщений (кнопки до 14.10.2026) — срок
  // по умолчанию: задачи без срока больше не бывает (lib/newTask).
  if (code === "no") return isoDate(workdayIn(d, 7));
  if (code === "fri") {
    // Ближайшая пятница, и никогда не сегодняшняя: «к пятнице», сказанное
    // в пятницу, означает следующую — сегодня уже поздно договариваться.
    const ahead = (5 - d.getDay() + 7) % 7 || 7;
    d.setDate(d.getDate() + ahead);
    return isoDate(d);
  }
  // «Завтра» в пятницу — понедельник (см. workdayIn).
  return isoDate(workdayIn(d, Number(code) || 0));
}

// Завести задачу и сказать людям. Через assignExecutors — то же, чем это
// делает трекер и чем это делает разобранная фраза: одно назначение,
// одно сообщение человеку, одна строка участия.
export async function createTaskFromBot(
  admin: SupabaseClient,
  userId: string,
  title: string,
  people: { name: string; role: "executor" | "coexecutor" | "watcher" }[],
  deadline: string,
  // Кто поручил. Пусто — владелец пространства (так это и читает
  // notifyAuthor). У руководителя здесь его auth-id: по нему ему придёт
  // отчёт, и по нему же бот потом пустит его к приёмке этой задачи.
  createdBy: string | null = null,
  description = "",
): Promise<{ text: string }> {
  // Ни одного исполнителя (раздел, где закреплены только соисполнители и
  // наблюдатели) — исполнителем становится тот, кто поручает: задачи без
  // исполнителя не бывает (13.10.2026, «либо ты сам, либо кто-то другой»).
  if (!people.some((p) => p.role === "executor")) {
    const me = await authorAssigneeName(admin, userId, createdBy);
    if (me) people = [{ name: me, role: "executor" }, ...people.filter((p) => p.name !== me)];
  }
  const executors = people.filter((p) => p.role === "executor").map((p) => p.name);
  const id = uid();
  // Номер ставит база (миграция 0045) — он нужен сообщению исполнителю.
  const { data: inserted, error } = await admin
    .from("tasks")
    .insert(newTaskRow({ id, userId, title, description, assignee: executors[0] || people[0]?.name || "", deadline: deadline || null, createdBy }))
    .select("number")
    .maybeSingle();
  if (error) return { text: "Не получилось сохранить задачу: " + error.message };

  // По одному вызову на роль: внутри они вставляются пачкой, а роль у
  // пачки одна.
  const notes: string[] = [];
  for (const role of ["executor", "coexecutor", "watcher"] as const) {
    const names = people.filter((p) => p.role === role).map((p) => p.name);
    if (!names.length) continue;
    // createdBy передаётся дальше: по нему attachExecutors понимает, значит
    // ли строка «… (я)» в списке «себе» — или это руководитель поручает
    // задачу владельцу, и тому надо сказать, как любому другому.
    const result = await attachExecutors(admin, userId, { id, title, description, deadline: deadline || null, number: inserted?.number ?? null }, names, role, createdBy);
    const note = assignNote(result);
    if (note) notes.push(note);
  }

  const when = deadline ? `, срок ${fmtDate(deadline)}` : ", без срока";
  const who = people.map((p) => p.name).join(", ");
  return { text: `✅ Поручено: ${taskRef({ title, number: inserted?.number ?? null })}\n${who}${when}.${notes.length ? "\n\n" + notes.join("\n") : ""}` };
}
