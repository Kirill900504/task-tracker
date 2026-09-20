import type { SupabaseClient } from "@supabase/supabase-js";
import type { BotButton } from "@/lib/botTransport";
import { encodeCallback } from "@/lib/colleagues";
import { fmtDate } from "@/lib/taskDisplay";
import { sortByPeopleOrder } from "@/lib/peopleOrder";
import { newTaskRow } from "@/lib/newTask";
import { attachExecutors, assignNote } from "@/lib/assignExecutors";
import { withoutSelfMark } from "@/lib/actorName";
import { uid } from "@/lib/uid";

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
  stage: "title" | "who";
  title?: string;
};

export function startNewTask(): { text: string; pending: NewTaskPending } {
  return {
    text: "➕ Что поручить? Напишите одной фразой или надиктуйте голосом — дальше выберем кому и на когда.",
    pending: { kind: "new_task", stage: "title" },
  };
}

export async function whoButtons(admin: SupabaseClient, userId: string): Promise<BotButton[][]> {
  const { data: people } = await admin.from("assignees").select("id, name").eq("user_id", userId);
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
    [{ text: "Без срока", data: encodeCallback("task", "nwhenno", "x") }],
  ];
}

export function resolveWhen(code: string, today: Date = new Date()): string {
  if (code === "no") return "";
  const d = new Date(today);
  d.setHours(0, 0, 0, 0);
  if (code === "fri") {
    // Ближайшая пятница, и никогда не сегодняшняя: «к пятнице», сказанное
    // в пятницу, означает следующую — сегодня уже поздно договариваться.
    const ahead = (5 - d.getDay() + 7) % 7 || 7;
    d.setDate(d.getDate() + ahead);
  } else {
    d.setDate(d.getDate() + (Number(code) || 0));
  }
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
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
): Promise<{ text: string }> {
  const executors = people.filter((p) => p.role === "executor").map((p) => p.name);
  const id = uid();
  const { error } = await admin.from("tasks").insert(
    newTaskRow({ id, userId, title, assignee: executors[0] || people[0]?.name || "", deadline: deadline || null, createdBy }),
  );
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
    const result = await attachExecutors(admin, userId, { id, title, deadline: deadline || null }, names, role, createdBy);
    const note = assignNote(result);
    if (note) notes.push(note);
  }

  const when = deadline ? `, срок ${fmtDate(deadline)}` : ", без срока";
  const who = people.map((p) => p.name).join(", ");
  return { text: `✅ Поручено: «${title}»\n${who}${when}.${notes.length ? "\n\n" + notes.join("\n") : ""}` };
}
