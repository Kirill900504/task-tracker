import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendTelegramMessage } from "@/lib/telegram";
import { moscowNow, dateStr, minutesOfDay, isDueToday, isOverdue, type TaskRow } from "@/lib/taskLogic";

// Called every few minutes by an external pinger (Vercel's own free cron is
// once-a-day only, too coarse for "meeting in 15 minutes"). Checks every
// linked Telegram account for newly-due tasks and soon-starting meetings —
// mirrors checkDueTasks()/checkMeetingReminders() in legacy-tracker.js, but
// server-side so it fires even when no browser tab is open.

type MeetingRow = {
  id: string;
  title: string;
  date: string;
  time: string;
  participants: string[];
  status: string;
};

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
