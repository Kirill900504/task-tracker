import { createAdminClient } from "@/lib/supabase/admin";
import { moscowNow, dateStr, isDueToday, isOverdue, type TaskRow } from "@/lib/taskLogic";

// Read-only Telegram commands ("что на сегодня", "просрочено", "встречи").
// Deliberately matched by EXACT normalized phrase, not substring — a
// substring match on e.g. "сегодня" would also fire on a genuine quick-add
// phrase like "сегодня позвонить Иванову" and silently swallow it instead of
// creating the task. Kept separate from the GigaChat quick-add path: these
// are free (no LLM call) and can't misfire the way NLP classification can.

export type QueryKind = "today" | "overdue" | "meetings" | "crashes" | "help";

const TRIGGERS: Record<QueryKind, string[]> = {
  today: ["/today", "сегодня", "что сегодня", "что на сегодня", "задачи на сегодня"],
  overdue: ["/overdue", "просрочено", "просроченные", "что просрочено", "просроченные задачи"],
  meetings: ["/meetings", "встречи", "какие встречи", "ближайшие встречи"],
  // Журнал поломок. Раньше спросить об этом было негде: трекер падал, и
  // единственным способом узнать подробности было пересказать их словами.
  crashes: ["/errors", "ошибки", "поломки", "что сломалось", "сбои"],
  help: ["/help", "помощь", "команды", "что умеешь"],
};

export function matchQueryCommand(text: string): QueryKind | null {
  const norm = text.trim().toLowerCase().replace(/[?!.]+$/, "");
  for (const kind of Object.keys(TRIGGERS) as QueryKind[]) {
    if (TRIGGERS[kind].includes(norm)) return kind;
  }
  return null;
}

function fmtDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y}`;
}

async function replyToday(admin: ReturnType<typeof createAdminClient>, userId: string): Promise<string> {
  const now = moscowNow();
  const today = dateStr(now);

  const { data: taskRows } = await admin
    .from("tasks")
    .select("id, title, assignee, status, deadline, recur, recur_weekday, recur_monthday, recur_year_day, recur_year_month")
    .eq("user_id", userId)
    .eq("status", "in_progress")
    .is("deleted_at", null);
  const tasks = ((taskRows || []) as TaskRow[]).filter((t) => isDueToday(t, now, today));

  const { data: meetingRows } = await admin
    .from("meetings")
    .select("title, time, participants")
    .eq("user_id", userId)
    .eq("date", today)
    .eq("status", "planned")
    .is("deleted_at", null)
    .order("time");

  if (!tasks.length && !(meetingRows || []).length) {
    return "На сегодня ничего не запланировано 🎉";
  }

  const lines: string[] = [`📌 На сегодня (${fmtDate(today)}):`];
  if (tasks.length) {
    lines.push("");
    lines.push("Задачи:");
    for (const t of tasks) lines.push(`• ${t.title}${t.assignee ? " — " + t.assignee : ""}`);
  }
  if (meetingRows && meetingRows.length) {
    lines.push("");
    lines.push("Встречи:");
    for (const m of meetingRows) {
      const who = (m.participants as string[]).length ? " — " + (m.participants as string[]).join(", ") : "";
      lines.push(`• ${m.time ? m.time + " " : ""}${m.title}${who}`);
    }
  }
  return lines.join("\n");
}

async function replyOverdue(admin: ReturnType<typeof createAdminClient>, userId: string): Promise<string> {
  const today = dateStr(moscowNow());
  const { data: taskRows } = await admin
    .from("tasks")
    .select("id, title, assignee, status, deadline, recur, recur_weekday, recur_monthday, recur_year_day, recur_year_month")
    .eq("user_id", userId)
    .eq("status", "in_progress")
    .eq("recur", "none")
    .not("deadline", "is", null)
    .is("deleted_at", null);
  const overdue = ((taskRows || []) as TaskRow[])
    .filter((t) => isOverdue(t, today))
    .sort((a, b) => (a.deadline || "").localeCompare(b.deadline || ""));

  if (!overdue.length) return "Просроченных задач нет 👍";

  const lines = ["⚠ Просрочено:"];
  for (const t of overdue) {
    lines.push(`• ${t.title}${t.assignee ? " — " + t.assignee : ""} (срок был ${fmtDate(t.deadline as string)})`);
  }
  return lines.join("\n");
}

async function replyMeetings(admin: ReturnType<typeof createAdminClient>, userId: string): Promise<string> {
  const today = dateStr(moscowNow());
  const { data: rows } = await admin
    .from("meetings")
    .select("title, date, time, participants")
    .eq("user_id", userId)
    .eq("status", "planned")
    .gte("date", today)
    .is("deleted_at", null)
    .order("date")
    .order("time")
    .limit(10);

  if (!rows || !rows.length) return "Ближайших встреч не запланировано";

  const lines = ["📅 Ближайшие встречи:"];
  for (const m of rows) {
    const who = (m.participants as string[]).length ? " — " + (m.participants as string[]).join(", ") : "";
    lines.push(`• ${fmtDate(m.date as string)}${m.time ? ", " + m.time : ""} ${m.title}${who}`);
  }
  return lines.join("\n");
}

// «Ошибки» — что ломалось за сутки.
//
// Отвечает на вопрос, который до 19.09.2026 задать было некому: трекер
// падал, Кирилл писал «вылетает эта ошибка», и починка начиналась с
// пересказа. Здесь та же информация, что в журнале (client_errors), но
// свёрнутая до читаемого размера: одинаковые поломки — одной строкой со
// счётчиком, потому что одна ошибка у четырнадцати человек остаётся одной
// ошибкой.
async function replyCrashes(admin: ReturnType<typeof createAdminClient>, userId: string): Promise<string> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data } = await admin
    .from("client_errors")
    .select("message, url, release, fingerprint, created_at")
    .eq("owner_id", userId)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(200);

  const rows = data || [];
  if (!rows.length) return "✅ За сутки трекер не ломался ни разу.";

  const groups = new Map<string, { message: string; count: number; last: string; url: string | null; release: string | null }>();
  for (const row of rows) {
    const key = row.fingerprint;
    const seen = groups.get(key);
    if (seen) {
      seen.count++;
      continue;
    }
    groups.set(key, { message: row.message, count: 1, last: row.created_at, url: row.url, release: row.release });
  }

  const lines = ["⚠️ Поломки за сутки: " + rows.length + " (разных: " + groups.size + ")", ""];
  for (const group of [...groups.values()].slice(0, 8)) {
    const when = new Date(group.last).toLocaleString("ru-RU", { timeZone: "Europe/Moscow", hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" });
    lines.push("• " + group.message.split("\n")[0].slice(0, 160));
    const where = (group.url || "").replace(/^https?:\/\/[^/]+/, "") || "—";
    lines.push("  " + when + " · " + where + (group.release ? " · версия " + group.release : "") + (group.count > 1 ? " · повторов: " + group.count : ""));
  }
  if (groups.size > 8) lines.push("", "…и ещё " + (groups.size - 8) + " разных.");
  lines.push("", "Полный текст с местом в коде лежит в журнале — покажите это сообщение мне, и я разберу.");
  return lines.join("\n");
}

function replyHelp(): string {
  return [
    "Умею:",
    "• Заводить задачи/встречи/идеи по фразе — например «завтра позвонить Сергею»",
    "• «сегодня» / «что на сегодня» — задачи и встречи на сегодня",
    "• «просрочено» — список просроченных задач",
    "• «встречи» — ближайшие запланированные встречи",
    "• «ошибки» — что ломалось за сутки: где, когда и на какой версии",
    "• Отмечать/удалять существующие — например «отметь звонок Сергею выполненным» или «удали встречу с поставщиком» (удаление всегда переспросит подтверждение)",
    "• Голосовые сообщения — распознаю и обработаю так же, как текст (первое сообщение после паузы может занять чуть дольше обычного)",
  ].join("\n");
}

export async function replyForQuery(kind: QueryKind, userId: string): Promise<string> {
  const admin = createAdminClient();
  if (kind === "today") return replyToday(admin, userId);
  if (kind === "overdue") return replyOverdue(admin, userId);
  if (kind === "meetings") return replyMeetings(admin, userId);
  if (kind === "crashes") return replyCrashes(admin, userId);
  return replyHelp();
}
