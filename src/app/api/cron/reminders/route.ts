import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { notifyAuthor, notifyOwner } from "@/lib/botDelivery";
import { flushNotices } from "@/lib/noticeQueue";
import { moscowNow, dateStr, minutesOfDay } from "@/lib/taskLogic";
import { isRussianWorkingDay } from "@/lib/workCalendar";
import { buildBriefFacts, briefIsEmpty, composeBrief } from "@/lib/dailyBrief";
import { buildWeeklyFacts, weeklyIsEmpty, composeWeekly } from "@/lib/weeklyReview";
import { dueReminder, minutesUntil, ownerReminder, participantReminder, reasonNudge, recapAsk, recapDue } from "@/lib/meetingReminders";
import { awaitingReason, voteTally, type MeetingVote } from "@/lib/meetingVotes";
import { chatsFor, meetingButtons, type ColleagueRow } from "@/lib/colleagues";
import { sendToColleague } from "@/lib/botDelivery";
import { buildManagerBrief, composeManagerBrief, managerBriefIsEmpty } from "@/lib/managerBrief";
import { personStats, composePeopleReview, composeMyWeek, buildParticipation } from "@/lib/peopleReview";
import { findAssignmentDrift } from "@/lib/assignmentDrift";
import { isSelfAssignee } from "@/lib/trackerRows";
import { onceOnly } from "@/lib/onceOnly";
import { findSilent, composeSilence } from "@/lib/silence";
import { setMaxCommands, setTelegramCommands } from "@/lib/botCommands";

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
  result?: string | null;
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
  // Вчерашние нужны для второго вопроса про итог — того, что не ответили
  // в тот же день.
  const yesterdayDate = new Date(now);
  yesterdayDate.setUTCDate(yesterdayDate.getUTCDate() - 1);
  const yesterday = dateStr(yesterdayDate);
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

  // Меню команд бота — раз в сутки, отсюда.
  //
  // Ставить его при выкладке негде: у бота нет «установки», а запускать
  // скрипт руками — это терминал на стороне Кирилла, то есть ровно то, чего
  // здесь не делают. Крон и так ходит каждые несколько минут; onceOnly
  // превращает это в одну попытку в день, а не выставилось — бот работает
  // как работал, и завтра попробует снова.
  await onceOnly(admin, { userId: userIds[0], kind: "bot_commands", refId: today, date: today }, async () => {
    await Promise.all([setTelegramCommands(), setMaxCommands()]);
  });

  // Накопившиеся события — одним письмом каждому, кому они адресованы.
  //
  // Это и есть ответ на «сплошняк»: десять сообщений подряд превращаются в
  // одну сводку, сгруппированную по смыслу, где сверху то, что требует
  // решения. Крон ходит каждые несколько минут, так что задержка меньше
  // той, за которую человек успевает дойти до телефона.
  //
  // Отправитель передаётся сюда, а не берётся внутри: очередь не должна
  // знать про мессенджеры, а botDelivery уже умеет адресовать письмо и
  // владельцу, и руководителю в его собственный чат. Без notice-аргумента
  // notifyAuthor работает как работал — то есть шлёт сразу.
  // Ночью очередь не разбирается вовсе.
  //
  // Тишина 22:00–8:00 — решение проекта, и до сих пор её приходилось
  // соблюдать каждому отправителю отдельно. С очередью это стало простым:
  // не разбирать. Ничего не теряется — накопившееся выйдет в восемь утра
  // одним письмом, то есть ровно так, как его и стоит читать. Разбудить
  // человека сообщением «Никита принял задачу» — вернейший способ научить
  // его выключать уведомления совсем.
  // nowMin, а не isQuietHour(now): `now` здесь уже сдвинут в московское
  // время (moscowNow), а isQuietHour сдвинул бы его второй раз и промахнулся
  // ровно на три часа. Тот же порог, посчитанный из уже готовых минут.
  const quiet = nowMin >= 22 * 60 || nowMin < BRIEF_FROM_MINUTES;
  if (!quiet) {
    await flushNotices(admin, (userId, toUser, text) => notifyAuthor(admin, userId, toUser, text));
  }

  for (const userId of userIds) {

    // The morning briefing replaces what used to be a line-per-task dump:
    // one note saying what actually matters today and why. Sent once a day,
    // on a working day, and not before BRIEF_FROM_MINUTES — a list of tasks
    // arriving at 00:05 (whenever the pinger first ran after midnight) was
    // no use to anybody.
    if (workingDay && nowMin >= BRIEF_FROM_MINUTES) {
      await onceOnly(admin, { userId, kind: "daily_brief", refId: today, date: today }, async () => {
        const facts = await buildBriefFacts(admin, userId);
        let text = briefIsEmpty(facts) ? "" : await composeBrief(facts);

        // То, что ждёт решения самого владельца. Сводка до сих пор
        // рассказывала только про чужую работу, а собственная очередь —
        // задачи, где все отчитались и ждут приёмки — не попадала в неё
        // вовсе. Дописывается кодом после модели: цифра и список имён
        // не должны зависеть от того, как их перескажут.
        const { data: waiting } = await admin
          .from("tasks")
          .select("title")
          .eq("user_id", userId)
          .eq("approval_state", "awaiting_review")
          .is("deleted_at", null)
          .limit(10);
        const onReview = ((waiting || []) as { title: string }[]).map((t) => t.title);
        if (onReview.length) {
          text =
            (text ? text + "\n\n" : "") +
            `🔍 Ждут вашей приёмки (${onReview.length}):\n` +
            onReview.slice(0, 5).map((t) => `• ${t}`).join("\n");
        }

        // Кто молчит. Просроченное сводка показывает давно, но просрочка —
        // это про дату, а здесь про человека: задачу выдали, и по ней не
        // нажали ничего. Такая задача выглядит живой ровно до срока, а
        // потом оказывается, что её никто и не начинал. Считается кодом:
        // имена и сроки модели не отдаются.
        const silent = await findSilent(admin, userId, now);
        if (silent.length) text = (text ? text + "\n\n" : "") + composeSilence(silent);

        // Обсуждения, в которых со вчера что-то писали. Каждое сообщение
        // отдельным уведомлением превратило бы мессенджер в ленту, а
        // одной строкой утром это ровно то, чем оно и является:
        // «есть что почитать вот здесь».
        //
        // Считаются и те сообщения, что написаны в самом трекере. Раньше
        // стояло `author_user_id is null`, то есть «только из мессенджера»,
        // и руководитель, ответивший с экрана, для этой сводки молчал —
        // владелец не узнавал о его словах ни сразу, ни утром. Отсекается
        // ровно одно: собственные сообщения Кирилла, напоминать о которых
        // ему незачем.
        const since = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
        const { data: fresh } = await admin
          .from("item_comments")
          .select("item_id, item_kind, author_user_id")
          .eq("user_id", userId)
          .eq("item_kind", "task")
          .gt("created_at", since)
          .is("deleted_at", null)
          .eq("system", false);
        const discussed = [
          ...new Set(
            ((fresh || []) as { item_id: string; author_user_id: string | null }[])
              .filter((c) => c.author_user_id !== userId)
              .map((c) => c.item_id),
          ),
        ];
        if (discussed.length) {
          const { data: titles } = await admin.from("tasks").select("title").in("id", discussed.slice(0, 5));
          const names = ((titles || []) as { title: string }[]).map((t) => `• ${t.title}`);
          text =
            (text ? text + "\n\n" : "") +
            `💬 Писали в обсуждениях (${discussed.length}):\n` +
            names.join("\n");
        }

        if (text) await notifyOwner(admin, userId, text);
      });
    }

    // Утренняя сводка каждому руководителю — та же услуга, что владельцу,
    // только про его собственные дела. Идёт всем, кто подключён к
    // мессенджеру: человек, который в трекер не заходит, узнаёт о
    // просроченном там же, где отвечает на задачи.
    if (workingDay && nowMin >= BRIEF_FROM_MINUTES) {
      const { data: colleagues } = await admin
        .from("assignees")
        .select("id, name, telegram_chat_id, max_user_id")
        .eq("user_id", userId);

      for (const person of ((colleagues || []) as ColleagueRow[])) {
        const target = chatsFor(person)[0];
        if (!target) continue;
        await onceOnly(admin, { userId, kind: "manager_brief", refId: `${today}:${person.id}`, date: today }, async () => {
          const facts = await buildManagerBrief(admin, userId, person, today);
          if (!managerBriefIsEmpty(facts)) await sendToColleague(target, composeManagerBrief(facts));
        });
      }
    }

    // Понедельничная сводка по людям — единственное место, где видно не
    // «что просрочено», а «кто просрочил»: материал для разговора, а не для
    // ещё одного списка задач.
    if (workingDay && nowMin >= BRIEF_FROM_MINUTES && now.getUTCDay() === 1) {
      // Считается один раз на обе сводки — владельцу про людей и каждому
      // про себя. Не ради экономии запроса: цифры обязаны сойтись, а две
      // выборки в разные секунды уже могут разойтись, и первый же разговор
      // «у меня написано другое» стоил бы дороже всей затеи.
      const participation = await buildParticipation(admin, userId);
      const stats = personStats(participation, now);

      await onceOnly(admin, { userId, kind: "people_review", refId: today, date: today }, async () => {
        let text = composePeopleReview(stats);

        // Встречи, у которых так и не появилось итога. Спрашивать про
        // каждую в третий раз бессмысленно — а одной строкой раз в неделю
        // видно, что переговоры проходят, а решений после них не остаётся.
        const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
        const { data: noRecap } = await admin
          .from("meetings")
          .select("title, date, result")
          .eq("user_id", userId)
          .eq("status", "planned")
          .lt("date", dateStr(threeDaysAgo))
          .is("deleted_at", null);
        const forgotten = ((noRecap || []) as { title: string; date: string }[]).filter(
          (m) => !(m as { result?: string }).result,
        );
        if (forgotten.length) {
          const list = forgotten.slice(0, 5).map((m) => `• ${m.title} (${m.date.split("-").reverse().join(".")})`);
          text = (text ? text + "\n\n" : "📊 Неделя по людям\n\n") + "Встречи без итога:\n" + list.join("\n");
        }

        // Задачи, которые выглядят назначенными и не назначены. Три места
        // создавали задачи, и два из них строк участия не заводили —
        // причины починены, но появится четвёртое, и узнать об этом лучше
        // здесь, чем через неделю вопросом «почему он ничего не сделал».
        const drift = await findAssignmentDrift(admin, userId);
        if (drift.length) {
          const list = drift.slice(0, 5).map((d) => `• ${d.title} — ${d.assignee}`);
          text =
            (text ? text + "\n\n" : "📊 Неделя по людям\n\n") +
            `⚠ Стоит имя, но задача не назначена (${drift.length}) — человек её не видит:\n` +
            list.join("\n");
        }

        if (text) await notifyOwner(admin, userId, text);
      });

      // G4: та же цифра, но человеку про него самого. Решение записано в
      // docs/multiuser.md одной фразой — «цифра о себе меняет поведение
      // дешевле любого разговора», — и считается она той же функцией, что
      // сводка выше. Показывать человеку одно, а начальнику про него
      // другое было бы началом недоверия.
      const { data: forStats } = await admin
        .from("assignees")
        .select("id, name, telegram_chat_id, max_user_id")
        .eq("user_id", userId);
      for (const person of ((forStats || []) as ColleagueRow[])) {
        const target = chatsFor(person)[0];
        if (!target || isSelfAssignee(person.name)) continue;
        await onceOnly(admin, { userId, kind: "my_week", refId: `${today}:${person.id}`, date: today }, async () => {
          const mine = stats.find((s) => s.name === person.name);
          const text = mine ? composeMyWeek(mine) : "";
          if (text) await sendToColleague(target, text);
        });
      }
    }

    // Weekly review — Mondays, same time window, once a week.
    if (workingDay && nowMin >= BRIEF_FROM_MINUTES && now.getUTCDay() === 1) {
      await onceOnly(admin, { userId, kind: "weekly_review", refId: today, date: today }, async () => {
        const facts = await buildWeeklyFacts(admin, userId);
        if (!weeklyIsEmpty(facts)) await notifyOwner(admin, userId, await composeWeekly(facts));
      });
    }

    // Сегодняшние и завтрашние: за сутки напоминают именно накануне.
    const { data: meetings } = await admin
      .from("meetings")
      .select("id,title,date,time,participants,status,vote_round,result")
      .eq("user_id", userId)
      .in("date", [yesterday, today, tomorrow])
      .is("deleted_at", null);

    for (const m of (meetings || []) as MeetingRow[]) {
      if (m.status !== "planned" || !m.time) continue;
      const [hh, mm] = m.time.split(":").map(Number);
      if (Number.isNaN(hh) || Number.isNaN(mm)) continue;

      const startMinutes = hh * 60 + mm;

      // Итог встречи (C4): спрашивают у того, кто её собрал. Через два часа
      // после начала, и ещё раз на следующее утро, если так и не ответили.
      // Дальше не дёргают — встреча без итога попадёт в понедельничную
      // сводку, и это уже другой разговор.
      if (!m.result) {
        const recap = recapDue(m.date, startMinutes, today, yesterday, nowMin, BRIEF_FROM_MINUTES);
        if (recap) {
          const { error: recapTaken } = await admin
            .from("telegram_notifications")
            .insert({ user_id: userId, kind: recap, ref_id: m.id, notif_date: today });
          if (!recapTaken) {
            const whenPast = `${m.date.split("-").reverse().join(".")}, ${m.time}`;
            await notifyOwner(admin, userId, recapAsk(recap, m.title, whenPast));
          }
        }
      }

      const window = dueReminder(minutesUntil(m.date, startMinutes, today, nowMin));
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
      // И отдельно — тем, кто отказался, не сказав почему. Причину
      // спрашивают вместе с ранними напоминаниями (за сутки и за два часа):
      // позже она уже ничего не меняет, а до тех пор организатор может и
      // перенести встречу, если причина того стоит.
      const silentRefusals = window.audience === "unanswered" ? awaitingReason(votes, round) : [];
      const everyone = [...new Set([...wanted, ...silentRefusals])];
      if (!everyone.length) continue;

      const { data: people } = await admin
        .from("assignees")
        .select("id, name, telegram_chat_id, max_user_id")
        .eq("user_id", userId)
        .in("name", everyone);

      for (const person of (people || []) as ColleagueRow[]) {
        const target = chatsFor(person)[0];
        if (!target) continue;
        const needsReason = silentRefusals.includes(person.name);
        // Дедупликация по человеку, а не по встрече: иначе первый же
        // отправленный участник закроет окно для всех остальных. Вопрос про
        // причину — свой ключ: это другое сообщение и другой повод.
        const { error } = await admin.from("telegram_notifications").insert({
          user_id: userId,
          kind: window.kind,
          ref_id: `${m.id}:${person.id}${needsReason ? ":why" : ""}`,
          notif_date: today,
        });
        if (error) continue;
        await sendToColleague(
          target,
          needsReason ? reasonNudge(m.title, when) : participantReminder(window.kind, m.title, when, window.audience),
          // Молчащему кнопки нужны: напоминание без них — это просьба
          // ответить куда-то не сюда. Отказавшемуся они уже не нужны: от
          // него ждут не нажатия, а одной строки текста.
          !needsReason && window.audience === "unanswered" ? meetingButtons(m.id) : undefined,
        );
      }
    }
  }

  return NextResponse.json({ ok: true, checked: userIds.length });
}
