import type { SupabaseClient } from "@supabase/supabase-js";
import { isSelfAssignee } from "@/lib/trackerRows";

// Назначено ли то, что выглядит назначенным.
//
// У задачи два способа сказать, кто её делает: имя в поле `assignee`, которое
// видно на карточке, и строка в task_participants, в которой живут «Принял /
// Сделал», «2 из 4» и статистика по людям. Пока они сходятся, всё честно.
// Когда расходятся, трекер врёт в самую дорогую сторону: постановщик видит
// имя и считает, что поручил, а человеку не пришло ничего.
//
// Так и случилось: три места создавали задачи, и два из них строк участия не
// заводили (см. assignExecutors.ts). Причины починены, но появится четвёртое
// место — и никто об этом не узнает, пока кого-нибудь не спросят, почему он
// неделю ничего не делал. Поэтому расхождение теперь ищется само и попадает
// в понедельничную сводку.
//
// Тот же вопрос задаёт scripts/check-assignments.mjs — он умеет ещё и
// дозаводить недостающее, и остаётся инструментом для разовой починки.

export type AssignmentDrift = { title: string; assignee: string }[];

export async function findAssignmentDrift(admin: SupabaseClient, userId: string): Promise<AssignmentDrift> {
  const { data: tasks } = await admin
    .from("tasks")
    .select("id, title, assignee")
    .eq("user_id", userId)
    .neq("status", "done")
    .is("deleted_at", null);

  // Задача, которую владелец завёл сам себе, строки участия не имеет и
  // иметь не должна: и триггер 0024, и форма пропускают строку «… (я)»
  // именно потому, что «поручить себе» — не поручение. Без этого условия
  // каждая его личная задача приходила бы в понедельничную сводку строкой
  // «человек её не видит», то есть тревогой про него самого. Скрипт
  // check-assignments.mjs, задающий тот же вопрос, так и считал с самого
  // начала — здесь была вторая правда об одном факте.
  const named = ((tasks || []) as { id: string; title: string; assignee: string | null }[]).filter(
    (t) => (t.assignee || "").trim() && !isSelfAssignee(t.assignee || ""),
  );
  if (!named.length) return [];

  // Одним запросом, а не по задаче: сорок задач — сорок круговых поездок в
  // базу внутри крона, который и так ходит каждые несколько минут.
  const { data: parts } = await admin
    .from("task_participants")
    .select("task_id")
    .eq("user_id", userId)
    .in(
      "task_id",
      named.map((t) => t.id),
    );

  const assigned = new Set(((parts || []) as { task_id: string }[]).map((p) => p.task_id));
  return named.filter((t) => !assigned.has(t.id)).map((t) => ({ title: t.title, assignee: (t.assignee || "").trim() }));
}
