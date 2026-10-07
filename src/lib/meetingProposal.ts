import type { SupabaseClient } from "@supabase/supabase-js";
import type { BotButton } from "@/lib/botTransport";
import { encodeCallback, meetingButtons, meetingMessage, type ColleagueRow } from "@/lib/colleagues";
import { isSelfAssignee } from "@/lib/trackerRows";
import { recordEvent } from "@/lib/itemHistory";
import { actorName, withoutSelfMark } from "@/lib/actorName";
import { fmtDate } from "@/lib/taskDisplay";
import { sendToPerson } from "@/lib/reach";
import { mirrorClosed } from "@/lib/botMirror";
import { uid } from "@/lib/uid";

// Предложение другого времени встречи — в мессенджере, теми же кнопками,
// что в трекере.
//
// 07.10.2026 участник уже мог предложить другое время репликой в
// обсуждении встречи (миграция 0044), а ответить «подходит / не подходит»
// и перенести встречу можно было только в трекере: в мессенджер приходил
// текст без единой кнопки. Кирилл: «давай сделаем». Теперь под
// предложением у участников — «👍 Подходит / 👎 Не подходит», у
// организатора — «📅 Перенести на это время».
//
// Голос — это та же реакция 👍 / 👎 на ту же реплику, что ставит кнопка в
// трекере: третья правда о том же («кто согласен») разошлась бы с первыми
// двумя. Кнопка несёт id реплики, а не встречи: предложений по одной
// встрече бывает несколько.

export type Proposal = { date: string; time: string };

export function proposalWhen(p: Proposal): string {
  return `${fmtDate(p.date)}, ${p.time}`;
}

export function proposalVoteButtons(commentId: string): BotButton[][] {
  return [
    [
      { text: "👍 Подходит", data: encodeCallback("meeting", "pyes", commentId) },
      { text: "👎 Не подходит", data: encodeCallback("meeting", "pno", commentId) },
    ],
  ];
}

export function proposalAcceptButtons(commentId: string): BotButton[][] {
  return [[{ text: "📅 Перенести на это время", data: encodeCallback("meeting", "pacc", commentId) }]];
}

type CommentRef = {
  id: string;
  item_kind: string;
  item_id: string;
  user_id: string;
  author_assignee_id: string | null;
  proposal: Proposal | null;
  body: string;
};

type MeetingRef = {
  id: string;
  title: string;
  date: string;
  time: string | null;
  user_id: string;
  created_by: string | null;
  participants: string[] | null;
  duration_min: number | null;
  status: string | null;
  from_task_id: string | null;
  deleted_at: string | null;
};

async function load(admin: SupabaseClient, commentId: string): Promise<{ comment: CommentRef; meeting: MeetingRef } | null> {
  const { data } = await admin
    .from("item_comments")
    .select("id, item_kind, item_id, user_id, author_assignee_id, proposal, body")
    .eq("id", commentId)
    .is("deleted_at", null)
    .maybeSingle();
  const comment = data as CommentRef | null;
  if (!comment || comment.item_kind !== "meeting" || !comment.proposal?.date) return null;
  const { data: m } = await admin
    .from("meetings")
    .select("id, title, date, time, user_id, created_by, participants, duration_min, status, from_task_id, deleted_at")
    .eq("id", comment.item_id)
    .maybeSingle();
  const meeting = m as MeetingRef | null;
  if (!meeting || meeting.deleted_at) return null;
  return { comment, meeting };
}

// Строка человека, который собрал встречу. У владельца created_by пуст, и
// его строка — та, что с пометкой «(я)».
export async function organizerRowId(admin: SupabaseClient, meeting: { user_id: string; created_by: string | null }): Promise<string | null> {
  if (meeting.created_by) {
    const { data } = await admin
      .from("workspace_members")
      .select("assignee_id")
      .eq("owner_id", meeting.user_id)
      .eq("member_id", meeting.created_by)
      .maybeSingle();
    return (data as { assignee_id?: string } | null)?.assignee_id ?? null;
  }
  const { data } = await admin.from("assignees").select("id, name").eq("user_id", meeting.user_id);
  return ((data || []) as { id: string; name: string }[]).find((r) => isSelfAssignee(r.name))?.id ?? null;
}

// Логин человека по его строке — чтобы голос из мессенджера трекер считал
// «моим» (реакция с actor_user_id). У получателя без входа логина нет, и
// голос остаётся его строкой.
async function loginOf(admin: SupabaseClient, spaceId: string, person: { id: string; name: string }): Promise<string | null> {
  if (isSelfAssignee(person.name)) return spaceId;
  const { data } = await admin
    .from("workspace_members")
    .select("member_id")
    .eq("owner_id", spaceId)
    .eq("assignee_id", person.id)
    .maybeSingle();
  return (data as { member_id?: string } | null)?.member_id ?? null;
}

export type ProposalOutcome = { toast: string; rewriteTo?: string; rewriteButtons?: BotButton[][] };

// «Подходит / не подходит» — один из двух, и повторное нажатие того же
// снимает голос, как и в трекере.
export async function voteOnProposal(
  admin: SupabaseClient,
  person: { id: string; name: string; user_id: string },
  commentId: string,
  agree: boolean,
): Promise<ProposalOutcome> {
  const found = await load(admin, commentId);
  if (!found || found.meeting.user_id !== person.user_id) return { toast: "Это предложение уже неактуально" };
  const { comment, meeting } = found;
  if (comment.author_assignee_id === person.id) return { toast: "Это ваше предложение — отвечают остальные" };
  const { data: part } = await admin
    .from("meeting_participants")
    .select("id")
    .eq("meeting_id", meeting.id)
    .eq("assignee_id", person.id)
    .maybeSingle();
  if (!part) return { toast: "Вас нет в этой встрече" };

  const emoji = agree ? "👍" : "👎";
  const other = agree ? "👎" : "👍";
  const { data: mine } = await admin
    .from("comment_reactions")
    .select("id, emoji")
    .eq("comment_id", commentId)
    .eq("actor_assignee_id", person.id)
    .in("emoji", ["👍", "👎"]);
  const rows = (mine || []) as { id: string; emoji: string }[];
  const already = rows.some((r) => r.emoji === emoji);
  const drop = rows.filter((r) => r.emoji === other || (already && r.emoji === emoji)).map((r) => r.id);
  if (drop.length) await admin.from("comment_reactions").delete().in("id", drop);
  if (!already) {
    await admin.from("comment_reactions").insert({
      comment_id: commentId,
      emoji,
      user_id: meeting.user_id,
      actor_assignee_id: person.id,
      actor_user_id: await loginOf(admin, meeting.user_id, person),
    });
  }

  const when = proposalWhen(comment.proposal!);
  const head = `🕐 Перенести «${meeting.title}» на ${when}?`;
  if (already) {
    return { toast: "Голос снят", rewriteTo: head, rewriteButtons: proposalVoteButtons(commentId) };
  }
  return {
    toast: agree ? "Отметил: подходит" : "Отметил: не подходит",
    rewriteTo: `${head}\n\n${agree ? "👍 Вы: подходит" : "👎 Вы: не подходит"}. Решает организатор.`,
    rewriteButtons: proposalVoteButtons(commentId),
  };
}

// Организатор принимает предложенное время — тем же переносом, что в
// трекере (MeetingsPanel.reschedule): НОВАЯ встреча с тем же составом,
// приглашения заново, прежняя закрывается как перенесённая, строки в
// обсуждении обеих, кнопки прежних приглашений снимаются.
export async function acceptProposal(
  admin: SupabaseClient,
  person: { id: string; name: string; user_id: string },
  commentId: string,
): Promise<ProposalOutcome> {
  const found = await load(admin, commentId);
  if (!found || found.meeting.user_id !== person.user_id) return { toast: "Это предложение уже неактуально" };
  const { comment, meeting } = found;
  if ((await organizerRowId(admin, meeting)) !== person.id) return { toast: "Переносит тот, кто назначил встречу" };
  if (meeting.status && meeting.status !== "planned" && meeting.status !== "proposed") {
    return { toast: "Встреча уже закрыта или перенесена" };
  }
  const p = comment.proposal!;
  // Прошлое не назначается и отсюда (07.10.2026): предложение могло
  // пролежать до тех пор, пока его время не прошло.
  const nowMsk = new Date(Date.now() + 3 * 3600_000).toISOString();
  if (`${p.date}T${p.time}` <= nowMsk.slice(0, 16)) {
    return { toast: "Это время уже прошло", rewriteTo: `🕐 Предложенное время (${proposalWhen(p)}) уже прошло.` };
  }

  const who = await actorName(admin, meeting.user_id, meeting.created_by || meeting.user_id);
  const authorRow = comment.author_assignee_id
    ? ((await admin.from("assignees").select("name").eq("id", comment.author_assignee_id).maybeSingle()).data as { name?: string } | null)
    : null;
  const by = withoutSelfMark(authorRow?.name || "") || "участник";
  const reason = (comment.body.split(" — ")[1] || "").split(".\n")[0].trim();
  const note = reason ? `По предложению: ${by} — ${reason}` : `По предложению: ${by}`;

  const newId = uid();
  const { error } = await admin.from("meetings").insert({
    id: newId,
    user_id: meeting.user_id,
    created_by: meeting.created_by,
    title: meeting.title,
    date: p.date,
    time: p.time,
    duration_min: meeting.duration_min || 30,
    participants: meeting.participants || [],
    status: "planned",
    result: "",
    from_task_id: meeting.from_task_id,
  });
  if (error) return { toast: "Не получилось перенести" };
  await admin
    .from("meetings")
    .update({ status: "no_result", result: note, moved_to_date: p.date, resolved_at: new Date().toISOString() })
    .eq("id", meeting.id);

  const wasAt = fmtDate(meeting.date) + (meeting.time ? ", " + meeting.time : "");
  const nowAt = proposalWhen(p);
  await Promise.all([
    recordEvent(admin, { userId: meeting.user_id, kind: "meeting", itemId: meeting.id, text: `📅 ${who} перенёс встречу на ${nowAt}: ${note}` }),
    recordEvent(admin, { userId: meeting.user_id, kind: "meeting", itemId: newId, text: `📅 Перенесена с ${wasAt}: ${note}` }),
  ]);

  // Приглашения на новое время — всем, кого звали. Строки участия завёл
  // триггер миграции 0024 вместе со вставкой встречи.
  const { data: parts } = await admin.from("meeting_participants").select("assignee_id").eq("meeting_id", newId);
  const ids = ((parts || []) as { assignee_id: string }[]).map((r) => r.assignee_id).filter((id) => id !== person.id);
  if (ids.length) {
    const { data: people } = await admin.from("assignees").select("id, name, telegram_chat_id, max_user_id").in("id", ids);
    const text = meetingMessage({ title: meeting.title, date: p.date, time: p.time, participants: meeting.participants || [] }, who);
    await Promise.all(
      ((people || []) as ColleagueRow[]).map((r) =>
        sendToPerson(admin, meeting.user_id, r, text, meetingButtons(newId), { kind: "meeting", itemId: newId }),
      ),
    );
  }
  await mirrorClosed(admin, "meeting", meeting.id, `📅 ${meeting.title}\n${wasAt}\n\n➡ Встреча перенесена на ${nowAt} — приглашение на новое время пришло отдельно.`);

  return { toast: "Встреча перенесена", rewriteTo: `📅 «${meeting.title}» перенесена на ${nowAt}.\nУчастники получили приглашение и ответят заново.` };
}
