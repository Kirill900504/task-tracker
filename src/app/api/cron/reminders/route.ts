import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendTelegramMessage } from "@/lib/telegram";

// Called every few minutes by an external pinger (Vercel's own free cron is
// once-a-day only, too coarse for "meeting in 15 minutes"). Checks every
// linked Telegram account for newly-due tasks and soon-starting meetings —
// mirrors checkDueTasks()/checkMeetingReminders() in legacy-tracker.js, but
// server-side so it fires even when no browser tab is open.

// Russia has used a single UTC+3 offset (no DST) since 2014 — shifting the
// UTC timestamp and reading it back with the UTC getters gives Moscow local
// wall-clock fields without needing a timezone library.
function moscowNow(): Date {
  return new Date(Date.now() + 3 * 60 * 60 * 1000);
}
function dateStr(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}
function minutesOfDay(d: Date): number {
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

type TaskRow = {
  id: string;
  title: string;
  assignee: string;
  status: string;
  deadline: string | null;
  recur: string;
  recur_weekday: number | null;
  recur_monthday: number | null;
  recur_year_day: number | null;
  recur_year_month: number | null;
};
type MeetingRow = {
  id: string;
  title: string;
  date: string;
  time: string;
  participants: string[];
  status: string;
};

function isDueToday(t: TaskRow, now: Date, today: string): boolean {
  if (t.recur === "none") return t.deadline === today;
  if (t.recur === "daily") return true;
  if (t.recur === "weekly") return now.getUTCDay() === t.recur_weekday;
  if (t.recur === "monthly") return now.getUTCDate() === t.recur_monthday;
  if (t.recur === "yearly") return now.getUTCDate() === t.recur_year_day && now.getUTCMonth() + 1 === t.recur_year_month;
  return false;
}
function isOverdue(t: TaskRow, today: string): boolean {
  if (t.status === "done") return false;
  if (t.recur !== "none") return false;
  if (!t.deadline) return false;
  return t.deadline < today;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  if (url.searchParams.get("secret") !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const admin = createAdminClient();
  const now = moscowNow();
  const today = dateStr(now);
  const nowMin = minutesOfDay(now);

  const { data: accounts } = await admin.from("telegram_accounts").select("telegram_chat_id, user_id");
  if (!accounts || !accounts.length) return NextResponse.json({ ok: true, checked: 0 });

  for (const acc of accounts) {
    const chatId = acc.telegram_chat_id as number;
    const userId = acc.user_id as string;

    const { data: tasks } = await admin
      .from("tasks")
      .select("id,title,assignee,status,deadline,recur,recur_weekday,recur_monthday,recur_year_day,recur_year_month")
      .eq("user_id", userId);

    const dueLines: string[] = [];
    for (const t of (tasks || []) as TaskRow[]) {
      if (t.status === "done") continue;
      const overdue = isOverdue(t, today);
      const dueToday = !overdue && isDueToday(t, now, today);
      if (!overdue && !dueToday) continue;

      const { error: insErr } = await admin
        .from("telegram_notifications")
        .insert({ telegram_chat_id: chatId, kind: "task_due", ref_id: t.id, notif_date: today });
      if (insErr) continue; // already notified today, or a real error — skip either way

      const label = overdue ? "⚠ Просрочено" : "● Сегодня";
      dueLines.push(`${label}: «${t.title}»${t.assignee ? " — " + t.assignee : ""}`);
    }
    if (dueLines.length) {
      await sendTelegramMessage(chatId, dueLines.join("\n"));
    }

    const { data: meetings } = await admin
      .from("meetings")
      .select("id,title,date,time,participants,status")
      .eq("user_id", userId)
      .eq("date", today);

    for (const m of (meetings || []) as MeetingRow[]) {
      if (m.status !== "planned" || !m.time) continue;
      const [hh, mm] = m.time.split(":").map(Number);
      if (Number.isNaN(hh) || Number.isNaN(mm)) continue;
      const mMin = hh * 60 + mm;
      const who = m.participants && m.participants.length ? " · " + m.participants.join(", ") : "";

      if (nowMin >= mMin - 15 && nowMin < mMin) {
        const { error } = await admin
          .from("telegram_notifications")
          .insert({ telegram_chat_id: chatId, kind: "meeting_soon", ref_id: m.id, notif_date: today });
        if (!error) await sendTelegramMessage(chatId, `🔔 Через 15 минут: «${m.title}» (${m.time})${who}`);
      }
      if (nowMin >= mMin && nowMin <= mMin + 5) {
        const { error } = await admin
          .from("telegram_notifications")
          .insert({ telegram_chat_id: chatId, kind: "meeting_now", ref_id: m.id, notif_date: today });
        if (!error) await sendTelegramMessage(chatId, `🔔 Встреча сейчас: «${m.title}»${who}`);
      }
    }
  }

  return NextResponse.json({ ok: true, checked: accounts.length });
}
