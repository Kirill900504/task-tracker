import type { SupabaseClient } from "@supabase/supabase-js";
import { meetingButtons, type ColleagueRow } from "@/lib/colleagues";
import { sendToPerson } from "@/lib/reach";
import { recordEvent } from "@/lib/itemHistory";
import { fmtDate } from "@/lib/taskDisplay";
import { voteTally, type MeetingVote } from "@/lib/meetingVotes";

// Предложение, на которое согласились все, становится встречей само.
//
// Четвёртое состояние `proposed` завели для честного правила: назначить
// встречу — значит занять чужое время, и человек, собирающий других,
// сперва спрашивает. Но правило было записано наполовину: предложенная
// встреча не переходила в назначенную НИКОГДА, кроме как кнопкой
// владельца. То есть Макаров, позвавший Есину и Мамакову, получал два
// «буду» — и встречи всё равно не было: она висела предложением, время в
// календаре не занимала, напоминаний не рассылала.
//
// Вопрос Кирилла 20.09.2026: «а если Макаров хочет организовать встречу с
// Есиной и Мамаковой? он что не может назначить? тогда предлагает, и если
// все согласились, встреча состоится?». Да — вот здесь это и происходит.
//
// Чего здесь НЕТ намеренно: отмены по отказу. «Не смогу» от одного не
// удаляет встречу и не отменяет её: остальные уже спланировали под неё
// день, а решение — переносить или собираться без него — принимает тот,
// кто собирал. Бот говорит ему об отказе сразу, и это ровно тот момент,
// когда решение принимается человеком, а не правилом.

export type ConfirmResult = { confirmed: boolean; title?: string };

// Позвать после КАЖДОГО ответа на встречу — из трекера и из мессенджера.
// Дешёвая проверка: строки голосов всё равно только что читались, а
// пропущенный вызов означает встречу, которой все сказали «да» и которой
// нет.
export async function confirmIfEveryoneAgreed(admin: SupabaseClient, meetingId: string): Promise<ConfirmResult> {
  const { data: row } = await admin
    .from("meetings")
    .select("id, title, date, time, user_id, status, vote_round")
    .eq("id", meetingId)
    .is("deleted_at", null)
    .maybeSingle();
  const meeting = row as
    | { id: string; title: string; date: string; time: string | null; user_id: string; status: string; vote_round: number | null }
    | null;
  // Только предложенная: назначенную подтверждать нечем, а закрытую —
  // незачем.
  if (!meeting || meeting.status !== "proposed") return { confirmed: false };

  const { data: rows } = await admin
    .from("meeting_participants")
    .select("assignee_id, response, late, reason, round, role, assignees(name)")
    .eq("meeting_id", meetingId);

  type Row = {
    assignee_id: string;
    response: "none" | "yes" | "no";
    late: boolean | null;
    reason: string | null;
    round: number;
    role?: string | null;
    assignees: { name: string } | { name: string }[] | null;
  };
  const votes: MeetingVote[] = ((rows || []) as Row[]).map((r) => ({
    assigneeId: r.assignee_id,
    name: (Array.isArray(r.assignees) ? r.assignees[0]?.name : r.assignees?.name) || "",
    response: r.response,
    late: !!r.late,
    reason: r.reason || "",
    round: r.round,
    role: (r.role as MeetingVote["role"]) || undefined,
  }));

  const tally = voteTally(votes, Number(meeting.vote_round ?? 1) || 1);
  // Никого не позвали — подтверждать нечего: встреча с одним человеком не
  // ждёт ничьего согласия и назначается сразу при создании.
  if (!tally.expected) return { confirmed: false };
  // Хоть один молчит или отказался — это ещё не согласие. Опоздание
  // согласием считается: человек придёт, просто позже (см. voteTally).
  if (tally.pending.length || tally.no.length) return { confirmed: false };

  const { error } = await admin.from("meetings").update({ status: "planned" }).eq("id", meetingId);
  if (error) return { confirmed: false };

  const when = fmtDate(meeting.date) + (meeting.time ? ", " + meeting.time : "");
  await recordEvent(admin, {
    userId: meeting.user_id,
    kind: "meeting",
    itemId: meetingId,
    text: `✅ Все согласились — встреча назначена на ${when}`,
  });

  // Сказать надо всем, кого это касается: до этой минуты у них в календаре
  // ничего не стояло, а теперь стоит.
  const ids = ((rows || []) as Row[]).map((r) => r.assignee_id);
  if (ids.length) {
    const { data: people } = await admin.from("assignees").select("id, name, telegram_chat_id, max_user_id").in("id", ids);
    const text = `✅ Встреча назначена: «${meeting.title}»\n${when}\n\nВсе ответили «буду».`;
    for (const person of ((people || []) as ColleagueRow[])) {
      await sendToPerson(admin, meeting.user_id, person, text, meetingButtons(meetingId));
    }
  }

  return { confirmed: true, title: meeting.title };
}

