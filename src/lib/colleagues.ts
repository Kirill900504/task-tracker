import type { SupabaseClient } from "@supabase/supabase-js";
import type { BotButton, BotChannelConfig } from "@/lib/botTransport";
import { BOT_CHANNELS } from "@/lib/botTransport";
import { fmtDate } from "@/lib/taskDisplay";

// Sending an item to the person it is addressed to, and understanding what
// they press in reply.
//
// A colleague is a row in `assignees` with a messenger chat attached — not
// a user of the tracker. They never sign in, own nothing, and see only what
// is sent to them. Telegram or MAX makes no difference here: the same row
// can carry either, or both. Everything they are allowed to do is checked here against
// the item itself: the button carries an id, and the id has to belong to an
// item addressed to that very chat.

export type ColleagueRow = {
  id: string;
  name: string;
  telegram_chat_id: number | null;
  max_user_id: number | null;
};

export type SendKind = "task" | "meeting" | "idea";

// Кто это нажал и что именно — упаковано в данные кнопки, у которых
// Telegram ограничивает длину 64 байтами, поэтому только вид, действие и id.
export type CallbackAction = { kind: SendKind; action: string; id: string };

export function encodeCallback(kind: SendKind, action: string, id: string): string {
  return `${kind[0]}:${action}:${id}`;
}

export function decodeCallback(data: string): CallbackAction | null {
  const parts = String(data || "").split(":");
  if (parts.length !== 3) return null;
  const kindLetter = parts[0];
  const kind = kindLetter === "t" ? "task" : kindLetter === "m" ? "meeting" : kindLetter === "i" ? "idea" : null;
  if (!kind || !parts[1] || !parts[2]) return null;
  return { kind, action: parts[1], id: parts[2] };
}

export function taskMessage(task: { title: string; description?: string; deadline?: string | null; priority?: string }, from: string): string {
  const lines = [`📋 Задача от ${from}:`, "", task.title];
  if (task.description) lines.push("", task.description);
  const bits: string[] = [];
  if (task.deadline) bits.push("срок: " + fmtDate(task.deadline));
  if (task.priority === "high") bits.push("важно");
  if (bits.length) lines.push("", bits.join(" · "));
  return lines.join("\n");
}

export function meetingMessage(
  meeting: { title: string; date: string; time?: string | null; participants?: string[] },
  from: string,
): string {
  const lines = [`📅 Встреча от ${from}:`, "", meeting.title, "", fmtDate(meeting.date) + (meeting.time ? ", " + meeting.time : "")];
  const others = (meeting.participants || []).filter(Boolean);
  if (others.length > 1) lines.push("Участники: " + others.join(", "));
  return lines.join("\n");
}

export function ideaMessage(text: string, from: string): string {
  return `💡 Мысль от ${from}:\n\n${text}`;
}

export function taskButtons(taskId: string): BotButton[][] {
  return [
    [
      { text: "✅ Принял", data: encodeCallback("task", "acc", taskId) },
      { text: "🏁 Сделал", data: encodeCallback("task", "done", taskId) },
    ],
  ];
}

export function meetingButtons(meetingId: string): BotButton[][] {
  return [[{ text: "✅ Буду", data: encodeCallback("meeting", "yes", meetingId) }]];
}

// An idea is not an instruction — there is nothing to accept or finish, so it
// goes without buttons.
export function ideaButtons(): BotButton[][] {
  return [];
}

export async function findColleagueByChat(
  admin: SupabaseClient,
  chatId: number,
  channel: BotChannelConfig,
): Promise<{ id: string; name: string; user_id: string } | null> {
  const { data } = await admin
    .from("assignees")
    .select("id, name, user_id")
    .eq(channel.chatColumn, chatId)
    .limit(1)
    .maybeSingle();
  return (data as { id: string; name: string; user_id: string } | null) || null;
}

export async function listColleagues(admin: SupabaseClient, userId: string): Promise<ColleagueRow[]> {
  const { data } = await admin.from("assignees").select("id, name, telegram_chat_id, max_user_id").eq("user_id", userId).order("created_at");
  return (data || []) as ColleagueRow[];
}

// Where this person can be written to, in the order the channels are listed.
// A colleague connected to both gets one message, not two: the first
// messenger they connected through is the one that is used.
export function chatsFor(row: ColleagueRow): { channel: BotChannelConfig; chatId: number }[] {
  const out: { channel: BotChannelConfig; chatId: number }[] = [];
  for (const channel of BOT_CHANNELS) {
    const id = channel.id === "telegram" ? row.telegram_chat_id : row.max_user_id;
    if (id != null) out.push({ channel, chatId: id });
  }
  return out;
}
