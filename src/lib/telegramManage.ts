import { createAdminClient } from "@/lib/supabase/admin";
import { applyBulkMove, type BulkMovePlan } from "@/lib/bulkActions";

// Editing/completing/deleting existing tasks and meetings from Telegram.
// The model only ever supplies an action + a title fragment ("query") — it
// never sees or invents ids. Matching against the real rows (and requiring
// an explicit "да" before any delete) happens entirely in code, the same
// belt-and-suspenders principle as sanitizeAgainstKnown() in quickAdd.ts:
// never trust the model with something code can verify instead.

export type ManageAction = "complete" | "success" | "no_result" | "reopen" | "delete";
export type ManageItemType = "task" | "meeting";

// Two things wait for a "да": deleting one item, and creating the batch of
// tasks pulled out of dictated meeting notes. The delete shape is kept
// exactly as it was, without a discriminator, so rows already sitting in
// telegram_accounts.pending_action from before this existed still resolve.
export type PendingDelete = { itemType: ManageItemType; id: string; title: string };
export type PendingCreateTasks = {
  kind: "create_tasks";
  userId: string;
  tasks: { title: string; assignee: string; deadline: string; priority: "high" | "med" }[];
};
export type PendingBulkMove = { kind: "bulk_move"; plan: BulkMovePlan };
export type PendingAction = PendingDelete | PendingCreateTasks | PendingBulkMove;

function isCreateTasks(p: PendingAction): p is PendingCreateTasks {
  return (p as PendingCreateTasks).kind === "create_tasks";
}

function isBulkMove(p: PendingAction): p is PendingBulkMove {
  return (p as PendingBulkMove).kind === "bulk_move";
}

function fmtDate(iso: string): string {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y}`;
}

export function fuzzyMatch(title: string, query: string): boolean {
  const t = title.toLowerCase().trim();
  const q = query.toLowerCase().trim();
  if (!t || !q) return false;
  return t.includes(q) || q.includes(t);
}

type Candidate = { id: string; title: string; extra?: string };

async function findCandidates(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
  itemType: ManageItemType,
  action: ManageAction,
  query: string,
): Promise<Candidate[]> {
  if (itemType === "task") {
    let q = admin.from("tasks").select("id, title, status").eq("user_id", userId).is("deleted_at", null);
    if (action === "complete") q = q.eq("status", "in_progress");
    if (action === "reopen") q = q.eq("status", "done");
    const { data } = await q;
    return (data || [])
      .filter((t) => fuzzyMatch(t.title as string, query))
      .map((t) => ({ id: t.id as string, title: t.title as string }));
  }

  let q = admin.from("meetings").select("id, title, date, status").eq("user_id", userId).is("deleted_at", null);
  if (action === "success" || action === "no_result") q = q.eq("status", "planned");
  if (action === "reopen") q = q.in("status", ["success", "no_result"]);
  const { data } = await q;
  return (data || [])
    .filter((m) => fuzzyMatch(m.title as string, query))
    .map((m) => ({ id: m.id as string, title: m.title as string, extra: fmtDate(m.date as string) }));
}

function describeAction(action: ManageAction, itemType: ManageItemType): string {
  if (action === "complete") return "отметить выполненной";
  if (action === "success") return "отметить успешной";
  if (action === "no_result") return "отметить без результата";
  if (action === "reopen") return itemType === "task" ? "вернуть в работу" : "вернуть в план";
  return "удалить";
}

async function applyAction(
  admin: ReturnType<typeof createAdminClient>,
  itemType: ManageItemType,
  action: ManageAction,
  id: string,
): Promise<{ error: string | null }> {
  if (itemType === "task") {
    if (action === "delete") {
      // Soft delete (spec-audit recommendation #4) — marks the row instead
      // of physically removing it, recoverable indefinitely rather than
      // gone the instant "да" is confirmed.
      const { error } = await admin.from("tasks").update({ deleted_at: new Date().toISOString() }).eq("id", id);
      return { error: error?.message || null };
    }
    const status = action === "complete" ? "done" : action === "reopen" ? "in_progress" : null;
    if (!status) return { error: "Это действие неприменимо к задаче" };
    const patch: Record<string, unknown> = { status };
    if (status === "in_progress") patch.last_completed_on = null;
    const { error } = await admin.from("tasks").update(patch).eq("id", id);
    return { error: error?.message || null };
  }

  if (action === "delete") {
    const { error } = await admin.from("meetings").update({ deleted_at: new Date().toISOString() }).eq("id", id);
    return { error: error?.message || null };
  }
  const status = action === "success" ? "success" : action === "no_result" ? "no_result" : action === "reopen" ? "planned" : null;
  if (!status) return { error: "Это действие неприменимо ко встрече" };
  const { error } = await admin.from("meetings").update({ status }).eq("id", id);
  return { error: error?.message || null };
}

// Returns the reply text, and — only for a delete awaiting confirmation —
// the pending_action payload the caller should persist.
export async function handleManageItem(
  userId: string,
  action: ManageAction,
  itemType: ManageItemType,
  query: string,
): Promise<{ reply: string; pendingAction: PendingAction | null }> {
  const admin = createAdminClient();
  const kindLabel = itemType === "task" ? "задачу" : "встречу";

  const candidates = await findCandidates(admin, userId, itemType, action, query);

  if (candidates.length === 0) {
    return { reply: `Не нашёл ${kindLabel} «${query}» среди подходящих для этого действия.`, pendingAction: null };
  }
  if (candidates.length > 1) {
    const list = candidates.slice(0, 6).map((c, i) => `${i + 1}) ${c.title}${c.extra ? " — " + c.extra : ""}`).join("\n");
    return { reply: `Нашёл несколько совпадений, уточните название:\n${list}`, pendingAction: null };
  }

  const only = candidates[0];
  if (action === "delete") {
    return {
      reply: `Удалить ${kindLabel} «${only.title}»? Ответьте «да» для подтверждения — любой другой ответ отменит удаление.`,
      pendingAction: { itemType, id: only.id, title: only.title },
    };
  }

  const { error } = await applyAction(admin, itemType, action, only.id);
  if (error) return { reply: `Не получилось: ${error}`, pendingAction: null };
  return { reply: `✓ «${only.title}» — ${describeAction(action, itemType)}.`, pendingAction: null };
}

const AFFIRMATIVE = ["да", "ага", "угу", "yes", "y", "давай", "удали", "конечно", "подтверждаю"];

export async function resolvePendingAction(
  pending: PendingAction,
  replyText: string,
): Promise<string> {
  const admin = createAdminClient();
  const normalized = replyText.trim().toLowerCase();
  const confirmed = AFFIRMATIVE.includes(normalized);

  if (isBulkMove(pending)) {
    if (!confirmed) return "Отменено — ничего не переносил.";
    return await applyBulkMove(pending.plan);
  }

  if (isCreateTasks(pending)) {
    if (!confirmed) return "Отменено — ни одной задачи не создал.";
    const rows = pending.tasks.map((t) => ({
      id: "tg" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
      user_id: pending.userId,
      title: t.title,
      description: "",
      assignee: t.assignee || "",
      priority: t.priority,
      term: "short",
      status: "in_progress",
      deadline: t.deadline || null,
      recur: "none",
    }));
    const { error } = await admin.from("tasks").insert(rows);
    if (error) return "Не получилось создать задачи: " + error.message;
    return `✓ Создано задач: ${rows.length}\n` + rows.map((r) => `• ${r.title}${r.assignee ? " — " + r.assignee : ""}`).join("\n");
  }

  if (!confirmed) {
    return `Отменено, «${pending.title}» не тронул.`;
  }
  const { error } = await applyAction(admin, pending.itemType, "delete", pending.id);
  if (error) return `Не получилось удалить: ${error}`;
  return `✓ Удалено: «${pending.title}».`;
}
