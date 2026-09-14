import { createClient } from "@/lib/supabase/client";
import { isSelfAssignee } from "@/lib/trackerRows";
import { isQuietHour } from "@/lib/quietHours";
import type { TaskParticipantRole } from "@/lib/taskProgress";

// Поставить человека на задачу — одним способом на весь браузер.
//
// Мест, где это происходит, стало три: список участников в карточке,
// сохранение только что созданной задачи и строка быстрого ввода, которая
// заводит задачу без всякой карточки. Правило при этом одно и оно не
// косметическое: назначить и не сказать — это и есть «дал задание и забыл»,
// ради чего весь трекер и затевался. Поэтому вставка строки участия и
// сообщение человеку живут здесь вместе, а не расходятся по трём вызовам,
// из которых один однажды забудут.

// Задача, которую только что создали, ещё не в базе: локальное состояние —
// истина, а запись в облако идёт своим ходом. Сослаться на неё раньше
// времени значит потерять строку участия молча, без единой ошибки на
// экране: внешний ключ просто не даст её вставить.
export async function waitForTaskRow(taskId: string, attempts = 12): Promise<boolean> {
  const db = createClient();
  for (let i = 0; i < attempts; i++) {
    const { data } = await db.from("tasks").select("id").eq("id", taskId).maybeSingle();
    if (data) return true;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

// Возвращает то, о чём постановщик обязан узнать сразу («не подключён»,
// «получит утром»), или пустую строку, если всё прошло тихо и хорошо.
export async function assignPerson(
  taskId: string,
  assigneeId: string,
  name: string,
  role: TaskParticipantRole,
): Promise<string> {
  const db = createClient();
  // user_id проставляет триггер от родительской задачи — никогда отсюда,
  // иначе строка может оказаться в чужом пространстве (миграция 0019).
  await db.from("task_participants").insert({ task_id: taskId, assignee_id: assigneeId, role });

  // «Назначена» — одно из трёх уведомлений, которые нельзя выключить,
  // поэтому отправка не спрашивает разрешения и не зависит от кнопки ✈:
  // та осталась для «покажи это ещё и Ане».
  //
  // Молча ничего не делает, если человек не подключён ни к одному
  // мессенджеру — он всё равно увидит задачу, когда откроет трекер. Ночью
  // трекер молчит (E2): задача не потеряется, она придёт в утренней сводке
  // строкой «ждут вашего ответа». Будить человека ради задачи, к которой он
  // всё равно приступит утром, — верный способ научить его выключать
  // уведомления совсем.
  if (isSelfAssignee(name)) return "";
  if (isQuietHour()) return `Сейчас ночь — ${name} получит задачу утренней сводкой.`;

  try {
    const res = await fetch("/api/telegram/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "task", id: taskId, to: [name] }),
    });
    const data = await res.json().catch(() => null);
    // Не отправилось — чаще всего человек просто не подключён к боту.
    // Промолчать здесь значит оставить постановщика в уверенности, что
    // задачу увидели: он ждёт ответа, а человек о задаче не знает.
    if (!res.ok || !data || data.error || !(data.sentTo || []).length) {
      return `${name} не подключён к мессенджеру — увидит задачу, только когда войдёт в трекер.`;
    }
  } catch {
    return `Не удалось отправить ${name} — проверьте связь.`;
  }
  return "";
}

// Для тех, кто знает только имена: строка быстрого ввода разбирает фразу
// «поручи Игорю и Никите», а идентификаторов людей не видит вовсе.
export async function assignExecutorsByName(taskId: string, names: string[]): Promise<void> {
  const wanted = [...new Set(names.filter((n) => n && n.trim()))].map((n) => n.trim());
  if (!wanted.length) return;

  const db = createClient();
  const { data } = await db.from("assignees").select("id, name").in("name", wanted);
  const people = (data || []) as { id: string; name: string }[];
  if (!people.length) return;

  if (!(await waitForTaskRow(taskId))) return;
  for (const person of people) await assignPerson(taskId, person.id, person.name, "executor");
}
