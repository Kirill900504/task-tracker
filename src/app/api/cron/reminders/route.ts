import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { notifyOwner } from "@/lib/botDelivery";
import { moscowNow, dateStr, minutesOfDay } from "@/lib/taskLogic";
import { isRussianWorkingDay } from "@/lib/workCalendar";
import { buildBriefFacts, briefIsEmpty, composeBrief } from "@/lib/dailyBrief";
import { buildWeeklyFacts, weeklyIsEmpty, composeWeekly } from "@/lib/weeklyReview";
import { dueReminder, minutesUntil, ownerReminder, participantReminder } from "@/lib/meetingReminders";
import { voteTally, type MeetingVote } from "@/lib/meetingVotes";
import { chatsFor, meetingButtons, type ColleagueRow } from "@/lib/colleagues";
import { sendToColleague } from "@/lib/botDelivery";

// Not before 08:00 Moscow time: the briefing is a morning read, and the
// pinger runs around the clock.
const BRIEF_FROM_MINUTES = 8 * 60;

// Called every few minutes by an external pinger (Vercel's own free cron is
// once-a-day only, too coarse for "meeting in 15 minutes"). Checks every
// connected account for newly-due tasks and soon-starting meetings —
// mirrors checkDueTasks()/checkMeetingReminders() in legacy-tracker.js, but
// server-side so it fires even when no browser tab is open.
//
// Owners are counted once, whichever messengers they use: a reminder goes to
// all of them (notifyOwner), and the "already sent" record is keyed by the
// person, so connecting a second messenger never doubles the morning brief.

type MeetingRow = {
  id: string;
  title: string;
  date: string;
  time: string;
  participants: string[];
  status: string;
  vote_round?: number | null;
};

type VoteRow = {
  assignee_id: string;
  response: "none" | "yes" | "no";
  reason: string | null;
  round: number;
  assignees: { name: string } | { name: string }[] | null;
};

export async function GET(req: Request) {
  const url = new URL(req.url);
  // Two ways to authenticate, header first. A secret in the query string is
  // written into every access log it passes through — the external pinger
  // that calls this every five minutes can send a header instead, and the
  // query form stays only so switching it over is not a flag day.
  const secret = process.env.CRON_SECRET;
  const headerAuth = req.headers.get("authorization") === `Bearer ${secret}`;
  const queryAuth = url.searchParams.get("secret") === secret;
  if (!secret || (!headerAuth && !queryAuth)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const admin = createAdminClient();
  const now = moscowNow();
  const today = dateStr(now);
  // «За сутки» напоминают накануне, поэтому в выборку берётся и завтра.
  const tomorrowDate = new Date(now);
  tomorrowDate.setUTCDate(tomorrowDate.getUTCDate() + 1);
  const tomorrow = dateStr(tomorrowDate);
  const nowMin = minutesOfDay(now);

  // The morning briefing and the weekly review are work-day only: nothing on
  // weekends or public holidays (including the shifted days off the Russian
  // производственный календарь introduces). Meeting reminders below are NOT
  // gated by this — a meeting deliberately scheduled on a day off still
  // needs its 15-minute warning.
  const workingDay = await isRussianWorkingDay(now);

  const [{ data: tgAccounts }, { data: maxAccounts }] = await Promise.all([
    admin.from("telegram_accounts").select("user_id"),
    admin.from("max_accounts").select("user_id"),
  ]);
  const userIds = [...new Set([...(tgAccounts || []), ...(maxAccounts || [])].map((r) => r.user_id as string))];
  if (!userIds.length) return NextResponse.json({ ok: true, checked: 0 });

  for (const userId of userIds) {

    // The morning briefing replaces what used to be a line-per-task dump:
    // one note saying what actually matters today and why. Sent once a day,
    // on a working day, and not before BRIEF_FROM_MINUTES — a list of tasks
    // arriving at 00:05 (whenever the pinger first ran after midnight) was
    // no use to anybody.
    if (workingDay && nowMin >= BRIEF_FROM_MINUTES) {
      const { error: briefTaken } = await admin
        .from("telegram_notifications")
        .insert({ user_id: userId, kind: "daily_brief", ref_id: today, notif_date: today });
      if (!briefTaken) {
        try {
          const facts = await buildBriefFacts(admin, userId);
          if (!briefIsEmpty(facts)) await notifyOwner(admin, userId, await composeBrief(facts));
        } catch (e) {
          console.error("daily brief failed:", e);
        }
      }
    }

    // Weekly review — Mondays, same time window, once a week.
    if (workingDay && nowMin >= BRIEF_FROM_MINUTES && now.getUTCDay() === 1) {
      const { error: weeklyTaken } = await admin
        .from("telegram_notifications")
        .insert({ user_id: userId, kind: "weekly_review", ref_id: today, notif_date: today });
      if (!weeklyTaken) {
        try {
          const facts = await buildWeeklyFacts(admin, userId);
          if (!weeklyIsEmpty(facts)) await notifyOwner(admin, userId, await composeWeekly(facts));
        } catch (e) {
          console.error("weekly review failed:", e);
        }
      }
    }

    // Сегодняшние и завтрашние: за сутки напоминают именно накануне.
    const { data: meetings } = await admin
      .from("meetings")
      .select("id,title,date,time,participants,status,vote_round")
      .eq("user_id", userId)
      .in("date", [today, tomorrow])
      .is("deleted_at", null);

    for (const m of (meetings || []) as MeetingRow[]) {
      if (m.status !== "planned" || !m.time) continue;
      const [hh, mm] = m.time.split(":").map(Number);
      if (Number.isNaN(hh) || Number.isNaN(mm)) continue;

      const window = dueReminder(minutesUntil(m.date, hh * 60 + mm, today, nowMin));
      if (!window) continue;

      const when = `${m.date.split("-").reverse().join(".")}, ${m.time}`;
      const round = Number((m as { vote_round?: number }).vote_round ?? 1) || 1;

      // Ответы — источник правды о том, кого ещё спрашивать. Их может не
      // быть вовсе (встреча заведена до того, как появилось голосование):
      // тогда не ответил никто, что и есть правда.
      const { data: voteRows } = await admin
        .from("meeting_participants")
        .select("assignee_id, response, reason, round, assignees(name)")
        .eq("meeting_id", m.id);

      const votes: MeetingVote[] = ((voteRows || []) as VoteRow[]).map((v) => ({
        assigneeId: v.assignee_id,
        name: Array.isArray(v.assignees) ? v.assignees[0]?.name || "" : v.assignees?.name || "",
        role: "participant",
        response: v.response,
        reason: v.reason,
        round: v.round,
      }));
      const named = new Set(votes.map((v) => v.name));
      for (const name of m.participants || []) {
        if (!named.has(name)) votes.push({ assigneeId: "", name, role: "participant", response: "none", reason: null, round });
      }

      const tally = voteTally(votes, round);

      const { error: ownerDup } = await admin
        .from("telegram_notifications")
        .insert({ user_id: userId, kind: window.kind, ref_id: m.id, notif_date: today });
      if (!ownerDup) await notifyOwner(admin, userId, ownerReminder(window.kind, m.title, when, tally));

      // Кому именно писать: молчащим — вопрос, согласившимся — напоминание.
      const wanted = window.audience === "unanswered" ? tally.pending : tally.yes;
      if (!wanted.length) continue;

      const { data: people } = await admin
        .from("assignees")
        .select("id, name, telegram_chat_id, max_user_id")
        .eq("user_id", userId)
        .in("name", wanted);

      for (const person of (people || []) as ColleagueRow[]) {
        const target = chatsFor(person)[0];
        if (!target) continue;
        // Дедупликация по человеку, а не по встрече: иначе первый же
        // отправленный участник закроет окно для всех остальных.
        const { error } = await admin
          .from("telegram_notifications")
          .insert({ user_id: userId, kind: window.kind, ref_id: `${m.id}:${person.id}`, notif_date: today });
        if (error) continue;
        await sendToColleague(
          target,
          participantReminder(window.kind, m.title, when, window.audience),
          // Молчащему кнопки нужны: напоминание без них — это просьба
          // ответить куда-то не сюда.
          window.audience === "unanswered" ? meetingButtons(m.id) : undefined,
        );
      }
    }
  }

  return NextResponse.json({ ok: true, checked: userIds.length });
}
