import type { SupabaseClient } from "@supabase/supabase-js";
import { recordEvent } from "@/lib/itemHistory";
import { actorName } from "@/lib/actorName";
import { fmtDate } from "@/lib/taskDisplay";
import { mirrorClosed } from "@/lib/botMirror";
import { sendToPerson } from "@/lib/reach";
import { meetingButtons, type ColleagueRow } from "@/lib/colleagues";
import { isSelfAssignee } from "@/lib/trackerRows";
import { busyOnServer } from "@/lib/meetingBusyServer";
import { dateStr, minutesOfDay, moscowNow } from "@/lib/taskLogic";
import { withoutSelfMark } from "@/lib/actorName";
import { taskRef } from "@/lib/taskRef";
import { uid } from "@/lib/uid";

// Перенос встречи и срока задачи — с сервера, то есть из мессенджера.
//
// Перенос встречи в трекере — это не правка даты, а НОВАЯ встреча на новое
// время и прежняя, закрытая как перенесённая (MeetingsPanel.closeAsMoved):
// по старой уже проголосовали, о ней уже сказали людям, и тихая смена даты
// развела бы то, что люди видели, и то, что записано. Массовый перенос в
// боте (bulkActions) этого правила не знал и просто менял `date` — поэтому
// одиночный перенос, появившийся 20.10.2026 («простая просьба о переносе
// конкретной встречи так и не решилась»), идёт через эту функцию, а не
// через ту. Правило одно на обе двери: трекер и бот.

export type MeetingToMove = {
  id: string;
  title: string;
  date: string;
  time: string | null;
  user_id: string;
  created_by: string | null;
  participants: string[] | null;
  duration_min: number | null;
  recur: string | null;
  from_task_id: string | null;
  status: string | null;
  result: string | null;
};

export const MEETING_MOVE_COLUMNS = "id, title, date, time, user_id, created_by, participants, duration_min, recur, from_task_id, status, result";

// Можно ли ставить встречу на это время: не в прошлом. Сегодняшний день
// годится, только если час ещё не прошёл.
export function inPast(date: string, time: string, now = moscowNow()): boolean {
  const today = dateStr(now);
  if (date < today) return true;
  if (date > today || !time) return false;
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m <= minutesOfDay(now);
}

export async function moveMeeting(
  admin: SupabaseClient,
  meeting: MeetingToMove,
  target: { date: string; time: string },
  // Кто переносит — его auth-id (у владельца это id пространства). Права
  // проверяет вызывающий: встречу ему отдала выборка по автору.
  actorUserId: string,
): Promise<{ ok: true; newId: string; text: string } | { ok: false; error: string }> {
  if (meeting.status === "success" || meeting.status === "no_result") return { ok: false, error: `Встреча «${meeting.title}» уже закрыта — переносить нечего.` };
  const date = target.date;
  const time = target.time || meeting.time || "";
  if (!date) return { ok: false, error: "Не назван день." };
  if (date === meeting.date && time === (meeting.time || "")) return { ok: false, error: "Это то же самое время — переносить нечего." };
  if (inPast(date, time)) return { ok: false, error: `${fmtDate(date)}${time ? ", " + time : ""} уже прошло — назовите время впереди.` };

  const people = (meeting.participants || []).filter(Boolean);
  // Две встречи на одно время с одним человеком запрещены и здесь
  // (lib/meetingTime) — переносимая сама себе время не занимает.
  let clash: string[];
  try {
    clash = await busyOnServer(admin, { spaceId: meeting.user_id, date, time, durationMin: meeting.duration_min ?? 30, people, ignore: [meeting.id] });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  if (clash.length) {
    return { ok: false, error: `${fmtDate(date)}, ${time} уже занято другой встречей: ${clash.map(withoutSelfMark).join(", ")}. Выберите другое время.` };
  }

  const newId = uid();
  // Строки участия для новой встречи заведёт триггер 0024 по именам в
  // `participants` — второй вставкой их не дублируем (правило upsert'а в
  // CLAUDE.md: пачка падает целиком из-за одной строки).
  const { error: insertError } = await admin.from("meetings").insert({
    id: newId,
    user_id: meeting.user_id,
    created_by: meeting.created_by,
    date,
    time,
    title: meeting.title,
    participants: people,
    status: "planned",
    result: "",
    duration_min: meeting.duration_min ?? 30,
    recur: meeting.recur || "none",
    from_task_id: meeting.from_task_id,
    slot_options: [],
  });
  if (insertError) return { ok: false, error: "Не получилось завести встречу на новое время: " + insertError.message };

  const { error: closeError } = await admin
    .from("meetings")
    .update({
      status: "no_result",
      result: (meeting.result || "").trim() || "Перенесено на следующий этап",
      moved_to_date: date,
      resolved_at: new Date().toISOString(),
    })
    .eq("id", meeting.id);
  if (closeError) {
    // Без закрытия прежней получились бы две встречи — новую убираем.
    await admin.from("meetings").update({ deleted_at: new Date().toISOString() }).eq("id", newId);
    return { ok: false, error: "Не получилось закрыть прежнюю встречу: " + closeError.message };
  }

  const who = await actorName(admin, meeting.user_id, actorUserId);
  const wasAt = fmtDate(meeting.date) + (meeting.time ? ", " + meeting.time : "");
  const nowAt = fmtDate(date) + (time ? ", " + time : "");
  await Promise.all([
    recordEvent(admin, { actorUserId, userId: meeting.user_id, kind: "meeting", itemId: meeting.id, text: `📅 ${who} перенёс встречу на ${nowAt}` }),
    recordEvent(admin, { actorUserId, userId: meeting.user_id, kind: "meeting", itemId: newId, text: `📅 Перенесена с ${wasAt}` }),
  ]);
  await mirrorClosed(admin, "meeting", meeting.id, `📅 ${meeting.title}\n${wasAt}\n\n➡ Встреча перенесена на ${nowAt} — приглашение на новое время в сообщении ниже.`);
  const sent = await announceMeetingMove(
    admin,
    actorUserId,
    { id: newId, user_id: meeting.user_id },
    `📅 ${who} перенёс встречу\n\n${meeting.title}\n\nБыло: ${wasAt}\nСтало: ${nowAt}`,
  );
  return {
    ok: true,
    newId,
    text: `✅ Встреча «${meeting.title}» перенесена.\nБыло: ${wasAt}\nСтало: ${nowAt}` + (sent ? `\nУчастникам сообщил: ${sent}.` : ""),
  };
}

// Каждому, кого ждут на новом времени, — отдельное сообщение о ПЕРЕНОСЕ, с
// кнопками ответа уже по новой встрече.
//
// Слова Кирилла 07.10.2026: «если постановщик встречи сам переносит
// назначенную собой встречу, всем участникам обязательно должно прилетать
// уведомление, чтобы они оперативно видели и реагировали (в том числе в
// мессенджерах)». До этого перенос доходил до людей как обычное
// приглашение «📅 Встреча от …» — то есть читался как ВТОРАЯ встреча, а
// прежнее приглашение молча переписывалось, без звука. Поэтому приглашения
// при переносе нет вовсе, и это сообщение — единственное: в нём и было, и
// стало, и «Буду / Не смогу». Зовут его обе двери переноса: трекер
// (/api/workspace/meeting-moved) и бот (moveMeeting выше).
export async function announceMeetingMove(
  admin: SupabaseClient,
  actorId: string,
  meeting: { id: string; user_id: string },
  text: string,
): Promise<number> {
  // Состав — из обоих мест сразу: строки участия вкладка заводит в ту же
  // секунду, что и встречу, и к этой минуте они могут ещё ехать; имена в
  // самой строке встречи приезжают вместе с ней.
  const [{ data: row }, { data: parts }, { data: member }] = await Promise.all([
    admin.from("meetings").select("participants").eq("id", meeting.id).maybeSingle(),
    admin.from("meeting_participants").select("assignee_id").eq("meeting_id", meeting.id),
    admin.from("workspace_members").select("assignee_id").eq("member_id", actorId).eq("status", "active").maybeSingle(),
  ]);
  const names = (((row as { participants?: string[] | null } | null)?.participants) || []).filter(Boolean);
  const ids = ((parts || []) as { assignee_id: string }[]).map((p) => p.assignee_id);
  if (!names.length && !ids.length) return 0;
  const { data: people } = await admin
    .from("assignees")
    .select("id, name, telegram_chat_id, max_user_id, messenger")
    .eq("user_id", meeting.user_id)
    .or([ids.length ? `id.in.(${ids.join(",")})` : "", names.length ? `name.in.(${names.map((n) => `"${n.replace(/"/g, '\\"')}"`).join(",")})` : ""].filter(Boolean).join(","));
  // Себе не пишут — и «я» здесь тот, кто переносит, а не владелец
  // пространства (правило из CLAUDE.md про lib/reach): у руководителя это
  // его строка членства, у владельца — строка «(я)».
  const myAssignee = (member as { assignee_id: string | null } | null)?.assignee_id || "";
  const audience = ((people || []) as ColleagueRow[]).filter(
    (p) => p.id !== myAssignee && !(actorId === meeting.user_id && isSelfAssignee(p.name || "")),
  );
  const delivered = await Promise.all(
    audience.map((person) => sendToPerson(admin, meeting.user_id, person, text, meetingButtons(meeting.id), { kind: "meeting", itemId: meeting.id })),
  );
  return delivered.filter(Boolean).length;
}

// Срок задачи — колонка движка синхронизации, но правка с сервера та же,
// что у кнопки «Продлить срок»: дата, строка в хронике и слово исполнителям
// (CLAUDE.md, «Перенос срока — событие, а не тихая правка»).
export async function moveTaskDeadline(
  admin: SupabaseClient,
  task: { id: string; title: string; number?: number | null; deadline: string | null; user_id: string },
  date: string,
  actorUserId: string,
): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  if (!date) return { ok: false, error: "Не назван день." };
  if (date === task.deadline) return { ok: false, error: `Срок и так ${fmtDate(date)}.` };
  if (date < dateStr(moscowNow())) return { ok: false, error: `${fmtDate(date)} уже прошло — назовите день впереди.` };
  const { error } = await admin.from("tasks").update({ deadline: date }).eq("id", task.id);
  if (error) return { ok: false, error: "Не получилось сохранить срок: " + error.message };
  await recordEvent(admin, {
    actorUserId,
    userId: task.user_id,
    kind: "task",
    itemId: task.id,
    text: `📅 Срок ${task.deadline ? "перенесён с " + fmtDate(task.deadline) + " на " : "поставлен на "}${fmtDate(date)}`,
  });
  const { data: parts } = await admin
    .from("task_participants")
    .select("assignee_id, assignees(id, name, telegram_chat_id, max_user_id, messenger)")
    .eq("task_id", task.id)
    .in("role", ["executor", "coexecutor"]);
  const { data: member } = await admin.from("workspace_members").select("assignee_id").eq("member_id", actorUserId).eq("status", "active").maybeSingle();
  const mine = (member as { assignee_id: string | null } | null)?.assignee_id || "";
  type Part = { assignee_id: string; assignees: ColleagueRow | ColleagueRow[] | null };
  const people = ((parts || []) as Part[])
    .map((p) => (Array.isArray(p.assignees) ? p.assignees[0] : p.assignees))
    .filter((p): p is ColleagueRow => !!p && p.id !== mine && !(actorUserId === task.user_id && isSelfAssignee(p.name || "")));
  const text = `📅 Срок задачи ${taskRef(task)} перенесён на ${fmtDate(date)}.`;
  await Promise.all(people.map((person) => sendToPerson(admin, task.user_id, person, text)));
  return { ok: true, text: `📅 Срок ${taskRef(task)} — ${fmtDate(date)}.` + (people.length ? " Исполнителям сказано." : "") };
}
