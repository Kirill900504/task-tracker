import type { SupabaseClient } from "@supabase/supabase-js";
import type { BotButton } from "@/lib/botTransport";
import { encodeCallback, type ColleagueRow } from "@/lib/colleagues";
import { sendToPerson } from "@/lib/reach";
import { recordEvent } from "@/lib/itemHistory";
import { busyOnServer } from "@/lib/meetingBusyServer";
import { cleanSlots, isPoll, rankSlots, slotLabel, type SlotOption } from "@/lib/meetingPollRules";

export { cleanSlots, isPoll, rankSlots, slotLabel, type SlotOption };

// Опрос времени встречи (миграция 0062) — одно правило на трекер и бота.
//
// Предложение 9 от 13.10.2026, одобрено 14.10.2026: «организатор
// предлагает два-три слота, участники отмечают удобные, встреча
// назначается на лучший сама». Встреча-опрос — предложенная встреча с
// вариантами; голос — какие варианты подходят человеку. Когда отметили
// все, кого позвали, выбирается вариант с наибольшим числом голосов (при
// равенстве — более ранний) и СВОБОДНЫЙ у всех позванных: правило «две
// встречи на одно время с одним человеком — запрет» действует и здесь
// (busyOnServer — та же проверка, что у всех дверей, которыми встреча
// получает время).

// Кнопки опроса в мессенджере: вариант — кнопкой, отмеченный — с галочкой.
export function pollButtons(meetingId: string, options: SlotOption[], mine: number[]): BotButton[][] {
  return [
    ...options.map((o, i) => [
      { text: (mine.includes(i) ? "✅ " : "▫️ ") + slotLabel(o), data: encodeCallback("meeting", "slot", `${meetingId}.${i}`) },
    ]),
    [{ text: "👥 Кто идёт", data: encodeCallback("meeting", "who", meetingId) }],
  ];
}

type MeetingRow = {
  id: string;
  title: string;
  user_id: string;
  status: string;
  created_by: string | null;
  duration_min: number | null;
  participants: string[] | null;
  slot_options: SlotOption[] | null;
};

async function loadMeeting(admin: SupabaseClient, meetingId: string): Promise<MeetingRow | null> {
  const { data } = await admin
    .from("meetings")
    .select("id, title, user_id, status, created_by, duration_min, participants, slot_options")
    .eq("id", meetingId)
    .is("deleted_at", null)
    .maybeSingle();
  return (data as MeetingRow | null) || null;
}


// Записать, какие варианты подходят человеку, и, если ответили все,
// назначить встречу. Возвращает, назначена ли она и на что.
export async function recordSlotVote(
  admin: SupabaseClient,
  meetingId: string,
  assigneeId: string,
  slots: number[],
): Promise<{ ok: true; scheduled?: string; slots: number[] } | { ok: false; error: string }> {
  const meeting = await loadMeeting(admin, meetingId);
  if (!meeting || !isPoll(meeting)) return { ok: false, error: "Опрос по этой встрече уже закрыт" };
  const options = meeting.slot_options || [];
  const clean = cleanSlots(slots, options.length);
  const { data: part } = await admin.from("meeting_participants").select("id").eq("meeting_id", meetingId).eq("assignee_id", assigneeId).maybeSingle();
  if (!part) return { ok: false, error: "Вас нет среди участников этой встречи" };
  const { error } = await admin
    .from("meeting_slot_votes")
    .upsert({ meeting_id: meetingId, assignee_id: assigneeId, slots: clean, updated_at: new Date().toISOString() }, { onConflict: "meeting_id,assignee_id" });
  if (error) return { ok: false, error: "Голос не записался: " + error.message };
  const scheduled = await scheduleIfEveryoneVoted(admin, meeting);
  return { ok: true, slots: clean, ...(scheduled ? { scheduled } : {}) };
}

async function scheduleIfEveryoneVoted(admin: SupabaseClient, meeting: MeetingRow): Promise<string | null> {
  const options = meeting.slot_options || [];
  const [{ data: parts }, { data: votes }] = await Promise.all([
    admin.from("meeting_participants").select("assignee_id, role").eq("meeting_id", meeting.id),
    admin.from("meeting_slot_votes").select("assignee_id, slots").eq("meeting_id", meeting.id),
  ]);
  // Ждём ответа от тех, кого позвали; наблюдатель встречи голоса не
  // обязан давать (то же правило, что у «буду», lib/meetingVotes.mustVote).
  const expected = ((parts || []) as { assignee_id: string; role: string | null }[]).filter((p) => p.role !== "watcher").map((p) => p.assignee_id);
  const given = new Map(((votes || []) as { assignee_id: string; slots: number[] }[]).map((v) => [v.assignee_id, v.slots || []]));
  if (!expected.length || expected.some((id) => !given.has(id))) return null;
  for (const i of rankSlots(options, [...given.values()])) {
    // Вариант, который не подошёл никому, не назначается: назначать встречу,
    // на которую никто не может, — хуже, чем спросить организатора.
    if (![...given.values()].some((v) => v.includes(i))) break;
    const busy = await busyOnServer(admin, {
      spaceId: meeting.user_id,
      date: options[i].date,
      time: options[i].time,
      durationMin: meeting.duration_min,
      people: meeting.participants || [],
      ignore: [meeting.id],
    }).catch(() => ["?"]);
    if (busy.length) continue;
    await applySlot(admin, meeting, i, "по ответам участников");
    return slotLabel(options[i]);
  }
  return null;
}

// Назначить встречу на вариант — по ответам (сам) или решением организатора.
export async function applySlot(admin: SupabaseClient, meeting: MeetingRow, index: number, why: string): Promise<{ ok: boolean; error?: string }> {
  const opt = (meeting.slot_options || [])[index];
  if (!opt) return { ok: false, error: "Такого варианта нет" };
  const { error } = await admin
    .from("meetings")
    .update({ date: opt.date, time: opt.time, status: "planned", slot_options: [] })
    .eq("id", meeting.id)
    .eq("status", "proposed");
  if (error) return { ok: false, error: error.message };
  const when = slotLabel(opt);
  await recordEvent(admin, { userId: meeting.user_id, kind: "meeting", itemId: meeting.id, text: `✅ Встреча назначена на ${when} — ${why}` });
  const { data: parts } = await admin.from("meeting_participants").select("assignee_id").eq("meeting_id", meeting.id);
  const ids = ((parts || []) as { assignee_id: string }[]).map((p) => p.assignee_id);
  if (ids.length) {
    const { data: people } = await admin.from("assignees").select("id, name, telegram_chat_id, max_user_id").in("id", ids);
    const text = `✅ Встреча назначена: «${meeting.title}»\n${when}\n\nВремя выбрано ${why}.`;
    await Promise.all(
      ((people || []) as ColleagueRow[]).map((person) => sendToPerson(admin, meeting.user_id, person, text, undefined, { kind: "meeting", itemId: meeting.id })),
    );
  }
  return { ok: true };
}

// Организатор назначает сам, не дожидаясь всех.
export async function chooseSlot(
  admin: SupabaseClient,
  meetingId: string,
  index: number,
  byUserId: string,
): Promise<{ ok: boolean; error?: string }> {
  const meeting = await loadMeeting(admin, meetingId);
  if (!meeting || !isPoll(meeting)) return { ok: false, error: "Опрос по этой встрече уже закрыт" };
  if ((meeting.created_by || meeting.user_id) !== byUserId) return { ok: false, error: "Назначает тот, кто собрал встречу" };
  const opt = (meeting.slot_options || [])[index];
  if (!opt) return { ok: false, error: "Такого варианта нет" };
  const busy = await busyOnServer(admin, {
    spaceId: meeting.user_id,
    date: opt.date,
    time: opt.time,
    durationMin: meeting.duration_min,
    people: meeting.participants || [],
    ignore: [meeting.id],
  });
  if (busy.length) return { ok: false, error: `В это время уже на другой встрече: ${busy.join(", ")}` };
  return applySlot(admin, meeting, index, "организатором");
}
