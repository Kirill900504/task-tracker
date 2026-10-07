import type { SupabaseClient } from "@supabase/supabase-js";
import type { MeetingRecur } from "@/types/tracker";
import { uid } from "@/lib/uid";
import { attachMeetingParticipants } from "@/lib/assignExecutors";
import { meetingButtons, meetingMessage, type ColleagueRow } from "@/lib/colleagues";
import { sendToPerson } from "@/lib/reach";
import { actorName } from "@/lib/actorName";
import { isSelfAssignee } from "@/lib/trackerRows";
import { RECUR_LABELS } from "@/lib/meetingRepeatLabels";

// Регулярные встречи (миграция 0046): почему каждое повторение — отдельная
// встреча и почему следующую заводит крон, написано там.


function shift(iso: string, recur: MeetingRecur): string {
  const [y, m, d] = iso.split("-").map(Number);
  const at = new Date(Date.UTC(y, m - 1, d));
  if (recur === "weekly") at.setUTCDate(at.getUTCDate() + 7);
  else if (recur === "biweekly") at.setUTCDate(at.getUTCDate() + 14);
  else if (recur === "monthly") {
    // 31 января + месяц — это последнее число февраля, а не 3 марта:
    // планёрка «в конце месяца» не должна уползать в следующий.
    const want = at.getUTCDate();
    at.setUTCDate(1);
    at.setUTCMonth(at.getUTCMonth() + 1);
    const last = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + 1, 0)).getUTCDate();
    at.setUTCDate(Math.min(want, last));
  }
  return at.toISOString().slice(0, 10);
}

// Дата следующего повторения — строго позже сегодняшнего дня. Если крон
// несколько дней не работал, пропущенные повторения не заводятся задним
// числом: встреча в прошлом — это встреча, на которую уже никто не придёт.
export function nextOccurrence(date: string, recur: MeetingRecur, today: string): string | null {
  if (recur === "none") return null;
  let next = shift(date, recur);
  for (let i = 0; next <= today && i < 400; i++) next = shift(next, recur);
  return next;
}

// Порождает ли эта встреча следующую. Перенесённая (у неё стоит дата
// переноса) — нет: её место заняла новая встреча, которая несёт то же
// правило и породит следующую сама. Удалённая — нет: удалили, значит, и
// цепочку (её отсекает выборка). Предложенная — нет: она ещё не
// договорённость.
export function spawnsNext(
  m: { recur?: string | null; status?: string | null; recur_next_id?: string | null; moved_to_date?: string | null; date: string },
  today: string,
): boolean {
  if (!m.recur || m.recur === "none" || m.recur_next_id || m.moved_to_date) return false;
  if (!["planned", "success", "no_result"].includes(m.status || "planned")) return false;
  return m.date <= today;
}

type MeetingSeed = {
  id: string;
  user_id: string;
  created_by: string | null;
  title: string;
  date: string;
  time: string | null;
  duration_min: number | null;
  participants: string[] | null;
  recur: MeetingRecur;
  status: string | null;
  recur_next_id: string | null;
  moved_to_date: string | null;
};

// Из крона: завести следующие повторения и позвать людей. Возвращает,
// сколько встреч заведено.
export async function spawnRecurringMeetings(admin: SupabaseClient, today: string): Promise<number> {
  const { data } = await admin
    .from("meetings")
    .select("id, user_id, created_by, title, date, time, duration_min, participants, recur, status, recur_next_id, moved_to_date")
    .neq("recur", "none")
    .is("recur_next_id", null)
    .is("deleted_at", null)
    .lte("date", today);
  let made = 0;
  for (const m of (data || []) as MeetingSeed[]) {
    if (!spawnsNext(m, today)) continue;
    const date = nextOccurrence(m.date, m.recur, today);
    if (!date) continue;
    const id = uid();
    // Сперва занять: условный UPDATE пройдёт ровно у одного прогона.
    const { data: claimed } = await admin
      .from("meetings")
      .update({ recur_next_id: id })
      .eq("id", m.id)
      .is("recur_next_id", null)
      .select("id");
    if (!claimed?.length) continue;

    const participants = m.participants || [];
    const { error } = await admin.from("meetings").insert({
      id,
      user_id: m.user_id,
      // Организатор тот же: без этого повторение чужой планёрки стало бы
      // «владельцевой», и голоса, итог и перенос ушли бы не тому человеку.
      created_by: m.created_by,
      title: m.title,
      date,
      time: m.time || "",
      duration_min: m.duration_min,
      participants,
      status: "planned",
      result: "",
      recur: m.recur,
    });
    if (error) {
      // Не вышло — отпускаем, следующий прогон попробует снова.
      await admin.from("meetings").update({ recur_next_id: null }).eq("id", m.id);
      continue;
    }
    made++;
    await attachMeetingParticipants(admin, m.user_id, id, participants);
    await inviteToRepeat(admin, m, id, date);
  }
  return made;
}

async function inviteToRepeat(admin: SupabaseClient, m: MeetingSeed, id: string, date: string) {
  const names = (m.participants || []).filter(Boolean);
  if (!names.length) return;
  const { data } = await admin
    .from("assignees")
    .select("id, name, telegram_chat_id, max_user_id")
    .eq("user_id", m.user_id)
    .in("name", names);
  // Организатору приглашение на собственную планёрку не нужно.
  let organizerAssignee = "";
  if (m.created_by) {
    const { data: member } = await admin
      .from("workspace_members")
      .select("assignee_id")
      .eq("owner_id", m.user_id)
      .eq("member_id", m.created_by)
      .maybeSingle();
    organizerAssignee = (member?.assignee_id as string) || "";
  }
  const from = await actorName(admin, m.user_id, m.created_by || m.user_id, "Организатор");
  const text = meetingMessage({ title: m.title, date, time: m.time, participants: names }, from) + "\n\n🔁 " + RECUR_LABELS[m.recur].toLowerCase();
  const people = ((data || []) as ColleagueRow[]).filter((p) =>
    m.created_by ? p.id !== organizerAssignee : !isSelfAssignee(p.name),
  );
  await Promise.all(
    people.map((p) => sendToPerson(admin, m.user_id, p, text, meetingButtons(id), { kind: "meeting", itemId: id }).catch(() => 0)),
  );
}
