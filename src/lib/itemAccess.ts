import type { SupabaseClient } from "@supabase/supabase-js";
import { isSelfAssignee } from "@/lib/trackerRows";

// Видит ли этот человек это дело — тот же вопрос, что задаёт база
// (`private.can_see_item`, миграции 0057/0063), но для кода, который ходит в
// базу служебным ключом и потому мимо её правил: бот, крон, маршруты.
//
// Нужна она потому, что «то же пространство» — не ответ. Аудит 15.10.2026
// нашёл это в обеих «💬 Ответить» бота: проверялось, что задача лежит в
// пространстве нажавшего, а не что он на ней стоит. Нажатие подделывается
// сторонним клиентом мессенджера, и тогда бот называл заголовок чужой задачи
// («уйдёт в обсуждение задачи «…»») и клал следующий текст в её переписку.
//
// Правило то же, что у базы, слово в слово: своё пространство И (поставил
// сам — `coalesce(created_by, владелец)` — ИЛИ стоит в составе ИЛИ, у
// встречи, назван в списке). Менять одно без другого нельзя: это две
// записи одного правила, и разойдутся они ровно там, где их не сверили.

export type Viewer = {
  // Пространство, в котором человек работает (id владельца).
  spaceId: string;
  // Его учётная запись, если она есть. У владельца — тот же spaceId; у
  // человека без входа — null: поставить задачу он не мог, значит
  // автором не бывает.
  authId: string | null;
  // Его строка в списке людей. У владельца её можно не передавать —
  // найдётся по пометке «(я)».
  assigneeId?: string | null;
};

export type SeenItem = { id: string; title: string };

export async function seenItem(
  admin: SupabaseClient,
  who: Viewer,
  kind: "task" | "meeting" | "idea",
  itemId: string,
): Promise<SeenItem | null> {
  const table = kind === "task" ? "tasks" : kind === "meeting" ? "meetings" : "ideas";
  const columns = kind === "meeting" ? "id, title, user_id, created_by, participants" : kind === "idea" ? "id, text, user_id, created_by" : "id, title, user_id, created_by";
  const { data } = await admin.from(table).select(columns).eq("id", itemId).is("deleted_at", null).maybeSingle();
  const row = data as { id: string; title?: string; text?: string; user_id: string; created_by: string | null; participants?: string[] | null } | null;
  if (!row || row.user_id !== who.spaceId) return null;
  const item = { id: row.id, title: row.title ?? (row.text || "").slice(0, 60) };

  if (who.authId && (row.created_by ?? row.user_id) === who.authId) return item;

  let assigneeId = who.assigneeId || null;
  let name = "";
  if (!assigneeId && who.authId === who.spaceId) {
    const { data: people } = await admin.from("assignees").select("id, name").eq("user_id", who.spaceId);
    const self = ((people || []) as { id: string; name: string }[]).find((p) => isSelfAssignee(p.name));
    assigneeId = self?.id || null;
    name = self?.name || "";
  }
  if (!assigneeId) return null;

  const partTable = kind === "task" ? "task_participants" : kind === "meeting" ? "meeting_participants" : "idea_recipients";
  const partColumn = kind === "task" ? "task_id" : kind === "meeting" ? "meeting_id" : "idea_id";
  const { data: part } = await admin.from(partTable).select("id").eq(partColumn, itemId).eq("assignee_id", assigneeId).maybeSingle();
  if (part) return item;

  if (kind === "meeting") {
    if (!name) {
      const { data: me } = await admin.from("assignees").select("name").eq("id", assigneeId).maybeSingle();
      name = (me as { name?: string } | null)?.name || "";
    }
    if (name && (row.participants || []).includes(name)) return item;
  }
  return null;
}
