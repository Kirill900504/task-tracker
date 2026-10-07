import type { SupabaseClient } from "@supabase/supabase-js";
import { withoutSelfMark } from "@/lib/actorName";

// Ссылку на бота выдали, а человек так и не подключился (п.1.1 предложений,
// 07.10.2026). Строка в утренней сводке владельца — второй шаг после
// «Ссылки всем» в «Команде»: ссылку отправили, и дальше о ней забывают
// ровно так же, как о задаче, ради которой трекер и написан.
//
// Признак простой и надёжный: код подключения удаляется в тот момент,
// когда человек нажал «Старт» (botPipeline). Значит, код, который лежит
// дольше двух дней у человека без чата, — приглашение, которое не открыли.
// Старше месяца не показываем: такой человек уже не «не успел», и строка о
// нём каждую неделю перестала бы что-либо значить.

const AFTER_DAYS = 2;
const FORGET_DAYS = 30;

export type PendingInvite = { name: string; days: number };

export function groupPending(
  codes: { assignee_id: string | null; created_at: string }[],
  people: { id: string; name: string; telegram_chat_id: number | null; max_user_id: number | null }[],
  nowMs: number,
): PendingInvite[] {
  const day = 864e5;
  const newest = new Map<string, number>();
  for (const c of codes) {
    if (!c.assignee_id) continue;
    const at = Date.parse(c.created_at);
    if (nowMs - at > FORGET_DAYS * day) continue;
    newest.set(c.assignee_id, Math.max(newest.get(c.assignee_id) || 0, at));
  }
  const out: PendingInvite[] = [];
  for (const p of people) {
    const at = newest.get(p.id);
    if (!at || p.telegram_chat_id != null || p.max_user_id != null) continue;
    const days = Math.floor((nowMs - at) / day);
    // По самой свежей ссылке: выдали заново вчера — ещё не повод.
    if (days >= AFTER_DAYS) out.push({ name: withoutSelfMark(p.name), days });
  }
  return out.sort((a, b) => b.days - a.days);
}

export function composePending(list: PendingInvite[]): string {
  if (!list.length) return "";
  return (
    `📨 Ссылку на бота выдали, но не подключились (${list.length}):\n` +
    list
      .slice(0, 6)
      .map((p) => `• ${p.name} — ${p.days} дн.`)
      .join("\n") +
    "\nНовые ссылки — «Ссылки всем» в «Команде»."
  );
}

export async function findPendingInvites(admin: SupabaseClient, userId: string, nowMs = Date.now()): Promise<PendingInvite[]> {
  const { data: codes } = await admin.from("telegram_link_codes").select("assignee_id, created_at").eq("user_id", userId).not("assignee_id", "is", null);
  const ids = [...new Set(((codes || []) as { assignee_id: string }[]).map((c) => c.assignee_id))];
  if (!ids.length) return [];
  const { data: people } = await admin.from("assignees").select("id, name, telegram_chat_id, max_user_id").in("id", ids);
  return groupPending(
    (codes || []) as { assignee_id: string | null; created_at: string }[],
    (people || []) as { id: string; name: string; telegram_chat_id: number | null; max_user_id: number | null }[],
    nowMs,
  );
}
