import type { SupabaseClient } from "@supabase/supabase-js";
import { isSelfAssignee } from "@/lib/trackerRows";

// Кто молчит.
//
// «Дал поручение — забыл проверить» — фраза, ради которой трекер и
// затевался. Просроченное он показывает давно, но просрочка — это про дату,
// а здесь про человека: задачу выдали, и по ней не нажали ничего. Ни
// «принял», ни «сделал», ни «не могу». Такая задача выглядит живой ровно до
// срока, а потом оказывается, что её никто и не начинал.
//
// Три решения, каждое осознанное:
//
//   * двое суток, а не сутки. Задача, выданная вчера вечером, — это не
//     молчание, это вечер. Планка ниже превратила бы сводку в шум, а шум
//     выключают целиком, вместе с тем, что важно;
//   * только исполнители. Наблюдатель не должен отвечать, и спрашивать с
//     него — верный способ научить людей игнорировать сводку;
//   * отказ считается ответом. «Не могу» — это ответ, и человек, который
//     его дал, молчащим не является: с ним надо говорить о другом;
//   * себя не считаем. Своя задача, по которой не нажали «принял», — это не
//     молчание, а обычное дело в списке; строка «Кирилл (я) молчит пять
//     дней» в собственной сводке выглядит издевательством. На боевых данных
//     это были четыре записи из одиннадцати.
//
// Отсчёт идёт от появления строки участия, а не от создания задачи, — и у
// перенесённых миграцией 0021 записей это дата переноса. Первая сводка
// после неё показывает всех разом; дальше цифра становится настоящей.

export type SilentRow = {
  name: string;
  title: string;
  // Когда задачу выдали — по этой дате и считается, сколько человек молчит.
  since: string;
};

export type SilentPerson = { name: string; count: number; oldest: string; days: number };

const SILENT_AFTER_HOURS = 48;

// Считается отдельно от запроса: цифру и имена нельзя отдавать модели, а
// проверять их без базы — можно.
export function groupSilent(rows: SilentRow[], now: Date): SilentPerson[] {
  const byName = new Map<string, SilentRow[]>();
  for (const r of rows) {
    const list = byName.get(r.name);
    if (list) list.push(r);
    else byName.set(r.name, [r]);
  }

  const out: SilentPerson[] = [];
  for (const [name, list] of byName) {
    const sorted = [...list].sort((a, b) => Date.parse(a.since) - Date.parse(b.since));
    const oldest = sorted[0];
    const days = Math.floor((now.getTime() - Date.parse(oldest.since)) / (24 * 60 * 60 * 1000));
    out.push({ name, count: list.length, oldest: oldest.title, days });
  }
  // Дольше всех молчащий — первым: разговор начинают с него.
  return out.sort((a, b) => b.days - a.days || b.count - a.count);
}

export function composeSilence(people: SilentPerson[]): string {
  if (!people.length) return "";
  const lines = people.slice(0, 5).map((p) => {
    const extra = p.count > 1 ? `, задач: ${p.count}` : "";
    return `• ${p.name} — ${p.days} дн. молчит по «${p.oldest}»${extra}`;
  });
  return `🔇 Не ответили на задачу (${people.length}):\n` + lines.join("\n");
}

export async function findSilent(admin: SupabaseClient, userId: string, now: Date): Promise<SilentPerson[]> {
  const cutoff = new Date(now.getTime() - SILENT_AFTER_HOURS * 60 * 60 * 1000).toISOString();
  const { data } = await admin
    .from("task_participants")
    .select("created_at, assignees(name), tasks(title, status, deleted_at)")
    .eq("user_id", userId)
    .eq("role", "executor")
    .is("accepted_at", null)
    .is("done_at", null)
    .is("declined_at", null)
    .lt("created_at", cutoff);

  type Raw = {
    created_at: string;
    assignees: { name: string } | { name: string }[] | null;
    tasks: { title: string; status: string | null; deleted_at: string | null } | null;
  };

  const rows: SilentRow[] = ((data || []) as unknown as Raw[])
    .filter((r) => r.tasks && !r.tasks.deleted_at && r.tasks.status !== "done")
    .map((r) => ({
      name: (Array.isArray(r.assignees) ? r.assignees[0]?.name : r.assignees?.name) || "",
      title: r.tasks!.title,
      since: r.created_at,
    }))
    .filter((r) => r.name && !isSelfAssignee(r.name));

  return groupSilent(rows, now);
}
