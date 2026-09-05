import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendTelegramMessage } from "@/lib/telegram";
import { moscowNow, dateStr, minutesOfDay } from "@/lib/taskLogic";
import { isRussianWorkingDay } from "@/lib/workCalendar";
import { buildBriefFacts, briefIsEmpty, composeBrief } from "@/lib/dailyBrief";
import { buildWeeklyFacts, weeklyIsEmpty, composeWeekly } from "@/lib/weeklyReview";

// Not before 08:00 Moscow time: the briefing is a morning read, and the
// pinger runs around the clock.
const BRIEF_FROM_MINUTES = 8 * 60;

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

  // The morning briefing and the weekly review are work-day only: nothing on
  // weekends or public holidays (including the shifted days off the Russian
  // производственный календарь introduces). Meeting reminders below are NOT
  // gated by this — a meeting deliberately scheduled on a day off still
  // needs its 15-minute warning.
  const workingDay = await isRussianWorkingDay(now);

  const { data: accounts } = await admin.from("telegram_accounts").select("telegram_chat_id, user_id");
  if (!accounts || !accounts.length) return NextResponse.json({ ok: true, checked: 0 });

  for (const acc of accounts) {
    const chatId = acc.telegram_chat_id as number;
    const userId = acc.user_id as string;

    // The morning briefing replaces what used to be a line-per-task dump:
    // one note saying what actually matters today and why. Sent once a day,
    // on a working day, and not before BRIEF_FROM_MINUTES — a list of tasks
    // arriving at 00:05 (whenever the pinger first ran after midnight) was
    // no use to anybody.
    if (workingDay && nowMin >= BRIEF_FROM_MINUTES) {
      const { error: briefTaken } = await admin
        .from("telegram_notifications")
        .insert({ telegram_chat_id: chatId, kind: "daily_brief", ref_id: today, notif_date: today });
      if (!briefTaken) {
        try {
          const facts = await buildBriefFacts(admin, userId);
          if (!briefIsEmpty(facts)) await sendTelegramMessage(chatId, await composeBrief(facts));
        } catch (e) {
          console.error("daily brief failed:", e);
        }
      }
    }

    // Weekly review — Mondays, same time window, once a week.
    if (workingDay && nowMin >= BRIEF_FROM_MINUTES && now.getUTCDay() === 1) {
      const { error: weeklyTaken } = await admin
        .from("telegram_notifications")
        .insert({ telegram_chat_id: chatId, kind: "weekly_review", ref_id: today, notif_date: today });
      if (!weeklyTaken) {
        try {
          const facts = await buildWeeklyFacts(admin, userId);
          if (!weeklyIsEmpty(facts)) await sendTelegramMessage(chatId, await composeWeekly(facts));
        } catch (e) {
          console.error("weekly review failed:", e);
        }
      }
    }

    const { data: meetings } = await admin
      .from("meetings")
      .select("id,title,date,time,participants,status")
      .eq("user_id", userId)
      .eq("date", today)
      .is("deleted_at", null);

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
