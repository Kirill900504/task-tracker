import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkRateLimit } from "@/lib/rateLimit";
import { sendTelegramMessage } from "@/lib/telegram";
import { ideaMessage, meetingButtons, meetingMessage, taskButtons, taskMessage } from "@/lib/colleagues";

// Sending a task, a meeting or a thought to the colleague it concerns.
//
// What is sent is read back from the database through the USER's own client,
// so RLS decides what may be sent at all — the request carries an id, never
// the content, and cannot be used to push arbitrary text through the bot.
// Who it goes to is worked out here too: the task's assignee, the meeting's
// participants, or, for a thought, the named person.

type Recipient = { id: string; name: string; chatId: number };

async function recipientsByName(
  supabase: Awaited<ReturnType<typeof createClient>>,
  names: string[],
): Promise<{ linked: Recipient[]; unlinked: string[] }> {
  const wanted = names.filter(Boolean);
  if (!wanted.length) return { linked: [], unlinked: [] };
  const { data } = await supabase.from("assignees").select("id, name, telegram_chat_id").in("name", wanted);
  const rows = (data || []) as { id: string; name: string; telegram_chat_id: number | null }[];
  const linked: Recipient[] = [];
  const unlinked: string[] = [];
  for (const name of wanted) {
    const row = rows.find((r) => r.name === name);
    if (row?.telegram_chat_id) linked.push({ id: row.id, name: row.name, chatId: row.telegram_chat_id });
    else unlinked.push(name);
  }
  return { linked, unlinked };
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });

  const { allowed } = await checkRateLimit(supabase, user.id, "telegram-send", 60, 60);
  if (!allowed) return NextResponse.json({ error: "Слишком много отправок подряд, подождите минуту" }, { status: 429 });

  const body = await req.json().catch(() => null);
  const kind = body?.kind;
  const id = typeof body?.id === "string" ? body.id : "";
  const to: string[] = Array.isArray(body?.to) ? body.to.filter((n: unknown) => typeof n === "string") : [];
  if (!id || (kind !== "task" && kind !== "meeting" && kind !== "idea")) {
    return NextResponse.json({ error: "Непонятно, что отправлять" }, { status: 400 });
  }

  // The sender's own display name, as the colleague will see it.
  const from = user.email?.split("@")[0] || "трекера";
  const admin = createAdminClient();
  const sentTo: string[] = [];
  const failed: string[] = [];

  if (kind === "task") {
    const { data: task } = await supabase.from("tasks").select("id, title, description, deadline, priority, assignee").eq("id", id).maybeSingle();
    if (!task) return NextResponse.json({ error: "Задача не найдена" }, { status: 404 });
    const { linked, unlinked } = await recipientsByName(supabase, to.length ? to : [task.assignee as string]);
    if (!linked.length) {
      return NextResponse.json({ error: unlinked.length ? `Не подключён к Telegram: ${unlinked.join(", ")}` : "Некому отправлять" }, { status: 400 });
    }
    for (const person of linked) {
      const result = await sendTelegramMessage(person.chatId, taskMessage(task, from), { buttons: taskButtons(task.id as string) });
      if (result.ok) sentTo.push(person.name);
      else failed.push(`${person.name} (${result.error})`);
    }
    if (sentTo.length) await admin.from("tasks").update({ sent_at: new Date().toISOString() }).eq("id", id);
  }

  if (kind === "meeting") {
    const { data: meeting } = await supabase.from("meetings").select("id, title, date, time, participants").eq("id", id).maybeSingle();
    if (!meeting) return NextResponse.json({ error: "Встреча не найдена" }, { status: 404 });
    const names = to.length ? to : ((meeting.participants as string[]) || []);
    const { linked, unlinked } = await recipientsByName(supabase, names);
    if (!linked.length) {
      return NextResponse.json({ error: unlinked.length ? `Не подключены к Telegram: ${unlinked.join(", ")}` : "Некому отправлять" }, { status: 400 });
    }
    for (const person of linked) {
      const result = await sendTelegramMessage(person.chatId, meetingMessage(meeting, from), { buttons: meetingButtons(meeting.id as string) });
      if (result.ok) sentTo.push(person.name);
      else failed.push(`${person.name} (${result.error})`);
    }
    if (sentTo.length) await admin.from("meetings").update({ sent_at: new Date().toISOString() }).eq("id", id);
  }

  if (kind === "idea") {
    const { data: idea } = await supabase.from("ideas").select("id, text").eq("id", id).maybeSingle();
    if (!idea) return NextResponse.json({ error: "Мысль не найдена" }, { status: 404 });
    const { linked, unlinked } = await recipientsByName(supabase, to);
    if (!linked.length) {
      return NextResponse.json({ error: unlinked.length ? `Не подключён к Telegram: ${unlinked.join(", ")}` : "Выберите, кому отправить" }, { status: 400 });
    }
    for (const person of linked) {
      const result = await sendTelegramMessage(person.chatId, ideaMessage(idea.text as string, from));
      if (result.ok) sentTo.push(person.name);
      else failed.push(`${person.name} (${result.error})`);
    }
    if (sentTo.length) await admin.from("ideas").update({ sent_at: new Date().toISOString() }).eq("id", id);
  }

  return NextResponse.json({ sentTo, failed });
}
