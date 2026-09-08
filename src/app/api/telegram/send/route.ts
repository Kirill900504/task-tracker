import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkRateLimit } from "@/lib/rateLimit";
import { chatsFor, ideaMessage, meetingButtons, meetingMessage, taskButtons, taskMessage, type ColleagueRow } from "@/lib/colleagues";
import { sendToColleague } from "@/lib/botDelivery";
import type { BotChannelConfig } from "@/lib/botTransport";

// Sending a task, a meeting or a thought to the colleague it concerns.
//
// What is sent is read back from the database through the USER's own client,
// so RLS decides what may be sent at all — the request carries an id, never
// the content, and cannot be used to push arbitrary text through the bot.
// Who it goes to is worked out here too: the task's assignee, the meeting's
// participants, or, for a thought, the named person.
//
// Which messenger it travels through is not the caller's business either:
// a colleague is connected to Telegram, to MAX, or to both, and one message
// goes to whichever they connected first (see chatsFor).

type Recipient = { id: string; name: string; target: { channel: BotChannelConfig; chatId: number } };

async function recipientsByName(
  supabase: Awaited<ReturnType<typeof createClient>>,
  names: string[],
): Promise<{ linked: Recipient[]; unlinked: string[] }> {
  const wanted = names.filter(Boolean);
  if (!wanted.length) return { linked: [], unlinked: [] };
  const { data } = await supabase.from("assignees").select("id, name, telegram_chat_id, max_user_id").in("name", wanted);
  const rows = (data || []) as ColleagueRow[];
  const linked: Recipient[] = [];
  const unlinked: string[] = [];
  for (const name of wanted) {
    const row = rows.find((r) => r.name === name);
    const target = row ? chatsFor(row)[0] : undefined;
    if (row && target) linked.push({ id: row.id, name: row.name, target });
    else unlinked.push(name);
  }
  return { linked, unlinked };
}

function nobodyReachable(unlinked: string[], fallback: string): string {
  return unlinked.length ? `Не подключены ни к Telegram, ни к MAX: ${unlinked.join(", ")}` : fallback;
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
      return NextResponse.json({ error: nobodyReachable(unlinked, "Некому отправлять") }, { status: 400 });
    }
    for (const person of linked) {
      const result = await sendToColleague(person.target, taskMessage(task, from), taskButtons(task.id as string));
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
      return NextResponse.json({ error: nobodyReachable(unlinked, "Некому отправлять") }, { status: 400 });
    }
    for (const person of linked) {
      const result = await sendToColleague(person.target, meetingMessage(meeting, from), meetingButtons(meeting.id as string));
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
      return NextResponse.json({ error: nobodyReachable(unlinked, "Выберите, кому отправить") }, { status: 400 });
    }
    for (const person of linked) {
      const result = await sendToColleague(person.target, ideaMessage(idea.text as string, from));
      if (result.ok) sentTo.push(person.name);
      else failed.push(`${person.name} (${result.error})`);
    }
    if (sentTo.length) await admin.from("ideas").update({ sent_at: new Date().toISOString() }).eq("id", id);
  }

  return NextResponse.json({ sentTo, failed });
}
